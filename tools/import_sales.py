#!/usr/bin/env python3
"""
Bulk-import sold comps from a CSV — a Terapeak export, an eBay Seller Hub download,
or anything you keep by hand.

    python3 tools/import_sales.py terapeak.csv --dry        # preview, change nothing
    python3 tools/import_sales.py terapeak.csv              # import
    python3 tools/import_sales.py terapeak.csv --marketplace eBay --fuzzy
    python3 tools/import_sales.py --columns                 # what headers are understood

Imported rows land in tools/imported_sales.json, which build_data.py merges on every
rebuild — so `npm run build` never loses them and the researched seed data stays intact.

What this enforces (BuildaBear1.md sections 3 and 33):

  * Sold rows only. A row is imported as evidence_type "completed_sale" ONLY when it
    carries a date, a marketplace and a listing id. Anything thinner becomes a
    "collector_report" — still sold data, but not dressed up as verified.
  * Nothing is guessed. A row whose title does not confidently resolve to a known item
    is written to <input>.unmatched.csv rather than being attached to the wrong bear.
  * Duplicates are rejected, both against what is already in the database and within
    the file itself.

Terapeak is free with an eBay seller account and shows genuine sold comps, which makes
it the realistic route to volume without violating anyone's terms.
"""

import argparse
import csv
import json
import os
import re
import sys
from collections import OrderedDict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMPORTED = os.path.join(ROOT, "tools", "imported_sales.json")

# Header aliases. Terapeak, Seller Hub and hand-kept sheets all name things
# differently; normalise() strips case, spaces and punctuation before matching.
COLUMNS = OrderedDict([
    ("item_id",      ["itemid", "bearchartid", "slug", "itemslug"]),
    ("title",        ["title", "itemtitle", "name", "listingtitle", "product", "item"]),
    ("sold_price",   ["soldprice", "price", "saleprice", "totalprice", "avgsoldprice",
                      "averagesoldprice", "soldfor", "amount"]),
    ("sale_date",    ["solddate", "datesold", "saledate", "date", "enddate", "dateofsale"]),
    ("condition",    ["condition", "itemcondition"]),
    ("listing_id",   ["listingid", "itemnumber", "ebayitemid", "itemidnumber", "legacyitemid"]),
    ("marketplace",  ["marketplace", "site", "platform", "source", "venue"]),
    ("source_url",   ["url", "itemurl", "link", "listingurl", "viewitemurl"]),
    ("sample_size",  ["quantity", "qty", "quantitysold", "unitssold", "soldcount",
                      "totalsold", "sales", "salescount", "transactions"]),
    ("completeness", ["completeness", "complete"]),
    ("notes",        ["notes", "note", "comment", "comments", "subtitle"]),
])

# Free-text condition wording -> BearChart's vocabulary. Order matters: the first
# pattern that matches wins, so the most specific phrasings come first.
CONDITION_PATTERNS = [
    (r"new\s*with\s*tag|nwt|bnwt|brand\s*new.*tag", "NWT"),
    (r"new\s*without\s*tag|nwot", "Mint"),
    (r"\bmint\b|like\s*new|new\s*\(other\)|open\s*box", "Mint"),
    (r"\bnew\b|\bsealed\b|\bbnib\b", "NWT"),
    (r"excellent|near\s*mint|\bvgc\b|very\s*good", "Excellent"),
    (r"\bgood\b|pre[\s-]*owned|\bused\b|second\s*hand|previously\s*owned", "Good"),
    (r"\bfair\b|acceptable|played\s*with", "Fair"),
    (r"\bpoor\b|\brough\b|well\s*loved", "Poor"),
    (r"damaged|broken|for\s*parts|not\s*working|repair", "Damaged"),
    (r"incomplete|missing", "Incomplete"),
]

COMPLETENESS_PATTERNS = [
    (r"\bcomplete\b|with\s*outfit|full\s*set|all\s*accessories", "complete"),
    (r"\bpackag|\bboxed\b|in\s*box", "packaged"),
    (r"unstuffed|flat|skin\s*only", "unstuffed"),
    (r"some\s*original|with\s*clothes|with\s*sound|with\s*accessor", "some_originals"),
    (r"\bbare\b|no\s*clothes|nude", "bare"),
    (r"altered|custom|missing", "altered"),
]

STOPWORDS = {"build", "a", "bear", "buildabear", "the", "workshop", "bab", "plush",
             "stuffed", "animal", "toy", "inch", "in", "with", "and", "rare", "vintage",
             "retired", "htf", "euc", "nwt", "new", "used", "lot", "of"}


def normalise(s):
    return re.sub(r"[^a-z0-9]", "", str(s or "").lower())


def tokens(s):
    words = re.sub(r"[^a-z0-9 ]", " ", str(s or "").lower()).split()
    return {w for w in words if w not in STOPWORDS and len(w) > 1}


def parse_price(raw):
    if raw is None:
        return None
    text = str(raw).strip()
    # A negative or parenthesised figure is a refund or credit, not a sale price.
    # Stripping the sign would turn it into a positive comp, so reject it outright.
    if re.search(r"-\s*[\d.]", text) or re.match(r"^\(.*\)$", text):
        return None
    s = re.sub(r"[^0-9.]", "", text)
    if not s or s.count(".") > 1:
        return None
    try:
        v = float(s)
    except ValueError:
        return None
    return v if v > 0 else None


def parse_date(raw):
    """Return YYYY-MM-DD, or None. An unparseable date is dropped, never invented."""
    if not raw:
        return None
    s = str(raw).strip()
    m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})", s)
    if m:
        y, mo, d = m.groups()
    else:
        m = re.match(r"^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})", s)
        if not m:
            m2 = re.match(r"^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})", s)
            if not m2:
                return None
            months = ["jan", "feb", "mar", "apr", "may", "jun",
                      "jul", "aug", "sep", "oct", "nov", "dec"]
            mon = m2.group(1)[:3].lower()
            if mon not in months:
                return None
            return "%s-%02d-%02d" % (m2.group(3), months.index(mon) + 1, int(m2.group(2)))
        mo, d, y = m.groups()
        if len(y) == 2:
            y = "20" + y
    try:
        y, mo, d = int(y), int(mo), int(d)
    except ValueError:
        return None
    if not (1990 <= y <= 2100 and 1 <= mo <= 12 and 1 <= d <= 31):
        return None
    return "%04d-%02d-%02d" % (y, mo, d)


def match_pattern(patterns, text, default):
    t = str(text or "").lower()
    for pat, value in patterns:
        if re.search(pat, t):
            return value
    return default


def map_headers(fieldnames, overrides):
    """Map this file's headers onto BearChart's field names."""
    mapping = {}
    lookup = {}
    for field, aliases in COLUMNS.items():
        for a in aliases:
            lookup[a] = field
    for h in fieldnames or []:
        key = normalise(h)
        if key in lookup and lookup[key] not in mapping.values():
            mapping[h] = lookup[key]
    for pair in overrides:
        if "=" not in pair:
            raise SystemExit("bad --map %r, expected field=Header" % pair)
        field, header = pair.split("=", 1)
        if field not in COLUMNS:
            raise SystemExit("unknown field %r in --map" % field)
        mapping[header] = field
    return mapping


class Matcher:
    """Resolves a listing title to a known item, or declines to."""

    def __init__(self, items):
        self.items = items
        self.by_slug = {i["id"]: i for i in items}

        # Canonical names and aliases are kept apart, and every match is kept as
        # a LIST. An earlier version used setdefault, so when two items shared a
        # name the first one defined silently won and every comp for that name
        # landed on it - possibly the wrong record, with no way to notice.
        # A name that identifies two items identifies neither.
        self.by_name = {}
        self.by_alias = {}
        for i in items:
            self.by_name.setdefault(normalise(i["canonical_name"]), []).append(i)
            for a in i.get("aliases") or []:
                self.by_alias.setdefault(normalise(a), []).append(i)
        self.token_sets = [(i, tokens(i["canonical_name"]) |
                            set().union(*[tokens(a) for a in i.get("aliases") or []] or [set()]))
                           for i in items]

    def ambiguous_names(self):
        """Every name that identifies more than one item."""
        out = {}
        for table in (self.by_name, self.by_alias):
            for key, hits in table.items():
                ids = {h["id"] for h in hits}
                if len(ids) > 1:
                    out.setdefault(key, set()).update(ids)
        return out

    def resolve(self, item_id, title, fuzzy):
        if item_id:
            hit = self.by_slug.get(str(item_id).strip())
            if hit:
                return hit, "id", 1.0
            return None, "unknown-id", 0.0

        key = normalise(title)

        # A canonical name outranks an alias: if "Rainbow Sloth" names one item
        # and is merely an alias of another, the named one wins outright.
        for table, how in ((self.by_name, "exact"), (self.by_alias, "alias")):
            hits = table.get(key)
            if not hits:
                continue
            unique = {h["id"]: h for h in hits}
            if len(unique) == 1:
                return hits[0], how, 1.0
            return None, "ambiguous-name", 0.0

        # Containment: a listing title usually wraps the item name in noise.
        contained = [i for i in self.items if normalise(i["canonical_name"]) in key]
        if len(contained) == 1:
            return contained[0], "contained", 0.9
        if len(contained) > 1:
            best = max(contained, key=lambda i: len(i["canonical_name"]))
            others = [i for i in contained if i is not best]
            if all(len(i["canonical_name"]) < len(best["canonical_name"]) - 2 for i in others):
                return best, "contained", 0.85
            return None, "ambiguous", 0.0

        if not fuzzy:
            return None, "no-match", 0.0

        # Token overlap, and only when one candidate clearly wins.
        t = tokens(title)
        if not t:
            return None, "no-match", 0.0
        scored = []
        for item, itokens in self.token_sets:
            if not itokens:
                continue
            overlap = len(t & itokens) / len(itokens)
            if overlap > 0:
                scored.append((overlap, item))
        if not scored:
            return None, "no-match", 0.0
        scored.sort(key=lambda x: -x[0])
        best_score, best_item = scored[0]
        runner = scored[1][0] if len(scored) > 1 else 0.0
        if best_score >= 0.75 and best_score - runner >= 0.25:
            return best_item, "fuzzy", best_score
        return None, "ambiguous" if runner else "weak-match", best_score


def unneutralise(v):
    """Undo the CSV-injection guard BearChart's own exports add.

    sanitize.js prefixes a cell starting with = + - @ tab or CR with a single
    quote so a spreadsheet will not run it as a formula. Reading one of those
    files back must give the original text, not the guarded one.
    """
    if isinstance(v, str) and len(v) > 1 and v[0] == "'" and v[1] in "=+-@\t\r":
        return v[1:]
    return v


def load_json(path, default):
    if not os.path.exists(path):
        return default
    with open(path) as f:
        return json.load(f)


def dedupe_key(s):
    return (s["item_id"], round(float(s["sold_price"]), 2),
            s.get("sale_date") or "", s.get("listing_id") or "")


def run(args):
    data = load_json(os.path.join(ROOT, "data.json"), None)
    if data is None:
        raise SystemExit("data.json not found - run tools/build_data.py first")

    existing = load_json(IMPORTED, [])
    seen = {dedupe_key(s) for s in data["sales"]}
    seen |= {dedupe_key(s) for s in existing}

    matcher = Matcher(data["items"])

    with open(args.csvfile, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        mapping = map_headers(reader.fieldnames, args.map)
        fields = set(mapping.values())
        if "sold_price" not in fields:
            raise SystemExit(
                "no sold-price column found. Headers seen: %s\n"
                "Map it explicitly, e.g.  --map sold_price='Sale Price'"
                % ", ".join(reader.fieldnames or []))
        if "title" not in fields and "item_id" not in fields:
            raise SystemExit("need a title or item_id column to identify the item")

        rows = list(reader)

    added, unmatched, rejected = [], [], []
    stats = {"duplicate": 0, "no_price": 0, "completed": 0, "report": 0}

    for n, row in enumerate(rows, start=2):
        rec = {}
        for header, field in mapping.items():
            rec[field] = unneutralise(row.get(header))

        price = parse_price(rec.get("sold_price"))
        if price is None:
            stats["no_price"] += 1
            rejected.append((n, "unreadable price %r" % rec.get("sold_price")))
            continue

        item, how, score = matcher.resolve(rec.get("item_id"), rec.get("title"), args.fuzzy)
        if not item:
            row["_reason"] = how
            unmatched.append(row)
            continue

        date = parse_date(rec.get("sale_date"))
        marketplace = (rec.get("marketplace") or args.marketplace or "").strip() or None
        listing_id = (str(rec.get("listing_id")).strip()
                      if rec.get("listing_id") not in (None, "") else None)

        # The provenance rule, enforced at the door.
        # A row carrying a sold-quantity column is a research summary: one average
        # price standing for several transactions. Recorded as such, never as one sale.
        sample = None
        raw_n = rec.get("sample_size")
        if raw_n not in (None, ""):
            try:
                parsed = int(float(re.sub(r"[^0-9.]", "", str(raw_n)) or 0))
                if parsed > 1:
                    sample = parsed
            except ValueError:
                sample = None

        if sample:
            # An average across N sales is not one verified transaction, whatever
            # other columns the file carries.
            evidence = "collector_report"
        else:
            evidence = ("completed_sale" if (date and marketplace and listing_id)
                        else "collector_report")

        condition_text = " ".join(filter(None, [str(rec.get("condition") or ""),
                                                str(rec.get("title") or "")]))
        sale = OrderedDict([
            ("id", None),
            ("item_id", item["id"]),
            ("sale_date", date),
            ("sold_price", round(price, 2)),
            ("price_high", None),
            ("ranged", False),
            ("currency", "USD"),
            ("condition", match_pattern(CONDITION_PATTERNS, condition_text, "Unknown")),
            ("completeness", match_pattern(COMPLETENESS_PATTERNS, condition_text, "unknown")),
            ("marketplace", marketplace),
            ("source_url", (rec.get("source_url") or "").strip() or None),
            ("listing_id", listing_id),
            ("evidence_type", evidence),
            ("shipping_included", None),
            ("sample_size", sample),
            ("notes", (rec.get("notes") or "").strip() or None),
            ("import_match", how),
        ])

        key = dedupe_key(sale)
        if key in seen:
            stats["duplicate"] += 1
            continue
        seen.add(key)
        # Counted only once the row is actually being kept, so the breakdown
        # always reconciles with the matched total.
        stats["completed" if evidence == "completed_sale" else "report"] += 1
        added.append(sale)

    # Stable ids, numbered after whatever the item already has.
    counts = {}
    for s in data["sales"] + existing:
        counts[s["item_id"]] = counts.get(s["item_id"], 0) + 1
    for s in added:
        counts[s["item_id"]] = counts.get(s["item_id"], 0) + 1
        s["id"] = "%s-i%02d" % (s["item_id"], counts[s["item_id"]])

    print("read %d row(s) from %s" % (len(rows), args.csvfile))
    print("  matched:    %d" % len(added))
    print("    completed_sale (full provenance): %d" % stats["completed"])
    print("    collector_report (thinner):       %d" % stats["report"])
    aggregates = sum(1 for a in added if a.get("sample_size"))
    if aggregates:
        covered = sum(a["sample_size"] for a in added if a.get("sample_size"))
        print("    of which research averages:       %d (covering %d transactions)"
              % (aggregates, covered))
    print("  duplicates skipped: %d" % stats["duplicate"])
    print("  unreadable price:   %d" % stats["no_price"])
    print("  unmatched titles:   %d" % len(unmatched))

    if unmatched:
        out = args.csvfile + ".unmatched.csv"
        if not args.dry:
            with open(out, "w", newline="") as f:
                w = csv.DictWriter(f, fieldnames=(list(rows[0].keys()) + ["_reason"]))
                w.writeheader()
                w.writerows(unmatched)
            print("  -> wrote %s (fix the titles, or add an item_id column, and re-run)" % out)
        reasons = {}
        for r in unmatched:
            reasons[r["_reason"]] = reasons.get(r["_reason"], 0) + 1
        for why, c in sorted(reasons.items(), key=lambda x: -x[1]):
            print("     %-12s %d" % (why, c))

    for n, why in rejected[:10]:
        print("  line %d rejected: %s" % (n, why))

    if args.dry:
        print("\ndry run - nothing written")
        return 0

    if not added:
        print("\nnothing new to import")
        return 0

    for s in added:
        s.pop("import_match", None)
    existing.extend(added)
    with open(IMPORTED, "w") as f:
        json.dump(existing, f, indent=2)
        f.write("\n")

    print("\nwrote %s (%d sale(s) total)" % (IMPORTED, len(existing)))
    print("now run: npm run build && npm test")
    return 0


def show_columns():
    print("Recognised CSV headers (case, spaces and punctuation are ignored):\n")
    for field, aliases in COLUMNS.items():
        print("  %-13s %s" % (field, ", ".join(aliases)))
    print("\nAnything unrecognised can be mapped explicitly:")
    print("  --map sold_price='Avg Sold Price' --map sale_date='Last Sold'")
    print("\nOnly sold_price plus one of title/item_id are required.")


def main():
    ap = argparse.ArgumentParser(add_help=True, description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csvfile", nargs="?", help="CSV of sold comps")
    ap.add_argument("--dry", action="store_true", help="preview without writing")
    ap.add_argument("--fuzzy", action="store_true",
                    help="allow token-overlap matching for titles that do not match exactly")
    ap.add_argument("--marketplace", help="default marketplace when the CSV has no column")
    ap.add_argument("--map", action="append", default=[], metavar="field=Header",
                    help="map a CSV header onto a field")
    ap.add_argument("--columns", action="store_true", help="list recognised headers and exit")
    args = ap.parse_args()

    if args.columns:
        show_columns()
        return 0
    if not args.csvfile:
        ap.print_help()
        return 2
    return run(args)


if __name__ == "__main__":
    sys.exit(main())

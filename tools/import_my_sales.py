#!/usr/bin/env python3
"""
Import YOUR OWN completed sales - the best data this database can hold.

    python3 tools/import_my_sales.py orders.csv --dry
    python3 tools/import_my_sales.py orders.csv --condition Good
    python3 tools/import_my_sales.py orders.csv --marketplace Mercari

Where to get the file:
  eBay   Seller Hub -> Reports -> Downloads -> "Orders" report
  Mercari / Poshmark / Depop: export or copy your sold history into a CSV with
  columns for the item title, the price and the sale date.

WHY THIS DATA IS BETTER THAN ANYTHING ELSE HERE
===============================================
A comp scraped off a listing title is a guess about what was in the box. Your own
sale is not: you know what condition it was in, what came with it, and exactly
what it cleared. That makes these rows first-party evidence, and the engine
counts them as the strongest kind - stronger than a third-party completed sale,
because nobody had to infer anything.

It is also data no competitor can copy.

PRIVACY
=======
An order report contains buyer names, addresses and contact details. This tool
reads a strict ALLOWLIST of columns - title, price, date, item number, quantity,
condition - and everything else in the file is ignored and never written. The run
prints which columns it ignored so you can see that for yourself.

Nothing here is uploaded anywhere. It is written to tools/imported_sales.json on
this machine.
"""

import argparse
import csv
import json
import os
import re
import sys
from collections import OrderedDict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from import_sales import (Matcher, parse_price, parse_date, match_pattern,  # noqa: E402
                          CONDITION_PATTERNS, COMPLETENESS_PATTERNS, normalise)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMPORTED = os.path.join(ROOT, "tools", "imported_sales.json")

# The only columns that are read. Anything else in the file is ignored entirely,
# which is what keeps buyer details out of the database.
ALLOWED = OrderedDict([
    ("title",        ["itemtitle", "title", "listingtitle", "itemname", "product",
                      "description", "item"]),
    ("sold_price",   ["soldfor", "soldprice", "itemsubtotal", "saleprice", "price",
                      "totalprice", "grosssales", "itemprice"]),
    ("sale_date",    ["saledate", "solddate", "orderdate", "datesold", "orderdatetime",
                      "paiddate", "date"]),
    ("listing_id",   ["itemnumber", "itemid", "legacyitemid", "listingid", "ordernumber",
                      "orderid", "salesrecordnumber", "transactionid"]),
    ("quantity",     ["quantity", "qty", "quantitysold", "units"]),
    ("condition",    ["condition", "itemcondition"]),
    ("item_id",      ["bearchartid", "slug", "itemslug"]),
])

# Shipping the buyer paid. These exact normalised headers are the only ones
# containing "ship" that are ever read, and they are checked BEFORE NEVER_READ:
# they are an amount of money, not an address. "Ship To Address 1",
# "Ship To Zip" and the rest still never reach this tool.
SHIP_PRICE_HEADERS = ["shippingandhandling", "shippingcharged", "postageandpackaging"]

# Columns that must never be read, named explicitly so the intent is obvious even
# though the allowlist above already excludes them.
NEVER_READ = re.compile(
    r"buyer|ship|address|street|city|state|zip|postal|country|email|phone|"
    r"name|recipient|tracking|note|feedback|paypal|payout|transaction.?fee",
    re.I)


def map_columns(fieldnames):
    """Return (mapping, ignored). Only allowlisted headers are ever mapped.

    Where a file offers several candidates for the same field, the one earliest
    in that field's alias list wins - not the one earliest in the file. An eBay
    order report carries both an item number and a sales record number, and the
    item number is the one worth keeping, because it is what other comps for the
    same listing are keyed on.
    """
    # field -> (alias priority, header)
    best = {}
    for h in fieldnames or []:
        key = normalise(h)
        if key in SHIP_PRICE_HEADERS:
            rank = SHIP_PRICE_HEADERS.index(key)
            if "ship_price" not in best or rank < best["ship_price"][0]:
                best["ship_price"] = (rank, h)
            continue
        if NEVER_READ.search(h):
            continue
        for field, aliases in ALLOWED.items():
            if key in aliases:
                rank = aliases.index(key)
                if field not in best or rank < best[field][0]:
                    best[field] = (rank, h)
                break

    mapping = {header: field for field, (_, header) in best.items()}
    ignored = [h for h in (fieldnames or []) if h not in mapping]
    return mapping, ignored


def load_imported():
    if not os.path.exists(IMPORTED):
        return []
    with open(IMPORTED) as f:
        return json.load(f)


def run(args):
    with open(os.path.join(ROOT, "data.json")) as f:
        data = json.load(f)

    matcher = Matcher(data["items"])
    existing = load_imported()

    # Your own sale is identified by its order/item number.
    seen_ids = {s.get("listing_id") for s in data["sales"] + existing if s.get("listing_id")}

    with open(args.csvfile, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        mapping, ignored = map_columns(reader.fieldnames)
        fields = set(mapping.values())
        if "sold_price" not in fields:
            raise SystemExit(
                "no price column found. Headers seen: %s"
                % ", ".join(reader.fieldnames or []))
        if "title" not in fields and "item_id" not in fields:
            raise SystemExit("need an item title or item_id column")
        rows = list(reader)

    print("reading %s" % args.csvfile)
    print("  columns used:    %s" % ", ".join(sorted(set(mapping.values()))))
    if ignored:
        print("  columns IGNORED: %s" % ", ".join(ignored))
        print("  (nothing from those columns is read or stored)")

    added, unmatched = [], []
    stats = {"dupe": 0, "no_price": 0}

    for n, row in enumerate(rows, start=2):
        rec = {}
        for header, field in mapping.items():
            rec[field] = row.get(header)

        price = parse_price(rec.get("sold_price"))
        if price is None:
            stats["no_price"] += 1
            continue

        item, how, _ = matcher.resolve(rec.get("item_id"), rec.get("title"), args.fuzzy)
        if not item:
            row["_reason"] = how
            unmatched.append(row)
            continue

        listing_id = (str(rec.get("listing_id")).strip()
                      if rec.get("listing_id") not in (None, "") else None)
        if listing_id and listing_id in seen_ids:
            stats["dupe"] += 1
            continue

        date = parse_date(rec.get("sale_date"))
        text = " ".join(filter(None, [str(rec.get("condition") or ""),
                                      str(rec.get("title") or "")]))
        condition = match_pattern(CONDITION_PATTERNS, text, args.condition)
        completeness = match_pattern(COMPLETENESS_PATTERNS, text, args.completeness)

        # A first-party sale still has to satisfy the provenance rule to claim
        # completed_sale. You know it sold, but the database records how it can
        # be checked - and a row with no date or order number cannot be.
        evidence = ("completed_sale"
                    if (date and args.marketplace and listing_id)
                    else "collector_report")

        if listing_id:
            seen_ids.add(listing_id)

        added.append(OrderedDict([
            ("id", None),
            ("item_id", item["id"]),
            ("sale_date", date),
            ("sold_price", round(price, 2)),
            ("price_high", None),
            ("ranged", False),
            ("currency", "USD"),
            ("condition", condition),
            ("completeness", completeness),
            ("marketplace", args.marketplace),
            ("source_url", None),
            ("listing_id", listing_id),
            ("evidence_type", evidence),
            ("shipping_included", False),
            ("ship_price", parse_price(rec.get("ship_price"), allow_zero=True)),
            ("sample_size", None),
            # The flag that makes these worth more than anything else here.
            ("first_party", True),
            ("notes", "Own sale (%s)." % args.marketplace),
        ]))

    counts = {}
    for s in data["sales"] + existing:
        counts[s["item_id"]] = counts.get(s["item_id"], 0) + 1
    for s in added:
        counts[s["item_id"]] = counts.get(s["item_id"], 0) + 1
        s["id"] = "%s-own%02d" % (s["item_id"], counts[s["item_id"]])

    strong = sum(1 for s in added if s["evidence_type"] == "completed_sale")
    print("\n  read %d row(s)" % len(rows))
    print("  imported:        %d of your own sales" % len(added))
    print("    fully sourced: %d" % strong)
    print("    thinner:       %d (missing a date or order number)" % (len(added) - strong))
    print("  duplicates:      %d" % stats["dupe"])
    print("  unreadable price:%d" % stats["no_price"])
    print("  unmatched items: %d" % len(unmatched))

    if unmatched and not args.dry:
        out = args.csvfile + ".unmatched.csv"
        with open(out, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()) + ["_reason"])
            w.writeheader()
            w.writerows(unmatched)
        print("  -> %s (add a bearchart_id column to place these)" % out)

    if args.dry:
        for s in added[:10]:
            print("    %-9s %-34s %s" % ("$%.2f" % s["sold_price"], s["item_id"],
                                         s["sale_date"] or "no date"))
        print("\ndry run - nothing written")
        return 0

    if not added:
        print("\nnothing new to import")
        return 0

    existing.extend(added)
    with open(IMPORTED, "w") as f:
        json.dump(existing, f, indent=2)
        f.write("\n")
    print("\nwrote %s" % IMPORTED)
    print("now run: npm run build && npm test")
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csvfile", nargs="?")
    ap.add_argument("--marketplace", default="eBay",
                    help="where you sold them (default eBay)")
    ap.add_argument("--condition", default="Unknown",
                    help="condition to assume when the file does not say (default Unknown)")
    ap.add_argument("--completeness", default="unknown")
    ap.add_argument("--fuzzy", action="store_true",
                    help="allow token matching for titles that do not resolve exactly")
    ap.add_argument("--dry", action="store_true")
    args = ap.parse_args()
    if not args.csvfile:
        ap.print_help()
        return 2
    return run(args)


if __name__ == "__main__":
    sys.exit(main())

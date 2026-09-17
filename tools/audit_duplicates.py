#!/usr/bin/env python3
"""
Find likely duplicate items, and aliases that point at more than one item.

    python3 tools/audit_duplicates.py            # full report
    python3 tools/audit_duplicates.py --strict   # exit 1 if anything needs a decision

Why this matters in a price guide specifically: a duplicate splits an item's
comps across two records, so BOTH look thinner than the evidence really is. Two
records with three sales each report LOW confidence; one record with six reports
MEDIUM. The duplicate does not just clutter the catalogue, it actively makes the
valuations worse.

The catalogue was largely built from keyword sweeps over seller-written listing
titles, which is exactly the process that produces near-duplicates.

WHAT THIS DOES NOT FLAG AS A PROBLEM
====================================
Plenty of near-identical names are deliberate and must stay apart: an original
release and its Vault reissue, a 2016 game figure and its 2024 film version, a
Mini Bean and the full-size plush. Where a record already documents the split in
its notes, it is reported as settled rather than as a problem to fix.
"""

import argparse
import json
import os
import re
import sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Words that carry no identifying weight when comparing two names.
NOISE = {
    "build", "a", "bear", "buildabear", "the", "workshop", "plush", "stuffed",
    "animal", "toy", "inch", "of", "and", "with", "in", "st", "louis",
}

# Qualifiers that USUALLY mark a deliberate variant rather than a duplicate.
VARIANT_WORDS = {
    "mini", "beans", "bean", "jumbo", "giant", "smallfrys", "vault", "movie",
    "original", "employee", "exclusive", "zoo", "japan", "uk", "australia",
    "heartables", "cubscription", "collectibear", "set", "lot", "outfit",
    "costume", "wristie", "shoes", "pajamas", "v1", "v2", "ii", "iii", "iv", "v",
}

# A human has DECIDED these are separate items. Nothing left to do.
DECIDED = re.compile(
    r"do not merge|not be merged|never merge|distinct from|priced apart|"
    r"price[sd]? separately|priced? apart|different product|unrelated|do not confuse",
    re.I)

# A human has NOTICED the overlap but has not resolved it. These still need
# someone to look at the actual bears - filing them as settled would quietly
# lose the question.
OPEN = re.compile(
    r"unresolved|confirm before|before merging|may overlap|may be the same|"
    r"may or may not be the same|whether they are the same|needs confirmation",
    re.I)


def norm(s):
    return re.sub(r"[^a-z0-9]+", " ", str(s or "").lower()).strip()


def tokens(s):
    return {w for w in norm(s).split() if w not in NOISE and len(w) > 1}


def names_of(item):
    """Every string this item can be known by."""
    return [item["canonical_name"]] + list(item.get("aliases") or [])


def jaccard(a, b):
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def status_of(a, b):
    """decided | open | undocumented, for a pair."""
    notes = (a.get("notes") or "") + " " + (b.get("notes") or "")
    if OPEN.search(notes):
        return "open"
    if DECIDED.search(notes):
        return "decided"
    return "undocumented"


def find_alias_collisions(items):
    """One name resolving to several items - a functional bug, not untidiness.

    The importer resolves a listing title to an item by exact name or alias. If a
    name matches two items, whichever was defined first silently wins, and every
    comp for that name lands on possibly the wrong record.
    """
    by_name = defaultdict(list)
    for item in items:
        for n in names_of(item):
            key = norm(n)
            if key:
                by_name[key].append((item, n))

    collisions = []
    for key, entries in sorted(by_name.items()):
        ids = {i["id"] for i, _ in entries}
        if len(ids) > 1:
            collisions.append((key, entries))
    return collisions


YEARISH = re.compile(r"^(19|20)\d\d$|^\d{1,2}$")


def core_tokens(item, other=None):
    """The distinguishing part of a name.

    Two things are stripped before comparing:
      - the parenthetical qualifier, because this catalogue names things
        "Bubbles (Powerpuff Girls)" and the franchise would otherwise make every
        item in a franchise look like every other one;
      - the shared franchise words, for the same reason.
    """
    base = re.sub(r"\([^)]*\)", " ", item["canonical_name"])
    toks = tokens(base)
    # Only drop the franchise when the other item shares it. Stripping it
    # unconditionally turns "WWF Polar Bear" into "Polar Bear", which then looks
    # like the unrelated 1997 Polar Bear V2.
    fr = item.get("franchise")
    if fr and other is not None and other.get("franchise") == fr:
        toks -= tokens(fr)
    return toks


def find_near_duplicates(items):
    """Pairs close enough to be worth a human decision.

    Tuned to be short rather than exhaustive. A report that lists every pair of
    ponies is a report nobody reads, and the cost of a missed duplicate is much
    lower than the cost of an audit people learn to ignore.
    """
    buckets = defaultdict(list)
    for item in items:
        for t in core_tokens(item):
            buckets[t].append(item)

    seen, pairs = set(), []
    for bucket in buckets.values():
        if len(bucket) > 60:          # a token like "bear" identifies nothing
            continue
        for i in range(len(bucket)):
            for j in range(i + 1, len(bucket)):
                a, b = bucket[i], bucket[j]
                key = tuple(sorted([a["id"], b["id"]]))
                if key in seen:
                    continue
                seen.add(key)

                # A bear and the outfit made for it share almost every word and
                # are never the same record. Category settles it outright.
                if a.get("category") != b.get("category"):
                    continue

                at, bt = core_tokens(a, b), core_tokens(b, a)
                if not at or not bt:
                    continue

                score = jaccard(at, bt)
                extra = at ^ bt
                contained = at < bt or bt < at

                # Is everything that differs just a size/line/version/year word?
                cosmetic = bool(extra) and all(
                    (t in VARIANT_WORDS or YEARISH.match(t)) for t in extra)

                if at == bt:
                    conf, why = "high", ["identical once the qualifier is removed"]
                elif contained and cosmetic:
                    conf, why = "high", ["one name contains the other, differing only "
                                         "by %s" % ", ".join(sorted(extra))]
                elif score >= 0.8 and cosmetic:
                    conf, why = "medium", ["names %d%% similar, differing only by %s"
                                           % (round(score * 100), ", ".join(sorted(extra)))]
                elif contained:
                    # Extra word is a real distinguisher - "WWF Tiger" vs "WWF
                    # White Tiger" are probably two animals, not one record twice.
                    conf, why = "low", ["one name contains the other, but %s looks "
                                        "distinguishing" % ", ".join(sorted(extra))]
                else:
                    continue

                if a.get("species") == b.get("species"):
                    why.append("same species")
                if a.get("release_year") and a.get("release_year") == b.get("release_year"):
                    why.append("same year")

                pairs.append({
                    "a": a, "b": b, "score": score, "reasons": why,
                    "status": status_of(a, b),
                    "confidence": conf,
                })

    order = {"high": 0, "medium": 1, "low": 2}
    pairs.sort(key=lambda p: (order[p["confidence"]], -p["score"]))
    return pairs


def describe(item):
    bits = [item["id"]]
    if item.get("release_year"):
        bits.append(str(item["release_year"]))
    if item.get("species"):
        bits.append(item["species"])
    return "%s  (%s)" % (item["canonical_name"], ", ".join(bits))


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--strict", action="store_true",
                    help="exit 1 if anything needs a human decision")
    ap.add_argument("--all", action="store_true",
                    help="also list pairs already documented as deliberate")
    args = ap.parse_args()

    with open(os.path.join(ROOT, "data.json")) as f:
        data = json.load(f)
    items = data["items"]
    sales_by_item = defaultdict(int)
    for s in data["sales"]:
        sales_by_item[s["item_id"]] += 1

    print("auditing %d items\n" % len(items))

    collisions = find_alias_collisions(items)
    print("=" * 72)
    print("AMBIGUOUS NAMES  (%d)" % len(collisions))
    print("=" * 72)
    if not collisions:
        print("None. Every name and alias resolves to exactly one item.\n")
    else:
        print("These names match more than one item. The importer resolves a listing\n"
              "title by name, so whichever item is defined first silently wins and\n"
              "comps can land on the wrong record. Rename or drop the alias.\n")
        for key, entries in collisions:
            print('  "%s"' % key)
            for item, used_as in entries:
                how = "name" if norm(item["canonical_name"]) == key else "alias"
                print("      %-6s %s" % (how, describe(item)))
            print()

    pairs = find_near_duplicates(items)
    needs = [p for p in pairs if p["status"] == "undocumented"
             and p["confidence"] in ("high", "medium")]
    open_qs = [p for p in pairs if p["status"] == "open"]
    settled = [p for p in pairs if p["status"] == "decided"]
    variants = [p for p in pairs if p["status"] == "undocumented"
                and p["confidence"] == "low"]

    print("=" * 72)
    print("POSSIBLE DUPLICATES NEEDING A DECISION  (%d)" % len(needs))
    print("=" * 72)
    if not needs:
        print("None.\n")
    for p in needs:
        a, b = p["a"], p["b"]
        print("  [%s] %s" % (p["confidence"].upper(), "; ".join(p["reasons"])))
        print("      %s   %d comp(s)" % (describe(a), sales_by_item[a["id"]]))
        print("      %s   %d comp(s)" % (describe(b), sales_by_item[b["id"]]))
        if sales_by_item[a["id"]] and sales_by_item[b["id"]]:
            print("      ** both carry comps - merging would combine the evidence **")
        print()

    print("=" * 72)
    print("FLAGGED BUT NOT YET RESOLVED  (%d)" % len(open_qs))
    print("=" * 72)
    print("Someone noticed the overlap and could not settle it from a listing title.\n"
          "These need eyes on the actual bears - a tush tag usually decides it.\n")
    for p in open_qs:
        print("  %s" % describe(p["a"]))
        print("  %s" % describe(p["b"]))
        print("      %s\n" % "; ".join(p["reasons"]))

    print("=" * 72)
    print("PROBABLY DIFFERENT PRODUCTS  (%d)" % len(variants))
    print("=" * 72)
    print("One name contains the other, but the extra word looks like a real\n"
          "distinction rather than a variant tag. Skim, do not act.\n")
    for p in variants[:20]:
        print("  %s" % p["a"]["canonical_name"])
        print("  %s" % p["b"]["canonical_name"])
        print("      %s\n" % "; ".join(p["reasons"]))
    if len(variants) > 20:
        print("  ... and %d more\n" % (len(variants) - 20))

    print("=" * 72)
    print("DECIDED - DELIBERATELY SEPARATE  (%d)" % len(settled))
    print("=" * 72)
    print("A note on one of these records already explains why they stay apart.\n")
    if args.all:
        for p in settled:
            print("  %s / %s" % (p["a"]["canonical_name"], p["b"]["canonical_name"]))
        print()

    # A name that identifies two items identifies neither: that is a bug in the
    # data whoever introduced it, and it always fails the build.
    #
    # A near-duplicate PAIR is different. The bulk wiki import catalogues names
    # nobody has reconciled against the hand-written entries yet, and hundreds
    # of those land next to an existing bear. Failing the build on them would
    # mean either 245 manual decisions before the suite can run again, or - far
    # more likely - somebody deletes the check. So strict mode guards what it
    # was built to guard: duplicates between two HAND-CURATED records. Pairs
    # involving an unreviewed import are a work queue, not a broken build.
    def imported(item):
        return "Build-A-Bear Wiki" in (item.get("notes") or "")

    curated_pairs = [p for p in needs if not imported(p["a"]) and not imported(p["b"])]
    if len(curated_pairs) < len(needs):
        print("\n%d of those pairs involve an unreviewed catalogue import and are "
              "a review queue, not a build failure.\n"
              "%d are between hand-curated records, which strict mode does fail on."
              % (len(needs) - len(curated_pairs), len(curated_pairs)))

    problems = len(collisions) + len(curated_pairs)
    print("-" * 72)
    print("%d ambiguous name(s) | %d needing a decision | %d flagged but unresolved | "
          "%d probably-different | %d decided"
          % (len(collisions), len(needs), len(open_qs), len(variants), len(settled)))

    if args.strict and problems:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
Condition and completeness multipliers, measured from the sold comps.

    python3 tools/fit_multipliers.py          # print what the data says, change nothing

The multipliers in tools/domain_vocab.py were judgement calls made when the
database held 79 sales: NWT at 1.25, Mint at 1.15. With thousands of dated sales
they can be measured instead, and they disagree - NWT copies of the same bear
sell for about 1.5x the copies whose condition was not stated.

That matters twice. Normalising an NWT sale by 1.25 when the market pays 1.5
leaves it too high, so every NWT comp pulls a used copy's value up. And the
calculator under-prices a NWT copy by the same margin in the other direction.

METHOD
======
Within one item, so a $250 exclusive and a $12 Mini Bean never meet:

  ratio(item, grade) = median price of the item's sales in that grade
                       / median price of its sales in the reference grade

  measured(grade)    = median of those ratios across every item that has at
                       least MIN_PER_CELL sales on both sides

The reference is the grade the engine already treats as 1.0: Good or Unknown
for condition, bare or unknown for completeness. Condition and completeness are
fitted in turn, each with the other's current multipliers divided out, because
a NWT listing is also more often complete - fitted alone, each would claim the
other's premium too.

Then each is shrunk toward its configured value in log space, by how many items
measured it:

  used = exp((n * log(measured) + PRIOR_ITEMS * log(configured)) / (n + PRIOR_ITEMS))

so a grade seen on 255 items is essentially measured, and one seen on six is
mostly the judgement call it started as. Below MIN_ITEMS it is not measured at
all. Two sales cannot imply a 3x premium.

Averages (Terapeak rows standing for several sales), ranged notes and lots are
left out: none of them is one copy in one condition.
"""

import math
import os
import sys
from collections import OrderedDict, defaultdict
from statistics import median

MIN_PER_CELL = 2     # sales an item needs on each side of a ratio
MIN_ITEMS = 5        # items a grade needs before it is measured at all
PRIOR_ITEMS = 10     # weight of the configured value, in items
ROUNDS = 4           # alternating condition / completeness passes

REFERENCE = {"condition": ("Good", "Unknown"), "completeness": ("bare", "unknown")}
FIELD = {"condition": ("condition", "Unknown"), "completeness": ("completeness", "unknown")}


def usable_sales(sales, items, evidence_types):
    lots = {i["id"] for i in items if i.get("is_lot")}
    out = []
    for s in sales:
        if s.get("evidence_type") not in evidence_types or s.get("item_id") in lots:
            continue
        if s.get("ranged") or (s.get("sample_size") or 1) > 1:
            continue
        p = s.get("sold_price")
        if isinstance(p, (int, float)) and p > 0:
            out.append(s)
    return out


def _grade(sale, axis):
    field, default = FIELD[axis]
    return sale.get(field) or default


def _measure(sales, axis, other_mults):
    """{grade: (median ratio, items)} for one axis, the other divided out."""
    other = "completeness" if axis == "condition" else "condition"
    cells = defaultdict(lambda: defaultdict(list))
    for s in sales:
        adj = s["sold_price"] / other_mults.get(_grade(s, other), 1.0)
        cells[s["item_id"]][_grade(s, axis)].append(adj)

    ratios = defaultdict(list)
    for grades in cells.values():
        ref = [p for g in REFERENCE[axis] for p in grades.get(g, ())]
        if len(ref) < MIN_PER_CELL:
            continue
        base = median(ref)
        for g, prices in grades.items():
            if g not in REFERENCE[axis] and len(prices) >= MIN_PER_CELL:
                ratios[g].append(median(prices) / base)
    return {g: (median(r), len(r)) for g, r in ratios.items()}


def _shrink(measured, n, configured):
    w = n / float(n + PRIOR_ITEMS)
    return math.exp(w * math.log(measured) + (1 - w) * math.log(configured))


def fit(sales, items, configured, evidence_types):
    """-> {axis: OrderedDict(grade -> basis)}, basis = configured/measured/items/used.

    configured is {"condition": {grade: mult}, "completeness": {grade: mult}}.
    Grades keep their configured order; the reference grades stay at 1.0.
    """
    usable = usable_sales(sales, items, evidence_types)
    used = {axis: dict(configured[axis]) for axis in configured}
    seen = {}
    for _ in range(ROUNDS):
        for axis in ("condition", "completeness"):
            other = "completeness" if axis == "condition" else "condition"
            seen[axis] = _measure(usable, axis, used[other])
            for g, base in configured[axis].items():
                m = seen[axis].get(g)
                if g in REFERENCE[axis] or not m or m[1] < MIN_ITEMS:
                    used[axis][g] = base
                else:
                    used[axis][g] = _shrink(m[0], m[1], base)

    out = {}
    for axis in ("condition", "completeness"):
        rows = OrderedDict()
        for g, base in configured[axis].items():
            m = seen[axis].get(g)
            measured = g not in REFERENCE[axis] and m and m[1] >= MIN_ITEMS
            rows[g] = OrderedDict([
                ("configured", base),
                ("measured", round(m[0], 3) if measured else None),
                ("items", m[1] if measured else 0),
                ("used", round(used[axis][g], 2)),
            ])
        out[axis] = rows
    return out


def main():
    import json
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(root, "data.json"), encoding="utf-8") as f:
        d = json.load(f)
    basis = d["config"].get("multiplier_basis") or {}
    configured = {
        axis: OrderedDict((g, (basis.get(axis, {}).get(g) or {}).get("configured", v))
                          for g, v in d["config"][axis + "_multipliers"].items())
        for axis in ("condition", "completeness")}
    result = fit(d["sales"], d["items"], configured, d["config"]["market_evidence_types"])
    for axis, rows in result.items():
        print("%s\n  %-15s %10s %9s %6s %6s" % (axis, "grade", "configured", "measured",
                                              "items", "used"))
        for g, r in rows.items():
            print("  %-15s %10.2f %9s %6d %6.2f" % (
                g, r["configured"], "-" if r["measured"] is None else "%.2f" % r["measured"],
                r["items"], r["used"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())

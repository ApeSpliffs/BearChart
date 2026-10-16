#!/usr/bin/env python3
"""
Tests for tools/fit_multipliers.py.

    python3 tools/test_fit_multipliers.py

Synthetic comps with a known premium built in, so each test can say what the
answer should be. Plus one check on the shipped data.json.
"""

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fit_multipliers as FM  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EVIDENCE = ["completed_sale", "collector_report"]
CONFIGURED = {
    "condition": {"NWT": 1.25, "Mint": 1.15, "Good": 1.0, "Unknown": 1.0},
    "completeness": {"complete": 1.15, "some_originals": 1.05, "bare": 1.0, "unknown": 1.0},
}


def sale(item, price, condition="Unknown", completeness="unknown", **kw):
    s = {"item_id": item, "sold_price": price, "condition": condition,
         "completeness": completeness, "evidence_type": "completed_sale"}
    s.update(kw)
    return s


def market(n_items, premium, grade="NWT", base=20.0, per_side=3):
    """n_items bears at different price levels; each grade sells at premium x."""
    sales, items = [], []
    for k in range(n_items):
        item = "bear-%d" % k
        level = base * (1 + k)            # a $20 bear, a $40 bear, ...
        items.append({"id": item})
        for j in range(per_side):
            wobble = 1 + 0.02 * (j - 1)
            sales.append(sale(item, level * wobble))
            sales.append(sale(item, level * premium * wobble, condition=grade))
    return sales, items


def used(result, axis, grade):
    return result[axis][grade]["used"]


class FitTests(unittest.TestCase):
    def test_a_premium_seen_on_many_items_is_measured(self):
        sales, items = market(200, 1.5)
        r = FM.fit(sales, items, CONFIGURED, EVIDENCE)
        self.assertAlmostEqual(r["condition"]["NWT"]["measured"], 1.5, places=2)
        self.assertAlmostEqual(used(r, "condition", "NWT"), 1.5, delta=0.02)
        self.assertEqual(r["condition"]["NWT"]["items"], 200)

    def test_price_level_never_leaks_between_items(self):
        # A $20 bear and a $4000 bear: only the ratio within each one counts.
        sales, items = market(50, 1.4, base=20.0)
        r1 = FM.fit(sales, items, CONFIGURED, EVIDENCE)
        sales, items = market(50, 1.4, base=4000.0)
        r2 = FM.fit(sales, items, CONFIGURED, EVIDENCE)
        self.assertAlmostEqual(r1["condition"]["NWT"]["measured"],
                               r2["condition"]["NWT"]["measured"], places=6)

    def test_too_few_items_keeps_the_configured_value(self):
        sales, items = market(FM.MIN_ITEMS - 1, 3.0)
        r = FM.fit(sales, items, CONFIGURED, EVIDENCE)
        self.assertIsNone(r["condition"]["NWT"]["measured"])
        self.assertEqual(used(r, "condition", "NWT"), 1.25)

    def test_two_sales_cannot_imply_a_3x_premium(self):
        sales, items = market(FM.MIN_ITEMS, 3.0)
        r = FM.fit(sales, items, CONFIGURED, EVIDENCE)
        self.assertAlmostEqual(r["condition"]["NWT"]["measured"], 3.0, places=2)
        # Shrunk most of the way back: five items do not outvote the prior.
        self.assertLess(used(r, "condition", "NWT"), 1.8)
        self.assertGreater(used(r, "condition", "NWT"), 1.25)

    def test_reference_grades_stay_at_one(self):
        sales, items = market(100, 1.5, grade="Good")
        r = FM.fit(sales, items, CONFIGURED, EVIDENCE)
        self.assertEqual(used(r, "condition", "Good"), 1.0)
        self.assertEqual(used(r, "condition", "Unknown"), 1.0)
        self.assertEqual(used(r, "completeness", "unknown"), 1.0)

    def test_a_correlated_premium_is_not_counted_twice(self):
        # Every NWT copy is also complete. The whole 1.5x is condition; a fit of
        # completeness alone would claim it too.
        sales, items = [], []
        for k in range(100):
            item = "bear-%d" % k
            items.append({"id": item})
            level = 10.0 * (1 + k)
            for j in range(3):
                sales.append(sale(item, level))
                sales.append(sale(item, level * 1.5, condition="NWT", completeness="complete"))
                sales.append(sale(item, level * 1.5, condition="NWT"))
                sales.append(sale(item, level, completeness="complete"))
        r = FM.fit(sales, items, CONFIGURED, EVIDENCE)
        self.assertAlmostEqual(used(r, "condition", "NWT"), 1.5, delta=0.05)
        self.assertAlmostEqual(used(r, "completeness", "complete"), 1.0, delta=0.05)

    def test_averages_ranges_lots_and_non_evidence_are_left_out(self):
        sales, items = market(50, 1.5)
        noise = []
        for k in range(50):
            item = "bear-%d" % k
            noise += [sale(item, 9999, condition="NWT", sample_size=12),
                      sale(item, 9999, condition="NWT", ranged=True),
                      sale(item, 9999, condition="NWT", evidence_type="active_listing")]
        items.append({"id": "lot-1", "is_lot": True})
        noise += [sale("lot-1", 1, condition="NWT")] * 3 + [sale("lot-1", 500)] * 3
        r = FM.fit(sales + noise, items, CONFIGURED, EVIDENCE)
        self.assertAlmostEqual(r["condition"]["NWT"]["measured"], 1.5, places=2)

    def test_grades_keep_their_configured_order(self):
        sales, items = market(20, 1.5)
        r = FM.fit(sales, items, CONFIGURED, EVIDENCE)
        self.assertEqual(list(r["condition"]), list(CONFIGURED["condition"]))
        self.assertEqual(list(r["completeness"]), list(CONFIGURED["completeness"]))


class ShippedDataTests(unittest.TestCase):
    def setUp(self):
        with open(os.path.join(ROOT, "data.json"), encoding="utf-8") as f:
            self.cfg = json.load(f)["config"]

    def test_the_shipped_multipliers_are_the_fitted_ones(self):
        basis = self.cfg["multiplier_basis"]
        for axis in ("condition", "completeness"):
            for grade, mult in self.cfg[axis + "_multipliers"].items():
                self.assertEqual(mult, basis[axis][grade]["used"], (axis, grade))

    def test_every_measured_grade_says_how_many_items_measured_it(self):
        for rows in self.cfg["multiplier_basis"].values():
            for grade, r in rows.items():
                if r["measured"] is not None:
                    self.assertGreaterEqual(r["items"], FM.MIN_ITEMS, grade)


if __name__ == "__main__":
    unittest.main(verbosity=1)

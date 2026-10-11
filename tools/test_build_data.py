#!/usr/bin/env python3
"""
Build safety: a build that lost the imported sales must refuse to publish.

    python3 tools/test_build_data.py

tools/imported_sales.json holds almost every comp and stays tracked in git
(owner decision). These tests pin the guard that stops a build without it
from silently overwriting data.json with a fraction of the evidence.
"""

import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))


class ShrinkGuard(unittest.TestCase):

    def test_trips_below_98_percent(self):
        import build_data as B
        B.guard_shrink(1000, 980)          # exactly 98%: allowed
        with self.assertRaises(SystemExit):
            B.guard_shrink(1000, 970)      # 97%
        B.guard_shrink(1000, 970, allow=True)

    def test_allow_shrink_flag_parses(self):
        import build_data as B
        self.assertTrue(B.parse_args(["--allow-shrink"]).allow_shrink)
        self.assertFalse(B.parse_args([]).allow_shrink)

    def test_imported_sales_are_tracked(self):
        out = subprocess.run(["git", "ls-files", "--error-unmatch", "tools/imported_sales.json"],
                             cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(out.returncode, 0, "tools/imported_sales.json must stay in git")
        with open(os.path.join(ROOT, ".gitignore")) as f:
            self.assertNotIn("imported_sales.json", f.read())

    def test_a_build_without_imported_sales_refuses_to_write(self):
        # CI-style: a checkout whose imported_sales.json is gone. The build must
        # stop before touching data.json.
        tmp = tempfile.mkdtemp()
        try:
            os.makedirs(os.path.join(tmp, "tools"))
            shutil.copy(os.path.join(ROOT, "data.json"), os.path.join(tmp, "data.json"))
            before = os.path.getmtime(os.path.join(tmp, "data.json"))
            res = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "build_data.py"),
                                  "--root", tmp, "--as-of", "2026-10-09"],
                                 capture_output=True, text=True)
            self.assertNotEqual(res.returncode, 0, res.stdout + res.stderr)
            self.assertIn("refusing to write", res.stderr + res.stdout)
            self.assertEqual(os.path.getmtime(os.path.join(tmp, "data.json")), before)
            self.assertFalse(os.path.exists(os.path.join(tmp, "data.js")))
        finally:
            shutil.rmtree(tmp)


class ListingsCarryForward(unittest.TestCase):
    """tools/active_listings.json is gitignored, so CI never has it. A skipped
    or failed eBay fetch must not publish an empty deal finder."""

    def setUp(self):
        import build_data as B
        self.B = B
        self.tmp = tempfile.mkdtemp()
        os.makedirs(os.path.join(self.tmp, "tools"))
        self.item = B.ITEMS[0]["id"]
        self.row = {"id": "active-1", "item_id": self.item, "listing_id": "1", "ask_price": 12.0,
                    "currency": "USD", "condition": "Good", "marketplace": "eBay",
                    "evidence_type": "active_listing", "seller": "someone"}

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def write_data(self, listings, fetched):
        with open(os.path.join(self.tmp, "data.json"), "w") as f:
            json.dump({"active_listings": listings, "active_listings_fetched_at": fetched}, f)

    def test_missing_file_carries_forward_the_published_listings(self):
        self.write_data([self.row], "2026-10-01T06:15:00Z")
        with contextlib.redirect_stdout(io.StringIO()) as out:
            listings, fetched = self.B.load_active_listings(self.tmp, "2026-10-08")
        self.assertEqual([l["id"] for l in listings], ["active-1"])
        self.assertEqual(fetched, "2026-10-01T06:15:00Z", "the age stays visible")
        self.assertNotIn("seller", listings[0], "user data is still stripped")
        self.assertIn("carried forward 1 active listing", out.getvalue())

    def test_listings_older_than_the_limit_are_not_carried_forward(self):
        self.write_data([self.row], "2026-10-01T06:15:00Z")
        limit = self.B.V.LISTINGS_MAX_AGE_DAYS
        with contextlib.redirect_stdout(io.StringIO()) as out:
            got = self.B.load_active_listings(self.tmp, "2026-10-%02d" % (1 + limit + 1))
        self.assertEqual(got, ([], None))
        self.assertIn("WARNING: NOT carrying forward 1 active listing", out.getvalue())
        with contextlib.redirect_stdout(io.StringIO()):
            kept, _ = self.B.load_active_listings(self.tmp, "2026-10-%02d" % (1 + limit))
        self.assertEqual(len(kept), 1, "exactly the limit is still carried")
        self.write_data([self.row], None)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(self.B.load_active_listings(self.tmp, "2026-10-02"), ([], None),
                             "undated listings cannot prove their age")

    def test_the_limit_is_published_for_the_pages(self):
        with open(os.path.join(ROOT, "data.json")) as f:
            d = json.load(f)
        self.assertEqual(d["config"]["listings_max_age_days"], self.B.V.LISTINGS_MAX_AGE_DAYS)

    def test_a_present_file_is_authoritative(self):
        self.write_data([self.row], "2026-10-01T06:15:00Z")
        fresh = dict(self.row, id="active-2", listing_id="2")
        with open(os.path.join(self.tmp, "tools", "active_listings.json"), "w") as f:
            json.dump({"fetched_at": "2026-10-10T06:15:00Z", "listings": [fresh]}, f)
        listings, fetched = self.B.load_active_listings(self.tmp)
        self.assertEqual([l["id"] for l in listings], ["active-2"])
        self.assertEqual(fetched, "2026-10-10T06:15:00Z")

    def test_nothing_to_carry_is_still_empty(self):
        self.write_data([], None)
        self.assertEqual(self.B.load_active_listings(self.tmp), ([], None))
        os.remove(os.path.join(self.tmp, "data.json"))
        self.assertEqual(self.B.load_active_listings(self.tmp), ([], None))

    def test_the_committed_data_keeps_its_listings(self):
        with open(os.path.join(ROOT, "data.json")) as f:
            d = json.load(f)
        self.assertTrue(d["active_listings"], "data.json should carry listings")
        self.assertTrue(d["active_listings_fetched_at"])


if __name__ == "__main__":
    unittest.main()

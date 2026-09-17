#!/usr/bin/env python3
"""No eBay user data may reach the published site.

data.json ships to a public static host, so anything user-identifying that
lands in it is published - and unpublishing means a rebuild and a redeploy.
ebay_active.py no longer collects seller usernames, but a listings file
written before that change still has them, so build_data.py strips them on the
way in. These tests hold both ends of that.
"""

import json
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_data  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class StripsUserDataOnLoad(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        os.makedirs(os.path.join(self.tmp, "tools"))
        self.item_id = build_data.ITEMS[0]["id"]

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def write(self, listing):
        path = os.path.join(self.tmp, "tools", "active_listings.json")
        with open(path, "w") as f:
            json.dump({"fetched_at": "2026-01-01", "listings": [listing]}, f)

    def legacy_listing(self, **extra):
        row = {
            "id": "active-1", "item_id": self.item_id, "listing_id": "1",
            "title": "Build-A-Bear Something", "ask_price": 10.0, "currency": "USD",
            "condition": "Unknown", "marketplace": "eBay",
            "evidence_type": "active_listing",
        }
        row.update(extra)
        return row

    def test_a_legacy_seller_username_is_stripped(self):
        self.write(self.legacy_listing(seller="someseller"))
        listings, _ = build_data.load_active_listings(self.tmp)
        self.assertEqual(len(listings), 1)
        self.assertNotIn("seller", listings[0])
        self.assertNotIn("someseller", json.dumps(listings[0]))

    def test_every_known_user_field_is_stripped(self):
        self.write(self.legacy_listing(**{f: "x" for f in build_data.USER_DATA_FIELDS}))
        listings, _ = build_data.load_active_listings(self.tmp)
        for field in build_data.USER_DATA_FIELDS:
            self.assertNotIn(field, listings[0])

    def test_the_listing_itself_survives(self):
        """Stripping must not quietly drop the asking price we came for."""
        self.write(self.legacy_listing(seller="someseller"))
        listings, fetched = build_data.load_active_listings(self.tmp)
        self.assertEqual(listings[0]["ask_price"], 10.0)
        self.assertEqual(listings[0]["evidence_type"], "active_listing")
        self.assertEqual(fetched, "2026-01-01")


class ShippedDataIsClean(unittest.TestCase):
    def test_data_json_carries_no_user_fields(self):
        with open(os.path.join(ROOT, "data.json")) as f:
            raw = f.read()
        for field in build_data.USER_DATA_FIELDS:
            self.assertNotIn('"%s"' % field, raw,
                             "%s reached data.json, which is published" % field)


if __name__ == "__main__":
    unittest.main(verbosity=1)

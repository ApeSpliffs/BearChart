#!/usr/bin/env python3
"""
Tests for the eBay Browse adapter.

    python3 tools/test_eb.py

No network. The searcher is injected, so every eBay response here is a fixture
shaped like a real Browse API itemSummary payload.
"""

import io
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ebay_active as eb  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def summary(item_id, title, price, **kw):
    """A Browse API item_summary, trimmed to the fields the adapter reads."""
    s = {
        "itemId": "v1|%s|0" % item_id,
        "legacyItemId": item_id,
        "title": title,
        "price": {"value": str(price), "currency": "USD"},
        "itemWebUrl": "https://www.eb.com/itm/%s" % item_id,
        "condition": kw.get("condition", "Pre-Owned"),
        "buyingOptions": kw.get("buying_options", ["FIXED_PRICE"]),
        "seller": {"username": kw.get("seller", "someseller")},
        "image": {"imageUrl": kw.get("image", "https://i.ebayimg.com/x.jpg")},
    }
    if kw.get("no_price"):
        s.pop("price")
    return s


class Args:
    def __init__(self, **kw):
        self.client_id = None
        self.client_secret = None
        self.limit = kw.get("limit", 5)
        self.per_item = kw.get("per_item", 20)
        self.item = kw.get("item")
        self.query = kw.get("query")
        self.priced_only = kw.get("priced_only", False)
        self.fuzzy = kw.get("fuzzy", False)
        self.dry = kw.get("dry", False)
        self.images = kw.get("images", False)
        self.loose = kw.get("loose", False)
        self.with_year = kw.get("with_year", False)
        self.print_queries = kw.get("print_queries", False)


class NormalisationTests(unittest.TestCase):
    def setUp(self):
        self.item = {"id": "lucky-kitty", "canonical_name": "Lucky Kitty"}

    def test_a_listing_is_always_marked_as_an_asking_price(self):
        rec = eb.normalise_listing(summary("111", "Build-A-Bear Lucky Kitty", 99.99), self.item)
        self.assertEqual(rec["evidence_type"], "active_listing")
        # The field is named ask_price, not sold_price - a listing cannot be
        # mistaken for a sale even by a careless reader.
        self.assertIn("ask_price", rec)
        self.assertNotIn("sold_price", rec)

    def test_price_and_provenance_are_captured(self):
        rec = eb.normalise_listing(summary("111", "Build-A-Bear Lucky Kitty", 99.99), self.item)
        self.assertEqual(rec["ask_price"], 99.99)
        self.assertEqual(rec["listing_id"], "111")
        self.assertEqual(rec["marketplace"], "eBay")
        self.assertEqual(rec["source_url"], "https://www.eb.com/itm/111")
        self.assertEqual(rec["seller"], "someseller")

    def test_condition_is_normalised_from_ebay_wording(self):
        rec = eb.normalise_listing(
            summary("1", "Build-A-Bear Lucky Kitty", 10, condition="New with tags"), self.item)
        self.assertEqual(rec["condition"], "NWT")
        rec = eb.normalise_listing(
            summary("2", "Build-A-Bear Lucky Kitty", 10, condition="Pre-Owned"), self.item)
        self.assertEqual(rec["condition"], "Good")

    def test_listings_without_a_price_are_dropped(self):
        self.assertIsNone(
            eb.normalise_listing(summary("1", "Build-A-Bear Lucky Kitty", 0, no_price=True), self.item))

    def test_image_falls_back_to_a_thumbnail(self):
        s = summary("1", "Build-A-Bear Lucky Kitty", 10)
        s.pop("image")
        s["thumbnailImages"] = [{"imageUrl": "https://i.ebayimg.com/thumb.jpg"}]
        self.assertEqual(eb.image_of(s), "https://i.ebayimg.com/thumb.jpg")

    def test_query_building_is_specific(self):
        q = eb.build_query({"canonical_name": "Vanilla Fudge Bunny", "release_year": 2005})
        self.assertIn("build-a-bear", q)
        self.assertIn("Vanilla Fudge Bunny", q)
        # The year is opt-in now: eBay ANDs keywords, and few sellers type it.
        self.assertIn("2005", eb.build_query(
            {"canonical_name": "Vanilla Fudge Bunny", "release_year": 2005}, with_year=True))

    def test_query_strips_parenthetical_qualifiers(self):
        q = eb.build_query({"canonical_name": "Mothman (Mini Beans)", "release_year": 2025})
        self.assertNotIn("(", q)
        self.assertIn("Mothman", q)


class RunTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.original = eb.OUT
        eb.OUT = os.path.join(self.tmp, "active_listings.json")
        self.original_delay = eb.DELAY_SECONDS
        eb.DELAY_SECONDS = 0

    def tearDown(self):
        eb.OUT = self.original
        eb.DELAY_SECONDS = self.original_delay

    def capture(self, args, searcher):
        buf = io.StringIO()
        stdout = sys.stdout
        sys.stdout = buf
        try:
            code = eb.run(args, searcher=searcher, token="fake")
        finally:
            sys.stdout = stdout
        return code, buf.getvalue()

    def written(self):
        with open(eb.OUT) as f:
            return json.load(f)

    def test_listings_are_written_with_a_warning_and_a_timestamp(self):
        def searcher(q):
            return {"itemSummaries": [summary("1", "Build-A-Bear Lucky Kitty", 120)]}
        self.capture(Args(item="lucky-kitty"), searcher)
        payload = self.written()
        self.assertIn("Never sold data", payload["warning"])
        self.assertTrue(payload["fetched_at"])
        self.assertEqual(len(payload["listings"]), 1)
        self.assertEqual(payload["listings"][0]["evidence_type"], "active_listing")

    def test_every_written_row_is_an_active_listing(self):
        def searcher(q):
            return {"itemSummaries": [summary(str(i), "Build-A-Bear Lucky Kitty", 10 + i) for i in range(5)]}
        self.capture(Args(item="lucky-kitty"), searcher)
        for row in self.written()["listings"]:
            self.assertEqual(row["evidence_type"], "active_listing")

    def test_duplicate_listing_ids_are_collapsed(self):
        def searcher(q):
            return {"itemSummaries": [summary("1", "Build-A-Bear Lucky Kitty", 100),
                                      summary("1", "Build-A-Bear Lucky Kitty", 100)]}
        self.capture(Args(item="lucky-kitty"), searcher)
        self.assertEqual(len(self.written()["listings"]), 1)

    def test_free_text_search_declines_unidentifiable_titles(self):
        def searcher(q):
            return {"itemSummaries": [
                summary("1", "Build-A-Bear Lucky Kitty 1999", 120),
                summary("2", "Completely Unrelated Garden Gnome", 15),
            ]}
        code, out = self.capture(Args(query="lucky kitty"), searcher)
        rows = self.written()["listings"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["item_id"], "lucky-kitty")
        self.assertIn("could not be matched", out)

    def test_dry_run_writes_nothing(self):
        def searcher(q):
            return {"itemSummaries": [summary("1", "Build-A-Bear Lucky Kitty", 100)]}
        code, out = self.capture(Args(item="lucky-kitty", dry=True), searcher)
        self.assertIn("dry run", out)
        self.assertFalse(os.path.exists(eb.OUT))

    def test_an_empty_result_writes_nothing(self):
        code, out = self.capture(Args(item="lucky-kitty"), lambda q: {"itemSummaries": []})
        self.assertIn("nothing to write", out)
        self.assertFalse(os.path.exists(eb.OUT))

    def test_repeated_api_failures_stop_the_run(self):
        calls = []

        def searcher(q):
            calls.append(q)
            raise eb.EbayError("boom")

        code, out = self.capture(Args(limit=50), searcher)
        self.assertLessEqual(len(calls), 3, "should give up after 3 failures")

    def test_unknown_item_id_is_rejected(self):
        with self.assertRaises(SystemExit):
            self.capture(Args(item="no-such-item"), lambda q: {"itemSummaries": []})


class SafetyTests(unittest.TestCase):
    """The guarantee that matters: asking prices can never become a valuation."""

    def test_the_engine_config_excludes_active_listings(self):
        with open(os.path.join(ROOT, "data.json")) as f:
            data = json.load(f)
        self.assertNotIn("active_listing", data["config"]["market_evidence_types"])
        self.assertNotIn("active_listing", data["config"]["strong_evidence_types"])

    def test_active_listings_are_stored_apart_from_sales(self):
        with open(os.path.join(ROOT, "data.json")) as f:
            data = json.load(f)
        self.assertIn("active_listings", data)
        for s in data["sales"]:
            self.assertNotEqual(s["evidence_type"], "active_listing")
        for listing in data.get("active_listings") or []:
            self.assertEqual(listing["evidence_type"], "active_listing")
            self.assertNotIn("sold_price", listing)



class ImageAttachTests(RunTests):
    """--images is opt-in and never overwrites a photo that already exists."""

    def setUp(self):
        super().setUp()
        self.orig_root = eb.ROOT
        eb.ROOT = self.tmp
        os.makedirs(os.path.join(self.tmp, "tools"), exist_ok=True)
        # run() reads data.json from the real project, so point ROOT back for it
        # only while reading by copying the file across.
        import shutil
        shutil.copy(os.path.join(self.orig_root, "data.json"),
                    os.path.join(self.tmp, "data.json"))

    def tearDown(self):
        eb.ROOT = self.orig_root
        super().tearDown()

    def overrides(self):
        with open(os.path.join(self.tmp, "tools", "image_overrides.json")) as f:
            return json.load(f)

    def test_no_photos_are_attached_without_the_flag(self):
        def searcher(q):
            return {"itemSummaries": [summary("1", "Build-A-Bear Lucky Kitty", 100)]}
        self.capture(Args(item="lucky-kitty"), searcher)
        self.assertFalse(os.path.exists(
            os.path.join(self.tmp, "tools", "image_overrides.json")))

    def test_the_flag_attaches_a_photo_with_its_credit_and_source(self):
        def searcher(q):
            return {"itemSummaries": [summary("1", "Build-A-Bear Lucky Kitty", 100)]}
        self.capture(Args(item="lucky-kitty", images=True), searcher)
        row = self.overrides()["lucky-kitty"]
        self.assertEqual(row["image_url"], "https://i.ebayimg.com/x.jpg")
        self.assertEqual(row["image_credit"], "eBay listing photo")
        self.assertEqual(row["image_source"], "https://www.eb.com/itm/1")

    def test_an_existing_photo_is_never_overwritten(self):
        import json as _json
        path = os.path.join(self.tmp, "tools", "image_overrides.json")
        with open(path, "w") as f:
            _json.dump({"lucky-kitty": {"image_url": "/images/mine.jpg",
                                        "image_credit": "Jay's Retro Exchange",
                                        "image_source": None}}, f)

        def searcher(q):
            return {"itemSummaries": [summary("1", "Build-A-Bear Lucky Kitty", 100)]}
        self.capture(Args(item="lucky-kitty", images=True), searcher)
        self.assertEqual(self.overrides()["lucky-kitty"]["image_url"], "/images/mine.jpg")


class TitleConfirmationTests(unittest.TestCase):
    """eBay answers about the plush aisle. We asked about one bear."""

    CAT = {"id": "kennel-pals-calico-cat", "canonical_name": "Kennel Pals Calico Cat",
           "aliases": ["Calico Cat"]}
    MINI = {"id": "kuromi-mini-beans", "canonical_name": "Kuromi", "mini_bean": True}
    FULL = {"id": "kuromi", "canonical_name": "Kuromi"}

    def ok(self, item, title, **kw):
        return eb.title_confirms(item, title, **kw)[0]

    def test_accepts_the_item_it_searched_for(self):
        self.assertTrue(self.ok(self.CAT, "Build-A-Bear Kennel Pals Calico Cat 2001 Plush"))

    def test_rejects_a_different_animal_from_the_same_search(self):
        self.assertFalse(self.ok(self.CAT, "Build-A-Bear Kennel Pals Dalmatian Puppy"))

    def test_rejects_a_multi_item_lot(self):
        self.assertFalse(self.ok(self.CAT, "Build-A-Bear Lot of 5 Cats Calico Kennel Pals"))

    def test_rejects_an_unbranded_plush(self):
        self.assertFalse(self.ok(self.CAT, "Kennel Pals Calico Cat Stuffed Animal"))

    def test_loose_allows_an_unbranded_plush(self):
        self.assertTrue(self.ok(self.CAT, "Kennel Pals Calico Cat Stuffed Animal", loose=True))

    def test_an_alias_is_proof_enough(self):
        self.assertTrue(self.ok(self.CAT, "Buildabear Calico Cat retired"))

    def test_mini_beans_never_confirm_a_full_size_item(self):
        self.assertFalse(self.ok(self.FULL, "Build-A-Bear Mini Beans Kuromi"))

    def test_a_full_size_listing_never_confirms_a_mini_bean(self):
        self.assertFalse(self.ok(self.MINI, "Build-A-Bear Kuromi 18 inch"))

    def test_a_name_with_nothing_distinctive_is_declined_not_guessed(self):
        ok, why = eb.title_confirms({"canonical_name": "Bear"}, "Build-A-Bear Bear")
        self.assertFalse(ok)
        self.assertIn("generic", why)


class QueryTests(unittest.TestCase):
    def test_catalogue_version_markers_are_stripped(self):
        # No seller types "V2". Leaving it in ANDs the query into zero results.
        self.assertEqual(eb.build_query({"canonical_name": "Polar Bear V2"}),
                         "build-a-bear Polar Bear")
        self.assertEqual(eb.build_query({"canonical_name": "Polar Bear II"}),
                         "build-a-bear Polar Bear")

    def test_mini_beans_are_named_in_the_query(self):
        self.assertIn("mini beans",
                      eb.build_query({"canonical_name": "Kuromi", "mini_bean": True}))

    def test_the_year_is_off_by_default(self):
        item = {"canonical_name": "Elmo", "release_year": 2004}
        self.assertNotIn("2004", eb.build_query(item))
        self.assertIn("2004", eb.build_query(item, with_year=True))

    def test_lots_are_not_searched_for(self):
        data = {"items": [{"id": "a", "canonical_name": "Real Bear"},
                          {"id": "b", "canonical_name": "Mixed Lot", "is_lot": True},
                          {"id": "c", "canonical_name": "Shirt + Shoes"}]}
        got = [i["id"] for i in eb.load_items(Args(), data)]
        self.assertEqual(got, ["a"])


if __name__ == "__main__":
    unittest.main(verbosity=2)

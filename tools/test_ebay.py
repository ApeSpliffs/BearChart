#!/usr/bin/env python3
"""
Tests for the eBay Browse adapter.

    python3 tools/test_eb.py

No network. The searcher is injected, so every eBay response here is a fixture
shaped like a real Browse API itemSummary payload.
"""

import contextlib
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
    if "shipping" in kw:
        s["shippingOptions"] = kw["shipping"]
    return s


def fixed(v):
    return {"shippingCostType": "FIXED", "shippingCost": {"value": str(v), "currency": "USD"}}


class Args:
    def __init__(self, **kw):
        self.client_id = None
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

    def test_seller_username_is_never_captured(self):
        """eBay user data must not enter the pipeline at all.

        The fixture supplies a seller username; holding it would put every
        listing under the Marketplace Account Deletion obligation, on a site
        that can only forget someone by rebuilding and redeploying.
        """
        rec = eb.normalise_listing(summary("111", "Build-A-Bear Lucky Kitty", 99.99), self.item)
        self.assertNotIn("seller", rec)
        self.assertNotIn("someseller", json.dumps(rec))

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

    def test_shipping_takes_the_cheapest_fixed_option(self):
        s = summary("1", "Build-A-Bear Lucky Kitty", 40, shipping=[fixed(12.5), fixed(8)])
        self.assertEqual(eb.shipping_of(s), (8.0, "fixed"))

    def test_free_shipping_is_zero(self):
        s = summary("1", "Build-A-Bear Lucky Kitty", 40, shipping=[fixed(0)])
        self.assertEqual(eb.shipping_of(s), (0.0, "free"))

    def test_calculated_or_missing_shipping_is_not_invented(self):
        calc = summary("1", "x", 40, shipping=[{"shippingCostType": "CALCULATED"}])
        self.assertEqual(eb.shipping_of(calc), (None, "calculated"))
        self.assertEqual(eb.shipping_of(summary("1", "x", 40)), (None, "unknown"))

    def test_the_record_carries_what_the_buyer_pays(self):
        rec = eb.normalise_listing(
            summary("1", "Build-A-Bear Lucky Kitty", 40, shipping=[fixed(12)]), self.item)
        self.assertEqual(rec["ship_price"], 12.0)
        self.assertEqual(rec["ship_type"], "fixed")
        self.assertEqual(rec["buyer_total"], 52.0)
        rec = eb.normalise_listing(summary("2", "Build-A-Bear Lucky Kitty", 40), self.item)
        self.assertIsNone(rec["buyer_total"])
        self.assertEqual(rec["ship_type"], "unknown")

    def test_an_operator_listing_is_flagged_and_the_name_dropped(self):
        ops = {"ebay": {"jaysretro"}}
        rec = eb.normalise_listing(
            summary("1", "Build-A-Bear Lucky Kitty", 40, seller="JaysRetro"), self.item, ops)
        self.assertTrue(rec["seller_is_operator"])
        self.assertNotIn("JaysRetro", json.dumps(rec))
        self.assertNotIn("jaysretro", json.dumps(rec).lower().replace("seller_is_operator", ""))
        rec = eb.normalise_listing(
            summary("2", "Build-A-Bear Lucky Kitty", 40, seller="someoneelse"), self.item, ops)
        self.assertFalse(rec["seller_is_operator"])

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

    def test_a_failed_item_keeps_its_published_listings_with_their_real_date(self):
        # One query eBay keeps refusing must not empty the deal finder, nor
        # dress old asks up as today's.
        import datetime
        import shutil
        now = datetime.datetime.now(datetime.timezone.utc)
        stamp = lambda t: t.strftime("%Y-%m-%dT%H:%M:%SZ")
        orig_root = eb.ROOT
        try:
            eb.ROOT = self.tmp
            with open(os.path.join(orig_root, "data.json")) as f:
                data = json.load(f)
            eligible = eb.load_items(Args(limit=5), data)[:5]
            failing = eligible[1]["id"]
            data["active_listings"] = [
                {"id": "old-1", "item_id": failing, "listing_id": "old1", "ask_price": 9.0,
                 "evidence_type": "active_listing", "title": "x", "condition": "Good"},
                {"id": "old-2", "item_id": failing, "listing_id": "old2", "ask_price": 9.5,
                 "evidence_type": "active_listing", "title": "x", "condition": "Good",
                 "fetched_at": stamp(now - datetime.timedelta(days=30))}]
            data["active_listings_fetched_at"] = stamp(now - datetime.timedelta(hours=2))
            with open(os.path.join(self.tmp, "data.json"), "w") as f:
                json.dump(data, f)
            os.makedirs(os.path.join(self.tmp, "tools"), exist_ok=True)
            for name in ("operator_identities.json",):
                src = os.path.join(orig_root, "tools", name)
                if os.path.exists(src):
                    shutil.copy(src, os.path.join(self.tmp, "tools", name))
            calls = []

            def searcher(q):
                calls.append(q)
                if len(calls) == 2:
                    raise eb.EbayError("boom")
                return {"itemSummaries": []}

            with contextlib.redirect_stderr(io.StringIO()):
                code, out = self.capture(Args(limit=5), searcher)
        finally:
            eb.ROOT = orig_root
        self.assertEqual(code, 0)
        rows = self.written()["listings"]
        self.assertEqual([r["id"] for r in rows], ["old-1"], "the 30-day-old row is refused")
        self.assertEqual(rows[0]["fetched_at"], data["active_listings_fetched_at"],
                         "carried with the date it was really fetched")
        self.assertIn("::warning::eBay queries failed for 1 item(s): " + failing, out)
        self.assertIn("::warning::NOT carrying forward 1 listing(s) older than", out)

    def test_carry_forward_for_stamps_and_caps(self):
        data = {"active_listings_fetched_at": "2026-10-08T06:00:00Z", "active_listings": [
            {"id": "a", "item_id": "x"}, {"id": "b", "item_id": "x", "fetched_at": "2026-10-07T23:00:00Z"},
            {"id": "c", "item_id": "y"}]}
        kept, refused = eb.carry_forward_for(data, ["x"], as_of="2026-10-08T10:00:00Z")
        self.assertEqual([r["id"] for r in kept], ["a"])
        self.assertEqual(kept[0]["fetched_at"], "2026-10-08T06:00:00Z")
        self.assertEqual([r["id"] for r in refused], ["b"], "11 hours old: refused")
        kept, refused = eb.carry_forward_for(data, ["x"], as_of="2026-10-08T12:01:00Z")
        self.assertEqual(kept, [], "past six hours nothing is carried")

    def test_when_every_query_fails_and_nothing_is_published_nothing_is_written(self):
        orig_root = eb.ROOT
        try:
            eb.ROOT = self.tmp
            with open(os.path.join(orig_root, "data.json")) as f:
                data = json.load(f)
            data["active_listings"] = []
            with open(os.path.join(self.tmp, "data.json"), "w") as f:
                json.dump(data, f)

            def searcher(q):
                raise eb.EbayError("boom")
            with contextlib.redirect_stderr(io.StringIO()):
                code, out = self.capture(Args(limit=2), searcher)
        finally:
            eb.ROOT = orig_root
        self.assertEqual(code, 1)
        self.assertFalse(os.path.exists(eb.OUT))

    def test_failures_must_be_consecutive_to_stop_the_run(self):
        calls = []

        def searcher(q):
            calls.append(q)
            if len(calls) % 2 == 0:
                raise eb.EbayError("boom")
            return {"itemSummaries": []}

        with contextlib.redirect_stderr(io.StringIO()):
            self.capture(Args(limit=8), searcher)
        self.assertGreater(len(calls), 3, "alternating failures are not consecutive")

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

    def test_a_happy_meal_toy_is_refused_however_mcdonalds_is_spelled(self):
        fudge = {"id": "vanilla-fudge-bunny", "canonical_name": "Vanilla Fudge Bunny"}
        for t in ("McDonald's Build A Bear Vanilla Fudge Bunny",
                  "Mc Donald’s Build A Bear Vanilla Fudge Bunny & Spring Bear"):
            self.assertFalse(self.ok(fudge, t), t)

    def test_an_outfit_named_before_the_bear_is_the_outfit(self):
        pup = {"id": "patchwork-hearts-puppy", "canonical_name": "Patchwork Hearts Puppy"}
        ok, why = eb.title_confirms(
            pup, "Build a Bear Pink Outfit Complete Patchwork Puppy Kitten Hearts Pink Slippers")
        self.assertFalse(ok)
        self.assertIn("clothing", why)

    def test_a_bear_named_first_and_wearing_clothes_is_still_the_bear(self):
        pup = {"id": "patchwork-hearts-puppy", "canonical_name": "Patchwork Hearts Puppy"}
        umb = {"id": "umbreon", "canonical_name": "Umbreon"}
        bat = {"id": "halloween-teddy", "canonical_name": "Halloween Teddy"}
        self.assertTrue(self.ok(pup, "Build a Bear Patchwork Hearts Puppy w/ Pink Outfit"))
        self.assertTrue(self.ok(umb, "UMBREON Build A Bear Plush - Includes sleeper, cape"))
        self.assertTrue(self.ok(bat, "Build a Bear w/ Pumpkin Costume Halloween Teddy"))

    def catalogue(self, *items):
        items = [dict(i) for i in items]
        eb.mark_generic_aliases(items)
        return items

    def test_a_title_naming_a_different_catalogued_item_is_refused(self):
        fudge, _ = self.catalogue(
            {"id": "vanilla-fudge-bunny", "canonical_name": "Vanilla Fudge Bunny"},
            {"id": "vanilla-cream-bunny", "canonical_name": "Vanilla Cream Bunny"})
        ok, why = eb.title_confirms(
            fudge, "Build-A-Bear Vanilla Cream Bunny Plush HTF Vanilla Fudge Trio 16\"")
        self.assertFalse(ok)
        self.assertIn("vanilla cream bunny", why)
        self.assertTrue(self.ok(fudge, "Build-A-Bear Vanilla Fudge Bunny 16\""))

    def test_a_later_version_is_another_item(self):
        first, _ = self.catalogue(
            {"id": "centennial-teddy", "canonical_name": "Centennial Teddy"},
            {"id": "centennial-teddy-bear-iii", "canonical_name": "Centennial Teddy Bear III"})
        self.assertFalse(self.ok(first, "Build-A-Bear 2002 Centennial Teddy Bear III"))

    def test_a_franchise_namesake_is_context_but_a_sibling_is_not(self):
        sonic, knuckles, _ = self.catalogue(
            {"id": "sonic", "canonical_name": "Sonic the Hedgehog", "franchise": "Sonic"},
            {"id": "knuckles", "canonical_name": "Knuckles", "franchise": "Sonic"},
            {"id": "super-sonic", "canonical_name": "Super Sonic", "franchise": "Sonic"})
        self.assertTrue(self.ok(knuckles, "Sonic the Hedgehog 2 Knuckles Build-A-Bear Plush"))
        self.assertFalse(self.ok(sonic, "Sonic The Hedgehog 2 Build A Bear Super Sonic"))

    def test_the_franchise_in_front_of_the_name_is_not_another_item(self):
        trixie, _ = self.catalogue(
            {"id": "trixie", "canonical_name": "Trixie Lulamoon", "franchise": "My Little Pony"},
            {"id": "mlp-trixie", "canonical_name": "My Little Pony Trixie",
             "franchise": "My Little Pony"})
        self.assertTrue(self.ok(trixie, "Build A Bear My Little Pony Trixie Lulamoon Plush"))

    def test_a_name_made_of_this_items_own_words_is_not_another_item(self):
        teddy, _ = self.catalogue(
            {"id": "classic-brown-teddy", "canonical_name": "Classic Brown Teddy"},
            {"id": "teddy-bear", "canonical_name": "Teddy Bear"})
        self.assertTrue(self.ok(teddy, "Build-A-Bear Classic Brown Teddy Bear 16\""))

    def test_an_alias_shared_with_one_other_item_is_not_proof(self):
        cat, _ = self.catalogue(
            self.CAT, {"id": "promise-pets-calico-cat", "canonical_name": "Promise Pets Calico Cat"})
        self.assertFalse(self.ok(cat, "Build A Bear Workshop Calico Cat Green Eyes 11\" Plush"))
        self.assertFalse(self.ok(cat, "Build-A-Bear Promise Pets Calico Cat Plush"))
        self.assertTrue(self.ok(cat, "Build-A-Bear Kennel Pals Calico Cat 2001 Plush"))

    def test_a_plush_set_is_a_lot(self):
        k = {"id": "knuckles", "canonical_name": "Knuckles"}
        self.assertFalse(self.ok(k, "Build A Bear Sonic 2 Plush Set Sonic Tails Knuckles"))


class ImagePolicyTests(unittest.TestCase):
    def test_images_are_off_by_default_and_never_in_the_daily_jobs(self):
        self.assertFalse(eb.build_parser().parse_args([]).images)
        for rel in (".github/workflows/daily.yml", "tools/daily_update.sh"):
            path = os.path.join(ROOT, rel)
            if os.path.exists(path):
                with open(path) as f:
                    self.assertNotIn("--images", f.read(), rel)

    def test_the_build_skips_hotlinked_ebay_images(self):
        import build_data as B
        tmp = tempfile.mkdtemp()
        os.makedirs(os.path.join(tmp, "tools"))
        item = B.ITEMS[0]
        before = item.get("image_url")
        with open(os.path.join(tmp, "tools", "image_overrides.json"), "w") as f:
            json.dump({item["id"]: {"image_url": "https://i.ebayimg.com/images/g/x/s-l500.jpg",
                                    "image_credit": "eBay listing photo"}}, f)
        os.environ.pop("BEARCHART_ALLOW_HOTLINKED_IMAGES", None)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(B.apply_image_overrides(tmp), 0)
        self.assertEqual(item.get("image_url"), before)

    def test_the_shipped_data_carries_no_ebay_image(self):
        with open(os.path.join(ROOT, "data.json")) as f:
            raw = f.read()
        self.assertNotIn("ebayimg.com", raw)


class CredentialTests(unittest.TestCase):
    def test_client_secret_is_not_a_cli_flag(self):
        # A secret on the command line lands in shell history and `ps`.
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            eb.build_parser().parse_args(["--client-secret", "x"])

    def test_client_id_is_still_a_flag(self):
        self.assertEqual(eb.build_parser().parse_args(["--client-id", "abc"]).client_id, "abc")


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

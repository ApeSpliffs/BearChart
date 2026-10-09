#!/usr/bin/env python3
"""
Tests for the generated item pages.

The point of these pages is that a search engine reads them without running
any JavaScript. That makes the title, the meta description and the structured
data into published claims - read by more people than the page itself, by
anyone who only ever sees a search result. So they get held to the same rule as
everything else here: no value without evidence.
"""

import json
import os
import re
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_pages as bp  # noqa: E402

PRICED = {"id": "test-priced", "canonical_name": "Test Bear", "release_year": 2001,
          "species": "Bear", "category": "Stuffed Animal", "aliases": ["Testy"]}
UNPRICED = {"id": "test-unpriced", "canonical_name": "Unknown Bear", "release_year": 1999,
            "species": "Bear", "category": "Stuffed Animal", "aliases": []}

VAL = {"has_value": True, "fair_market": 42.5, "median_raw": 45.0,
       "range_low": 38.0, "range_high": 55.0, "comparable_count": 6,
       "confidence": "MEDIUM"}
NO_VAL = {"has_value": False, "fair_market": None, "comparable_count": 0,
          "confidence": "VERY LOW"}

SALES = [{"sale_date": "2024-03-02", "sold_price": 45.0, "condition": "Good",
          "marketplace": "eBay"}]


def page(item, val, sales=None, base="https://example.test"):
    return bp.page_html(item, val, sales or [], base, "Independent. Not affiliated.")


class MoneyTests(unittest.TestCase):
    def test_cents_below_a_hundred(self):
        self.assertEqual(bp.money(25.6), "$25.60")
        self.assertEqual(bp.money(14.539), "$14.54")

    def test_whole_dollars_above_a_hundred(self):
        # Matching common.js: cents on a $204 estimate are false precision.
        self.assertEqual(bp.money(204.49), "$204")
        self.assertEqual(bp.money(1500), "$1,500")

    def test_nothing_formats_as_nothing(self):
        self.assertIsNone(bp.money(None))


class HonestyTests(unittest.TestCase):
    """A page with no evidence must not imply a price anywhere."""

    def setUp(self):
        self.html = page(UNPRICED, NO_VAL)

    def test_the_description_says_there_is_no_value(self):
        desc = re.search(r'name="description" content="([^"]*)"', self.html).group(1)
        self.assertIn("No sold data recorded yet", desc)
        self.assertNotIn("$", desc)

    def test_the_title_carries_no_figure(self):
        title = re.search(r"<title>([^<]*)</title>", self.html).group(1)
        self.assertNotIn("$", title)

    def test_the_body_says_so_in_words(self):
        self.assertIn("publishes <strong>no value</strong>", self.html)

    def test_the_structured_data_carries_no_price_and_no_offer(self):
        node = json.loads(re.search(
            r'application/ld\+json">\s*(\{.*?\})\s*</script>', self.html, re.S).group(1))
        self.assertNotIn("offers", node)
        # Check the KEYS, not the serialised text: the description legitimately
        # contains the words "price guide", and an assertion that trips on its
        # own prose tests nothing.
        for key in node:
            self.assertNotIn("price", key.lower())
            self.assertNotIn("offer", key.lower())


class PricedPageTests(unittest.TestCase):
    def setUp(self):
        self.html = page(PRICED, VAL, SALES)

    def test_the_value_is_in_the_html_before_any_javascript(self):
        # The whole reason these files exist: the figure is in the markup, not
        # assembled by a script a crawler may never run.
        self.assertIn("$42.50", self.html)
        self.assertIn("Estimated market value", self.html)

    def test_the_description_states_the_evidence_behind_it(self):
        desc = re.search(r'name="description" content="([^"]*)"', self.html).group(1)
        self.assertIn("$42.50", desc)
        self.assertIn("6 recorded sales", desc)
        self.assertIn("Medium confidence", desc)

    def test_a_single_sale_is_not_called_sales(self):
        one = dict(VAL, comparable_count=1)
        self.assertIn("1 recorded sale.", bp.describe(PRICED, one))

    def test_recorded_sales_are_listed(self):
        self.assertIn("2024-03-02", self.html)
        self.assertIn("eBay", self.html)

    def test_even_a_priced_page_never_claims_an_offer(self):
        node = json.loads(re.search(
            r'application/ld\+json">\s*(\{.*?\})\s*</script>', self.html, re.S).group(1))
        # schema.org offers assert something is for sale at that price.
        # BearChart sells nothing, and these are estimates from past sales.
        self.assertNotIn("offers", node)
        self.assertEqual(node["brand"]["name"], "Build-A-Bear Workshop")


class PageShapeTests(unittest.TestCase):
    def test_assets_and_links_reach_back_out_of_the_item_directory(self):
        html = page(PRICED, VAL)
        self.assertIn('href="../styles.css"', html)
        self.assertIn('src="../data.js"', html)
        self.assertIn('src="../item.js"', html)
        self.assertIn('href="../index.html"', html)

    def test_a_canonical_url_is_set_when_the_site_address_is_known(self):
        html = page(PRICED, VAL, base="https://example.test")
        self.assertIn('<link rel="canonical" href="https://example.test/item/'
                      'test-priced.html">', html)

    def test_no_canonical_is_invented_without_a_site_address(self):
        # A canonical pointing at the wrong domain is worse than none.
        html = page(PRICED, VAL, base="")
        self.assertNotIn("canonical", html)

    def test_aliases_are_published_because_they_are_how_people_search(self):
        self.assertIn("Also listed as Testy", page(PRICED, VAL))

    def test_the_disclaimer_is_on_the_page_itself(self):
        self.assertIn("Not affiliated.", page(PRICED, VAL))

    def test_a_hostile_name_cannot_break_out_of_an_attribute(self):
        nasty = dict(PRICED, canonical_name='Bear" onload="alert(1)')
        html = page(nasty, NO_VAL)
        self.assertNotIn('onload="alert(1)', html)
        self.assertIn("&quot;", html)

    def test_a_hostile_name_cannot_close_the_structured_data_block(self):
        # Names arrive weekly from a wiki import. "</script>" inside the JSON-LD
        # would end the block and run whatever follows as script.
        nasty = dict(PRICED, canonical_name="</script><script>x()</script> & <!--")
        html = page(nasty, VAL, SALES)
        m = re.search(r'<script type="application/ld\+json">(.*?)</script>', html, re.S)
        self.assertIsNotNone(m)
        block = m.group(1)
        self.assertNotIn("<", block)
        self.assertNotIn(">", block)
        self.assertEqual(json.loads(block)["name"], "</script><script>x()</script> & <!--")
        self.assertNotIn("<script>x()", html)

    def test_no_inline_executable_script(self):
        # The CSP (vercel.json) allows no inline script; JSON-LD is data, not code.
        html = page(PRICED, VAL, SALES)
        for attrs in re.findall(r"<script\b([^>]*)>", html):
            self.assertTrue("src=" in attrs or 'type="application/ld+json"' in attrs, attrs)
        self.assertIsNone(re.search(r"\son[a-z]+\s*=", html))

    def test_sanitize_loads_before_auth(self):
        html = page(PRICED, VAL, SALES)
        self.assertLess(html.index('src="../sanitize.js"'), html.index('src="../auth.js"'))


SHOP = {"enabled": True, "name": "Jay's Retro Exchange",
        "shop_url": "https://jaysretroexchange.com",
        "shop_eyebrow": "The shop behind BearChart",
        "shop_headline": "Buying and selling all week",
        "shop_blurb": "Browse what is in stock.",
        "shop_cta": "Visit the shop",
        "shop_disclosure": "We buy and sell the same items this guide values."}


class ShopPromoTests(unittest.TestCase):
    """The operator's own shop, in the crawlable markup."""

    def test_it_appears_on_a_page_with_nothing_else_to_offer(self):
        html = bp.page_html(UNPRICED, NO_VAL, [], "", "d", SHOP)
        self.assertIn("https://jaysretroexchange.com", html)
        self.assertIn("The shop behind BearChart", html)

    def test_it_is_labelled_and_discloses_the_conflict(self):
        html = bp.page_html(UNPRICED, NO_VAL, [], "", "d", SHOP)
        self.assertIn("promo-eyebrow", html)
        self.assertIn("We buy and sell the same items this guide values.", html)

    def test_it_stays_off_a_priced_page(self):
        # Those pages carry the "sell yours to us" offer instead. One pitch per
        # page: two is an advert.
        self.assertNotIn("promo-title", bp.page_html(PRICED, VAL, SALES, "", "d", SHOP))

    def test_nothing_is_published_when_the_business_is_off(self):
        off = dict(SHOP, enabled=False)
        self.assertNotIn("jaysretroexchange", bp.page_html(UNPRICED, NO_VAL, [], "", "d", off))

    def test_the_outbound_link_is_safe(self):
        html = bp.page_html(UNPRICED, NO_VAL, [], "", "d", SHOP)
        self.assertIn('rel="noopener"', html)

    def test_shop_copy_is_escaped(self):
        nasty = dict(SHOP, shop_headline='<script>alert(1)</script>')
        html = bp.page_html(UNPRICED, NO_VAL, [], "", "d", nasty)
        self.assertNotIn("<script>alert(1)</script>", html)

    def test_the_promo_never_introduces_a_price(self):
        # An unpriced page must stay unpriced, shop panel or not.
        html = bp.page_html(UNPRICED, NO_VAL, [], "", "d", SHOP)
        self.assertNotIn("$", html.split("</head>")[0])


class SitemapTests(unittest.TestCase):
    DATA = {"items": [{"id": "a"}, {"id": "b"}], "sales": []}

    def test_no_sitemap_without_an_absolute_site_address(self):
        self.assertIsNone(bp.write_sitemap(self.DATA, ""))

    def test_the_sitemap_lists_every_item_and_the_top_level_pages(self):
        path, count = bp.write_sitemap(self.DATA, "https://example.test/")
        try:
            with open(path) as f:
                xml = f.read()
            self.assertIn("https://example.test/item/a.html", xml)
            self.assertIn("https://example.test/index.html", xml)
            self.assertEqual(count, len(bp.TOP_LEVEL) + 2)
            self.assertTrue(xml.startswith("<?xml"))
        finally:
            os.remove(path)


class LivePagesTests(unittest.TestCase):
    """The pages actually on disk, against the catalogue that produced them."""

    @classmethod
    def setUpClass(cls):
        with open(os.path.join(ROOT, "data.json")) as f:
            cls.data = json.load(f)
        cls.dir = os.path.join(ROOT, "item")

    def test_every_catalogued_item_has_a_page(self):
        if not os.path.isdir(self.dir):
            self.skipTest("run tools/build_pages.py first")
        for item in self.data["items"]:
            path = os.path.join(self.dir, "%s.html" % item["id"])
            self.assertTrue(os.path.exists(path), "missing page for " + item["id"])

    def test_no_page_for_an_item_with_no_comps_mentions_a_dollar_value(self):
        if not os.path.isdir(self.dir):
            self.skipTest("run tools/build_pages.py first")
        priced = {s["item_id"] for s in self.data["sales"]}
        checked = 0
        for item in self.data["items"]:
            if item["id"] in priced:
                continue
            html = open(os.path.join(self.dir, "%s.html" % item["id"])).read()
            head = html.split("</head>")[0]
            self.assertNotIn("$", head,
                             "%s has no comps but quotes a figure in its head" % item["id"])
            checked += 1
            if checked >= 300:
                break
        self.assertGreater(checked, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)

#!/usr/bin/env python3
"""
Tests for the CSV sold-comp importer.

    python3 tools/test_import.py

Runs against a temporary copy of the import state, so it never touches
tools/imported_sales.json.
"""

import csv
import io
import json
import os
import re
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import import_sales as imp  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def schema_sql():
    """Every migration, in the order they apply."""
    d = os.path.join(ROOT, "supabase", "migrations")
    out = []
    for name in sorted(os.listdir(d)):
        if name.endswith(".sql"):
            with open(os.path.join(d, name)) as f:
                out.append(f.read())
    return "\n".join(out)


class Args:
    def __init__(self, csvfile, **kw):
        self.csvfile = csvfile
        self.dry = kw.get("dry", False)
        self.fuzzy = kw.get("fuzzy", False)
        self.marketplace = kw.get("marketplace")
        self.map = kw.get("map", [])
        self.columns = False


def write_csv(rows, header):
    fd, path = tempfile.mkstemp(suffix=".csv")
    with os.fdopen(fd, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=header)
        w.writeheader()
        w.writerows(rows)
    return path


class CsvRoundTripTests(unittest.TestCase):
    """BearChart's own CSV exports guard formula cells with a leading quote
    (sanitize.js csvCell); importing one of those files gives the text back."""

    def test_guarded_cells_are_restored(self):
        self.assertEqual(imp.unneutralise("'=1+1"), "=1+1")
        self.assertEqual(imp.unneutralise("'@SUM(A1)"), "@SUM(A1)")
        self.assertEqual(imp.unneutralise("'-cmd"), "-cmd")
        self.assertEqual(imp.unneutralise("'+x"), "+x")

    def test_ordinary_text_is_untouched(self):
        self.assertEqual(imp.unneutralise("'tis the season"), "'tis the season")
        self.assertEqual(imp.unneutralise("'"), "'")
        self.assertEqual(imp.unneutralise("-12.50"), "-12.50")
        self.assertIsNone(imp.unneutralise(None))


class ParsingTests(unittest.TestCase):
    def test_price_parsing_strips_currency_and_commas(self):
        self.assertEqual(imp.parse_price("$1,234.56"), 1234.56)
        self.assertEqual(imp.parse_price("42.47"), 42.47)
        self.assertEqual(imp.parse_price("US $19.99"), 19.99)

    def test_bad_prices_are_rejected_not_guessed(self):
        for bad in ["", None, "free", "0", "-5", "US $-5", "(12.00)", "1.2.3"]:
            self.assertIsNone(imp.parse_price(bad), bad)

    def test_dates_parse_in_several_formats(self):
        self.assertEqual(imp.parse_date("2023-07-18"), "2023-07-18")
        self.assertEqual(imp.parse_date("7/18/2023"), "2023-07-18")
        self.assertEqual(imp.parse_date("07-18-23"), "2023-07-18")
        self.assertEqual(imp.parse_date("Jul 18, 2023"), "2023-07-18")
        self.assertEqual(imp.parse_date("December 14, 2020"), "2020-12-14")

    def test_unparseable_dates_become_none_rather_than_invented(self):
        for bad in ["", None, "last week", "13/45/2023", "soon"]:
            self.assertIsNone(imp.parse_date(bad), bad)

    def test_condition_normalisation(self):
        cases = [
            ("New with tags", "NWT"), ("NWT", "NWT"), ("tags attached", "NWT"),
            # Only explicit tag evidence is NWT. A bare "new" is new without tags.
            ("New without tags", "NWOT"), ("NWOT", "NWOT"), ("Brand New", "NWOT"),
            ("new", "NWOT"), ("New (Other)", "NWOT"), ("Like New", "Mint"),
            ("new with no tags", "NWOT"),
            ("Pre-owned", "Good"), ("Used", "Good"), ("Excellent condition", "Excellent"),
            ("well loved", "Poor"), ("For parts or not working", "Damaged"),
            ("", "Unknown"), ("something odd", "Unknown"),
        ]
        for text, expected in cases:
            self.assertEqual(imp.match_pattern(imp.CONDITION_PATTERNS, text, "Unknown"),
                             expected, text)

    def test_new_with_tags_unstuffed_keeps_both_facts(self):
        text = "Build-A-Bear new with tags unstuffed"
        self.assertEqual(imp.match_pattern(imp.CONDITION_PATTERNS, text, "Unknown"), "NWT")
        self.assertEqual(imp.match_pattern(imp.COMPLETENESS_PATTERNS, text, "unknown"),
                         "unstuffed")

    def test_the_vocabulary_is_the_only_definition(self):
        import domain_vocab as V
        self.assertEqual(imp.CONDITION_PATTERNS, V.CONDITION_PATTERNS)
        self.assertEqual(imp.COMPLETENESS_PATTERNS, V.COMPLETENESS_PATTERNS)
        codes = set(V.CONDITION_CODES)
        for _, code in V.CONDITION_PATTERNS:
            self.assertIn(code, codes)
        with open(os.path.join(ROOT, "data.json")) as f:
            cfg = json.load(f)["config"]
        self.assertEqual(cfg["condition_order"], V.CONDITION_CODES)
        self.assertEqual(list(cfg["condition_multipliers"]), V.CONDITION_CODES)
        self.assertEqual(list(cfg["completeness_multipliers"]), V.COMPLETENESS_CODES)

    def test_the_database_condition_checks_match_the_vocabulary(self):
        import domain_vocab as V
        sql = schema_sql()
        conds = re.findall(r"check\s*\(\s*condition\s+in\s*\(([^)]*)\)", sql, re.I)
        comps = re.findall(r"check\s*\(\s*completeness\s+in\s*\(([^)]*)\)", sql, re.I)
        self.assertTrue(conds and comps)
        # The last definition is the one in force once every migration has run.
        self.assertEqual(re.findall(r"'([^']+)'", conds[-1]), V.CONDITION_CODES)
        self.assertEqual(sorted(re.findall(r"'([^']+)'", comps[-1])),
                         sorted(V.COMPLETENESS_CODES))

    def test_completeness_normalisation(self):
        self.assertEqual(
            imp.match_pattern(imp.COMPLETENESS_PATTERNS, "complete with outfit", "unknown"),
            "complete")
        self.assertEqual(
            imp.match_pattern(imp.COMPLETENESS_PATTERNS, "unstuffed skin only", "unknown"),
            "unstuffed")
        self.assertEqual(
            imp.match_pattern(imp.COMPLETENESS_PATTERNS, "no idea", "unknown"), "unknown")

    def test_header_mapping_is_tolerant_of_naming(self):
        m = imp.map_headers(["Item Title", "Sold Price", "Date Sold", "Item Number"], [])
        self.assertEqual(m["Item Title"], "title")
        self.assertEqual(m["Sold Price"], "sold_price")
        self.assertEqual(m["Date Sold"], "sale_date")
        self.assertEqual(m["Item Number"], "listing_id")

    def test_explicit_map_overrides(self):
        m = imp.map_headers(["Whatever"], ["sold_price=Whatever"])
        self.assertEqual(m["Whatever"], "sold_price")


class MatcherTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(os.path.join(ROOT, "data.json")) as f:
            cls.data = json.load(f)
        cls.m = imp.Matcher(cls.data["items"])

    def test_exact_name_matches(self):
        item, how, _ = self.m.resolve(None, "Lucky Kitty", False)
        self.assertEqual(item["id"], "lucky-kitty")
        self.assertEqual(how, "exact")

    def test_alias_matches(self):
        item, how, _ = self.m.resolve(None, "Original Brown Teddy", False)
        self.assertEqual(item["id"], "classic-brown-teddy")

    def test_listing_title_noise_is_tolerated(self):
        item, how, _ = self.m.resolve(
            None, "Build-A-Bear Workshop Lucky Kitty Plush RARE HTF 1999", False)
        self.assertEqual(item["id"], "lucky-kitty")
        self.assertEqual(how, "contained")

    def test_slug_matches_directly(self):
        item, how, _ = self.m.resolve("kennel-pals-calico-cat", None, False)
        self.assertEqual(item["id"], "kennel-pals-calico-cat")
        self.assertEqual(how, "id")

    def test_unknown_title_is_declined_rather_than_guessed(self):
        item, how, _ = self.m.resolve(None, "Some Bear We Have Never Heard Of", False)
        self.assertIsNone(item)
        self.assertEqual(how, "no-match")

    def test_bad_slug_is_declined(self):
        item, how, _ = self.m.resolve("not-a-real-slug", None, False)
        self.assertIsNone(item)
        self.assertEqual(how, "unknown-id")


class ImportTests(unittest.TestCase):
    def setUp(self):
        # Redirect the import file so the real one is never touched.
        self.tmp = tempfile.mkdtemp()
        self.original = imp.IMPORTED
        imp.IMPORTED = os.path.join(self.tmp, "imported_sales.json")

    def tearDown(self):
        imp.IMPORTED = self.original

    def capture(self, args):
        buf = io.StringIO()
        stdout = sys.stdout
        sys.stdout = buf
        try:
            code = imp.run(args)
        finally:
            sys.stdout = stdout
        return code, buf.getvalue()

    def imported(self):
        with open(imp.IMPORTED) as f:
            return json.load(f)

    def test_full_provenance_becomes_a_completed_sale(self):
        path = write_csv([{
            "Title": "Lucky Kitty", "Sold Price": "$120.00",
            "Date Sold": "2026-01-15", "Item Number": "123456789012",
            "Marketplace": "eBay", "Condition": "Pre-owned"
        }], ["Title", "Sold Price", "Date Sold", "Item Number", "Marketplace", "Condition"])
        self.capture(Args(path))
        rows = self.imported()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["evidence_type"], "completed_sale")
        self.assertEqual(rows[0]["item_id"], "lucky-kitty")
        self.assertEqual(rows[0]["sold_price"], 120.0)
        self.assertEqual(rows[0]["condition"], "Good")

    def test_missing_provenance_downgrades_to_collector_report(self):
        # A price with no date or listing id is still sold data - but it is not
        # allowed to claim it is a verified completed sale.
        path = write_csv([{"Title": "Lucky Kitty", "Sold Price": "120"}],
                         ["Title", "Sold Price"])
        self.capture(Args(path))
        rows = self.imported()
        self.assertEqual(rows[0]["evidence_type"], "collector_report")
        self.assertIsNone(rows[0]["sale_date"])

    def test_a_listing_id_alone_is_not_enough_for_completed_sale(self):
        path = write_csv([{"Title": "Lucky Kitty", "Sold Price": "120",
                           "Item Number": "999", "Marketplace": "eBay"}],
                         ["Title", "Sold Price", "Item Number", "Marketplace"])
        self.capture(Args(path))
        self.assertEqual(self.imported()[0]["evidence_type"], "collector_report")

    def test_unmatched_titles_are_not_attached_to_the_wrong_item(self):
        path = write_csv([
            {"Title": "Lucky Kitty", "Sold Price": "100"},
            {"Title": "A Bear That Does Not Exist Here", "Sold Price": "50"},
        ], ["Title", "Sold Price"])
        code, out = self.capture(Args(path))
        self.assertIn("unmatched titles:   1", out)
        rows = self.imported()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["item_id"], "lucky-kitty")
        self.assertTrue(os.path.exists(path + ".unmatched.csv"))

    def test_duplicates_within_a_file_are_collapsed(self):
        row = {"Title": "Lucky Kitty", "Sold Price": "100", "Date Sold": "2026-02-01",
               "Item Number": "abc", "Marketplace": "eBay"}
        path = write_csv([row, dict(row)], ["Title", "Sold Price", "Date Sold",
                                            "Item Number", "Marketplace"])
        code, out = self.capture(Args(path))
        self.assertEqual(len(self.imported()), 1)
        self.assertIn("duplicates skipped: 1", out)

    def test_duplicates_against_existing_research_are_skipped(self):
        # $250 on 2023-07-18, listing 364353106238 is already in the seed data.
        path = write_csv([{
            "Title": "Kennel Pals Calico Cat", "Sold Price": "250",
            "Date Sold": "2023-07-18", "Item Number": "364353106238", "Marketplace": "eBay"
        }], ["Title", "Sold Price", "Date Sold", "Item Number", "Marketplace"])
        code, out = self.capture(Args(path))
        self.assertIn("duplicates skipped: 1", out)
        self.assertFalse(os.path.exists(imp.IMPORTED))

    def test_unreadable_prices_are_rejected(self):
        path = write_csv([{"Title": "Lucky Kitty", "Sold Price": "make an offer"}],
                         ["Title", "Sold Price"])
        code, out = self.capture(Args(path))
        self.assertIn("unreadable price:   1", out)

    def test_dry_run_writes_nothing(self):
        path = write_csv([{"Title": "Lucky Kitty", "Sold Price": "100"}],
                         ["Title", "Sold Price"])
        code, out = self.capture(Args(path, dry=True))
        self.assertIn("dry run", out)
        self.assertFalse(os.path.exists(imp.IMPORTED))

    def test_default_marketplace_is_applied(self):
        path = write_csv([{"Title": "Lucky Kitty", "Sold Price": "100",
                           "Date Sold": "2026-03-03", "Item Number": "xyz"}],
                         ["Title", "Sold Price", "Date Sold", "Item Number"])
        self.capture(Args(path, marketplace="eBay"))
        rows = self.imported()
        self.assertEqual(rows[0]["marketplace"], "eBay")
        self.assertEqual(rows[0]["evidence_type"], "completed_sale")

    def test_missing_price_column_is_a_clear_error(self):
        path = write_csv([{"Title": "Lucky Kitty"}], ["Title"])
        with self.assertRaises(SystemExit) as cm:
            self.capture(Args(path))
        self.assertIn("sold-price", str(cm.exception))

    def test_imported_ids_are_unique(self):
        path = write_csv([
            {"Title": "Lucky Kitty", "Sold Price": "100"},
            {"Title": "Lucky Kitty", "Sold Price": "110"},
            {"Title": "Lucky Kitty", "Sold Price": "120"},
        ], ["Title", "Sold Price"])
        self.capture(Args(path))
        ids = [r["id"] for r in self.imported()]
        self.assertEqual(len(ids), len(set(ids)))


class ShippingTests(ImportTests):
    def test_a_shipping_column_is_captured_beside_the_price(self):
        path = write_csv([{"Title": "Lucky Kitty", "Sold Price": "54.00", "Shipping": "$7.95"},
                          {"Title": "Lucky Kitty", "Sold Price": "60.00", "Shipping": "$0.00"}],
                         ["Title", "Sold Price", "Shipping"])
        self.capture(Args(path))
        rows = self.imported()
        self.assertEqual(rows[0]["ship_price"], 7.95)
        self.assertEqual(rows[0]["sold_price"], 54.0, "the price stays the item price")
        self.assertEqual(rows[1]["ship_price"], 0.0, "free shipping is zero, not missing")
        self.assertIs(rows[0]["shipping_included"], False)

    def test_zero_is_only_a_price_where_it_is_allowed(self):
        self.assertIsNone(imp.parse_price("$0.00"))
        self.assertEqual(imp.parse_price("$0.00", allow_zero=True), 0.0)
        self.assertIsNone(imp.parse_price("-3", allow_zero=True))


class OperatorTests(ImportTests):
    def test_a_seller_column_naming_the_operator_flags_the_sale(self):
        ids_path = os.path.join(self.tmp, "operator_identities.json")
        with open(ids_path, "w") as f:
            json.dump({"ebay": ["JaysRetro"]}, f)
        original = imp.OPERATOR_IDS
        imp.OPERATOR_IDS = ids_path
        try:
            path = write_csv([{"Title": "Lucky Kitty", "Sold Price": "54", "Seller": "jaysretro"},
                              {"Title": "Lucky Kitty", "Sold Price": "55", "Seller": "someone"}],
                             ["Title", "Sold Price", "Seller"])
            self.capture(Args(path, marketplace="eBay"))
        finally:
            imp.OPERATOR_IDS = original
        rows = self.imported()
        self.assertTrue(rows[0]["seller_is_operator"])
        self.assertFalse(rows[1]["seller_is_operator"])
        blob = json.dumps(rows)
        self.assertNotIn("jaysretro", blob.lower())
        self.assertNotIn("someone", blob)
        self.assertNotIn('"seller"', blob)


import sale_attributes as SA  # noqa: E402


class AttributeTests(unittest.TestCase):
    GROUP = [{"id": "merry-mouse-13-inch", "variant_group": "merry-mouse", "size_in": 13.0},
             {"id": "merry-mouse-15-inch", "variant_group": "merry-mouse", "size_in": 15.0}]

    def test_a_parsed_size_picks_the_one_member_it_fits(self):
        item, basis = SA.resolve_variant(self.GROUP[0], SA.parse('Merry Mouse 15" grey'),
                                         self.GROUP)
        self.assertEqual(item["id"], "merry-mouse-15-inch")
        self.assertEqual(basis, "size_parsed")

    def test_a_size_between_members_is_ambiguous_and_stays_put(self):
        item, basis = SA.resolve_variant(self.GROUP[0], SA.parse("Merry Mouse 14in"), self.GROUP)
        self.assertEqual(item["id"], "merry-mouse-13-inch")
        self.assertEqual(basis, "unverified", "no parent to fall back to")

    def test_no_size_leaves_the_match_alone(self):
        item, basis = SA.resolve_variant(self.GROUP[1], SA.parse("Merry Mouse"), self.GROUP)
        self.assertEqual(item["id"], "merry-mouse-15-inch")
        self.assertEqual(basis, "unverified")

    def test_an_ambiguous_size_goes_to_the_parent_when_there_is_one(self):
        cat = [{"id": "p", "size_in": None},
               {"id": "a", "variant_of": "p", "size_in": 13.0},
               {"id": "b", "variant_of": "p", "size_in": 15.0}]
        self.assertEqual(SA.resolve_variant(cat[0], SA.parse("x 14in"), cat), (cat[0], "ambiguous"))
        self.assertEqual(SA.resolve_variant(cat[0], SA.parse("x 15in"), cat)[0]["id"], "b")

    def test_an_item_with_no_group_never_moves(self):
        # Pikachu: sellers measure one standard plush at 15 to 20 inches. That
        # spread is not evidence of two products.
        pika = {"id": "pikachu", "size_in": None}
        for t in ["Build-A-Bear Pikachu 15in", "Build-A-Bear Pikachu 18 inch with sound"]:
            self.assertEqual(SA.resolve_variant(pika, SA.parse(t), [pika]), (pika, None))

    def test_sound_reports(self):
        self.assertEqual(SA.parse_sound("Pikachu with sound"), "working")
        self.assertEqual(SA.parse_sound("talking Elmo"), "working")
        self.assertEqual(SA.parse_sound("voice box works"), "working")
        self.assertEqual(SA.parse_sound("speaker does not work"), "broken")
        self.assertEqual(SA.parse_sound("sound doesn't work, otherwise great"), "broken")
        self.assertEqual(SA.parse_sound("Bowser No Sound"), "broken")
        self.assertIsNone(SA.parse_sound("Pikachu plush"))

    def test_sizes_are_read_but_never_from_a_fits_phrase_or_a_year(self):
        self.assertEqual(SA.parse_size('Pikachu 16" plush'), 16.0)
        self.assertEqual(SA.parse_size("Pikachu 18 inch"), 18.0)
        self.assertIsNone(SA.parse_size("Hoodie fits 18in bears"))
        self.assertIsNone(SA.parse_size("Pikachu 2016"))
        self.assertEqual(SA.parse_size_class(None, "Giant 3 ft teddy"), "giant")
        self.assertEqual(SA.parse_size_class(9.0), "mini")

    def test_condition_basis_names_its_source(self):
        self.assertEqual(imp.condition_basis("New with tags", "x"), "column")
        self.assertEqual(imp.condition_basis("", "Lucky Kitty NWT"), "title")
        self.assertEqual(imp.condition_basis("", "Lucky Kitty"), "default")


class ImportedAttributeTests(ImportTests):
    def test_an_import_records_attributes_and_where_the_condition_came_from(self):
        path = write_csv([{"Title": 'Lucky Kitty 16" with sound', "Sold Price": "54",
                           "Condition": "Pre-owned"}],
                         ["Title", "Sold Price", "Condition"])
        self.capture(Args(path))
        row = self.imported()[0]
        self.assertEqual(row["attributes"], {"size_in": 16.0, "sound": "working"})
        self.assertEqual(row["condition_basis"], "column")
        self.assertIsNone(row["variant_basis"])


class AggregateTests(ImportTests):
    """Terapeak reports an average across N sales, not a list of transactions."""

    def test_a_sold_quantity_column_makes_the_row_an_average(self):
        path = write_csv([{"Title": "Lucky Kitty", "Sold Price": "54.00",
                           "Quantity Sold": "12"}],
                         ["Title", "Sold Price", "Quantity Sold"])
        self.capture(Args(path))
        row = self.imported()[0]
        self.assertEqual(row["sample_size"], 12)
        self.assertEqual(row["sold_price"], 54.0)

    def test_an_average_is_never_recorded_as_a_verified_completed_sale(self):
        path = write_csv([{"Title": "Lucky Kitty", "Sold Price": "54.00",
                           "Quantity Sold": "12", "Date Sold": "2026-01-15",
                           "Item Number": "123", "Marketplace": "eBay"}],
                         ["Title", "Sold Price", "Quantity Sold", "Date Sold",
                          "Item Number", "Marketplace"])
        self.capture(Args(path))
        row = self.imported()[0]
        self.assertEqual(row["evidence_type"], "collector_report")
        self.assertEqual(row["sample_size"], 12)

    def test_a_quantity_of_one_is_an_ordinary_sale(self):
        path = write_csv([{"Title": "Lucky Kitty", "Sold Price": "54.00",
                           "Quantity Sold": "1", "Date Sold": "2026-01-15",
                           "Item Number": "123", "Marketplace": "eBay"}],
                         ["Title", "Sold Price", "Quantity Sold", "Date Sold",
                          "Item Number", "Marketplace"])
        self.capture(Args(path))
        row = self.imported()[0]
        self.assertIsNone(row["sample_size"])
        self.assertEqual(row["evidence_type"], "completed_sale")

    def test_an_unreadable_quantity_is_ignored_rather_than_guessed(self):
        path = write_csv([{"Title": "Lucky Kitty", "Sold Price": "54.00",
                           "Quantity Sold": "lots"}],
                         ["Title", "Sold Price", "Quantity Sold"])
        self.capture(Args(path))
        self.assertIsNone(self.imported()[0]["sample_size"])



import import_my_sales as mine  # noqa: E402


class MyArgs:
    def __init__(self, csvfile, **kw):
        self.csvfile = csvfile
        self.marketplace = kw.get("marketplace", "eBay")
        self.condition = kw.get("condition", "Unknown")
        self.completeness = kw.get("completeness", "unknown")
        self.fuzzy = kw.get("fuzzy", False)
        self.dry = kw.get("dry", False)


class MySalesTests(unittest.TestCase):
    """Your own sales: the strongest evidence, and the most privacy-sensitive file."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.original = mine.IMPORTED
        mine.IMPORTED = os.path.join(self.tmp, "imported_sales.json")

    def tearDown(self):
        mine.IMPORTED = self.original

    def capture(self, args):
        buf = io.StringIO()
        stdout = sys.stdout
        sys.stdout = buf
        try:
            code = mine.run(args)
        finally:
            sys.stdout = stdout
        return code, buf.getvalue()

    def imported(self):
        with open(mine.IMPORTED) as f:
            return json.load(f)

    ORDER_HEADERS = ["Sales Record Number", "Item Number", "Item Title", "Sold For",
                     "Sale Date", "Buyer Username", "Buyer Name", "Ship To Address 1",
                     "Ship To Zip", "Buyer Email"]

    def order_row(self, **kw):
        row = {
            "Sales Record Number": "1001", "Item Number": "405998877001",
            "Item Title": "Build-A-Bear Lucky Kitty 1999", "Sold For": "$128.00",
            "Sale Date": "3/2/2026", "Buyer Username": "catfan99",
            "Buyer Name": "Jane Doe", "Ship To Address 1": "12 Example St",
            "Ship To Zip": "62704", "Buyer Email": "jane@example.com",
        }
        row.update(kw)
        return row

    # --- privacy ---------------------------------------------------------

    def test_buyer_details_are_never_read(self):
        mapping, ignored = mine.map_columns(self.ORDER_HEADERS)
        for header in ["Buyer Username", "Buyer Name", "Ship To Address 1",
                       "Ship To Zip", "Buyer Email"]:
            self.assertNotIn(header, mapping, "%s must never be mapped" % header)
            self.assertIn(header, ignored)

    def test_no_buyer_data_reaches_the_written_file(self):
        path = write_csv([self.order_row()], self.ORDER_HEADERS)
        self.capture(MyArgs(path))
        blob = json.dumps(self.imported())
        for secret in ["Jane Doe", "catfan99", "12 Example St", "62704",
                       "jane@example.com"]:
            self.assertNotIn(secret, blob, "%r leaked into the database" % secret)

    def test_shipping_charged_is_read_but_addresses_never_are(self):
        headers = self.ORDER_HEADERS + ["Shipping And Handling"]
        mapping, ignored = mine.map_columns(headers)
        self.assertEqual(mapping.get("Shipping And Handling"), "ship_price")
        for header in ["Ship To Address 1", "Ship To Zip"]:
            self.assertNotIn(header, mapping)
        path = write_csv([self.order_row(**{"Shipping And Handling": "$9.50"})], headers)
        self.capture(MyArgs(path))
        row = self.imported()[0]
        self.assertEqual(row["ship_price"], 9.5)
        self.assertNotIn("12 Example St", json.dumps(row))

    def test_the_item_number_wins_over_the_sales_record_number(self):
        # The item number is what other comps for the same listing are keyed on.
        mapping, _ = mine.map_columns(self.ORDER_HEADERS)
        self.assertEqual(mapping.get("Item Number"), "listing_id")
        self.assertNotIn("Sales Record Number", mapping)

    # --- import behaviour ------------------------------------------------

    def test_an_own_sale_is_marked_first_party(self):
        path = write_csv([self.order_row()], self.ORDER_HEADERS)
        self.capture(MyArgs(path))
        row = self.imported()[0]
        self.assertTrue(row["first_party"])
        self.assertTrue(row["seller_is_operator"], "own sales are always operator sales")
        self.assertEqual(row["item_id"], "lucky-kitty")
        self.assertEqual(row["sold_price"], 128.0)
        self.assertEqual(row["evidence_type"], "completed_sale")
        self.assertEqual(row["listing_id"], "405998877001")

    def test_provenance_is_still_required_for_completed_sale(self):
        # Knowing you sold it is not the same as recording how it can be checked.
        path = write_csv([{"Item Title": "Lucky Kitty", "Sold For": "128"}],
                         ["Item Title", "Sold For"])
        self.capture(MyArgs(path))
        row = self.imported()[0]
        self.assertTrue(row["first_party"])
        self.assertEqual(row["evidence_type"], "collector_report")

    def test_unmatched_titles_are_not_guessed(self):
        path = write_csv([self.order_row(**{"Item Title": "A Bear Nobody Catalogued"})],
                         self.ORDER_HEADERS)
        code, out = self.capture(MyArgs(path))
        self.assertIn("unmatched items: 1", out)
        self.assertFalse(os.path.exists(mine.IMPORTED))

    def test_duplicate_order_numbers_are_skipped(self):
        rows = [self.order_row(), self.order_row()]
        path = write_csv(rows, self.ORDER_HEADERS)
        code, out = self.capture(MyArgs(path))
        self.assertEqual(len(self.imported()), 1)
        self.assertIn("duplicates:      1", out)

    def test_condition_is_read_from_the_title_when_present(self):
        path = write_csv(
            [self.order_row(**{"Item Title": "Build-A-Bear Lucky Kitty 1999 NWT"})],
            self.ORDER_HEADERS)
        self.capture(MyArgs(path))
        self.assertEqual(self.imported()[0]["condition"], "NWT")

    def test_a_default_condition_is_applied_when_the_file_is_silent(self):
        path = write_csv([self.order_row()], self.ORDER_HEADERS)
        self.capture(MyArgs(path, condition="Good"))
        self.assertEqual(self.imported()[0]["condition"], "Good")

    def test_dry_run_writes_nothing(self):
        path = write_csv([self.order_row()], self.ORDER_HEADERS)
        code, out = self.capture(MyArgs(path, dry=True))
        self.assertIn("dry run", out)
        self.assertFalse(os.path.exists(mine.IMPORTED))

    def test_a_file_with_no_price_column_is_a_clear_error(self):
        path = write_csv([{"Item Title": "Lucky Kitty"}], ["Item Title"])
        with self.assertRaises(SystemExit):
            self.capture(MyArgs(path))



class AmbiguityTests(unittest.TestCase):
    """A name that identifies two items must identify neither."""

    def items(self):
        return [
            {"id": "a", "canonical_name": "Bubbles", "aliases": []},
            {"id": "b", "canonical_name": "Bubbles Deluxe", "aliases": ["Bubbles"]},
            {"id": "c", "canonical_name": "Lucky Kitty", "aliases": ["Halloween Kitty"]},
        ]

    def test_a_canonical_name_outranks_an_alias(self):
        # "Bubbles" names item a and is merely an alias of item b, so a wins.
        m = imp.Matcher(self.items())
        item, how, _ = m.resolve(None, "Bubbles", False)
        self.assertEqual(item["id"], "a")
        self.assertEqual(how, "exact")

    def test_two_items_sharing_a_canonical_name_resolve_to_nothing(self):
        m = imp.Matcher([
            {"id": "a", "canonical_name": "Rainbow Sloth", "aliases": []},
            {"id": "b", "canonical_name": "Rainbow  Sloth", "aliases": []},
        ])
        item, how, _ = m.resolve(None, "Rainbow Sloth", False)
        self.assertIsNone(item, "an ambiguous name must not silently pick one")
        self.assertEqual(how, "ambiguous-name")

    def test_two_items_sharing_an_alias_resolve_to_nothing(self):
        m = imp.Matcher([
            {"id": "a", "canonical_name": "Sparkle Narwhal",
             "aliases": ["Unicorn of the Sea"]},
            {"id": "b", "canonical_name": "Teal Narwhal",
             "aliases": ["Unicorn of the Sea"]},
        ])
        item, how, _ = m.resolve(None, "Unicorn of the Sea", False)
        self.assertIsNone(item)
        self.assertEqual(how, "ambiguous-name")

    def test_an_unambiguous_alias_still_resolves(self):
        m = imp.Matcher(self.items())
        item, how, _ = m.resolve(None, "Halloween Kitty", False)
        self.assertEqual(item["id"], "c")
        self.assertEqual(how, "alias")

    def test_the_real_catalogue_has_no_ambiguous_names(self):
        with open(os.path.join(ROOT, "data.json")) as f:
            data = json.load(f)
        clashes = imp.Matcher(data["items"]).ambiguous_names()
        self.assertEqual(clashes, {},
                         "ambiguous names would misroute comps: %s" % clashes)


if __name__ == "__main__":
    unittest.main(verbosity=2)

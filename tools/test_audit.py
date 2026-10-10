#!/usr/bin/env python3
"""
Catalogue identity and data-invariant tests.

    python3 tools/test_audit.py

Covers the duplicate audit (name keys, the identity ledger, strict mode) and the
invariants the build promises about data.json: notes never claim anything about
the evidence, the wiki attribution survives, and so on.
"""

import contextlib
import io
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import domain_vocab as V  # noqa: E402
import name_key as NK  # noqa: E402
import audit_duplicates as audit  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

_DATA = None


def data():
    global _DATA
    if _DATA is None:
        with open(os.path.join(ROOT, "data.json")) as f:
            _DATA = json.load(f)
    return _DATA


class NoteInvariantTests(unittest.TestCase):
    def test_no_note_claims_anything_about_the_evidence(self):
        bad = [i["id"] for i in data()["items"]
               if i.get("notes") and V.EVIDENCE_CLAIM.search(i["notes"])]
        self.assertEqual(bad, [])

    def test_every_wiki_item_keeps_its_licence_attribution(self):
        wiki = [i for i in data()["items"] if i.get("catalogue_source") == "wiki"]
        self.assertTrue(wiki)
        for i in wiki:
            self.assertIn("CC BY-SA 4.0", i.get("notes") or "", i["id"])

    def test_every_item_states_where_its_entry_came_from(self):
        for i in data()["items"]:
            self.assertIn(i.get("catalogue_source"), V.CATALOGUE_SOURCES, i["id"])

    def test_the_build_strips_the_old_phrasings(self):
        import build_data as B
        self.assertIsNone(B.strip_evidence_claims(
            "Identification only - no sold comps recorded yet."))
        self.assertEqual(B.strip_evidence_claims(
            "Catalogued from the CollectionHero index; no sourced price captured yet."),
            "Catalogued from the CollectionHero index.")
        self.assertEqual(B.strip_evidence_claims(
            "Historical sales are known to exist but no price was captured during "
            "research - needs a sourced comp."), "Historical sales are known to exist.")


def it(name, **kw):
    d = {"id": kw.pop("id", name.lower().replace(" ", "-")), "canonical_name": name,
         "category": kw.pop("category", "Stuffed Animal"), "release_year": None,
         "franchise": None, "mini_bean": False, "vault_release": False, "aliases": []}
    d.update(kw)
    return d


class NameKeyTests(unittest.TestCase):
    def assertCollide(self, a, b):
        self.assertIsNotNone(NK.collides(a, b), "%s / %s" % (a["canonical_name"], b["canonical_name"]))

    def assertDistinct(self, a, b):
        self.assertIsNone(NK.collides(a, b), "%s / %s" % (a["canonical_name"], b["canonical_name"]))

    def test_franchise_brackets_and_prefixes_are_the_same_name(self):
        self.assertCollide(it("Grogu (Star Wars)", franchise="Star Wars"),
                           it("Star Wars Grogu", franchise="Star Wars"))

    def test_mini_beans_bracket_and_prefix_collide(self):
        self.assertCollide(it("Skunk (Mini Beans)", mini_bean=True, category="Mini Bean"),
                           it("Mini Beans Skunk", mini_bean=True, category="Mini Bean"))

    def test_lab_and_labrador_are_one_word(self):
        self.assertCollide(it("Bearemy's Kennel Pals Black Lab"),
                           it("Bearemy's Kennel Pals Black Labrador"))

    def test_explicit_years_keep_releases_apart(self):
        self.assertDistinct(it("Polar Bear (1997)"), it("Polar Bear (2008)"))

    def test_a_line_qualifier_is_distinguishing(self):
        self.assertDistinct(it("Rainbow Sloth"), it("Rainbow Sloth (Heartables)"))

    def test_product_lines_are_not_stripped(self):
        self.assertDistinct(it("Promise Pets Calico"), it("Kennel Pals Calico"))

    def test_mini_and_full_size_never_collide(self):
        self.assertDistinct(it("Skunk (Mini Beans)", mini_bean=True, category="Mini Bean"),
                            it("Skunk"))

    def test_vault_and_original_never_collide(self):
        self.assertDistinct(it("Pumpkin Pal Teddy"), it("Vault Collection Pumpkin Pal Teddy"))
        self.assertDistinct(it("Pumpkin Pal Teddy"), it("Pumpkin Pal Teddy", id="p2",
                                                        vault_release=True))

    def test_sizes_further_apart_than_the_tolerance_are_distinct(self):
        self.assertDistinct(it("Brown Sloth (15-inch)"), it("Brown Sloth (18-inch)"))

    def test_different_release_years_without_a_bracket_are_for_review(self):
        self.assertEqual(NK.collides(it("Curly Bear", release_year=1997),
                                     it("Curly Teddy", release_year=2005)), "review")
        self.assertEqual(NK.collides(it("Curly Bear", release_year=1997),
                                     it("Curly Teddy", release_year=None)), "high")


def run_audit(items, ledger, sales=None):
    tmp = tempfile.mkdtemp()
    dpath = os.path.join(tmp, "data.json")
    lpath = os.path.join(tmp, "ledger.json")
    with open(dpath, "w") as f:
        json.dump({"items": items, "sales": sales or []}, f)
    with open(lpath, "w") as f:
        json.dump(ledger, f)
    with contextlib.redirect_stdout(io.StringIO()):
        return audit.main(["--strict", "--data", dpath, "--ledger", lpath])


class StrictModeTests(unittest.TestCase):
    ITEMS = [it("Grogu (Star Wars)", id="grogu-star-wars", franchise="Star Wars"),
             it("Star Wars Grogu", id="star-wars-grogu", franchise="Star Wars")]

    def test_an_unresolved_high_collision_fails(self):
        self.assertEqual(run_audit(self.ITEMS, {"merges": {}, "distinct": []}), 1)

    def test_a_distinct_entry_resolves_it(self):
        ledger = {"merges": {}, "distinct": [
            {"ids": ["grogu-star-wars", "star-wars-grogu"], "reason": "x", "pending": True}]}
        self.assertEqual(run_audit(self.ITEMS, ledger), 0)

    def test_a_merge_resolves_it(self):
        # After the build applies the merge, only the survivor is left.
        ledger = {"merges": {"star-wars-grogu": {"into": "grogu-star-wars"}}, "distinct": []}
        self.assertEqual(run_audit(self.ITEMS[:1], ledger), 0)
        self.assertEqual(run_audit(self.ITEMS, ledger), 0)

    def test_the_shipped_catalogue_passes(self):
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(audit.main(["--strict"]), 0)


class LedgerTests(unittest.TestCase):
    def setUp(self):
        import build_data as B
        self.B = B
        with open(os.path.join(ROOT, "tools", "catalogue_identity.json")) as f:
            self.ledger = json.load(f)

    def test_the_ledger_names_only_real_items(self):
        live = {i["id"] for i in data()["items"]}
        redirects = data()["redirects"]
        for old, m in self.ledger["merges"].items():
            self.assertIn(old, redirects, old)
            self.assertIn(redirects[old], live)
        for d in self.ledger["distinct"]:
            for i in d["ids"]:
                self.assertIn(i, live, "distinct entry names unknown item %s" % i)
        sales = {s["id"]: s for s in data()["sales"]}
        for sid, ov in self.ledger["sale_overrides"].items():
            self.assertIn(sid, sales)
            if ov["action"] == "exclude":
                self.assertTrue(sales[sid].get("excluded"))
            else:
                self.assertEqual(sales[sid]["item_id"], ov["to"])

    def test_chains_resolve_to_the_end(self):
        merges = {"a": {"into": "b"}, "b": {"into": "c"}}
        self.assertEqual(dict(self.B.resolve_redirects(merges, {"c"})), {"a": "c", "b": "c"})

    def test_a_cycle_is_an_error(self):
        with self.assertRaises(ValueError):
            self.B.resolve_redirects({"a": {"into": "b"}, "b": {"into": "a"}}, {"c"})

    def test_a_missing_target_is_an_error(self):
        with self.assertRaises(ValueError):
            self.B.resolve_redirects({"a": {"into": "nowhere"}}, {"c"})

    def test_a_merge_moves_sales_and_keeps_the_name(self):
        items = [{"id": "keep", "canonical_name": "Keep", "aliases": [], "release_year": None,
                  "franchise": None, "release_month": None},
                 {"id": "gone", "canonical_name": "Gone Bear", "aliases": [], "release_year": 2020,
                  "franchise": "X", "release_month": None}]
        sales = [{"id": "gone-01", "item_id": "gone"}]
        r = self.B.apply_identity(items, sales, {"merges": {"gone": {"into": "keep"}}})
        self.assertEqual(dict(r), {"gone": "keep"})
        self.assertEqual([i["id"] for i in items], ["keep"])
        self.assertEqual(sales[0], {"id": "gone-01", "item_id": "keep"})
        self.assertIn("Gone Bear", items[0]["aliases"])
        self.assertEqual(items[0]["release_year"], 2020)


class VariantDataTests(unittest.TestCase):
    def test_pikachu_stays_one_item_with_per_sale_attributes(self):
        pika = [i for i in data()["items"] if i["id"].startswith("pikachu")]
        self.assertEqual([i["id"] for i in pika], ["pikachu-pokemon"])
        sales = [s for s in data()["sales"] if s["item_id"] == "pikachu-pokemon"]
        self.assertTrue(any((s.get("attributes") or {}).get("size_in") for s in sales))

    def test_size_siblings_are_linked_not_merged(self):
        by = {i["id"]: i for i in data()["items"]}
        self.assertEqual(by["merry-mouse-13-inch"]["variant_group"],
                         by["merry-mouse-15-inch"]["variant_group"])
        self.assertEqual(by["brown-sloth-15-inch"]["variant_group"],
                         by["brown-sloth-18-inch"]["variant_group"])
        self.assertEqual(by["brown-sloth-18-inch"]["size_in"], 18.0)

    def test_size_classes_come_from_the_vocabulary(self):
        for i in data()["items"]:
            self.assertIn(i.get("size_class"), V.SIZE_CLASS_CODES + [None], i["id"])


class GapsTests(unittest.TestCase):
    def test_the_gaps_backlog_exists_and_is_never_data(self):
        self.assertTrue(os.path.exists(os.path.join(ROOT, "tools", "catalogue_gaps.md")))
        with open(os.path.join(ROOT, "tools", "build_data.py")) as f:
            self.assertNotIn("catalogue_gaps", f.read())


class RedirectDataTests(unittest.TestCase):
    def test_redirects_point_at_live_items_and_nothing_points_at_a_redirect(self):
        live = {i["id"] for i in data()["items"]}
        red = data()["redirects"]
        self.assertTrue(red)
        for old, new in red.items():
            self.assertNotIn(old, live)
            self.assertIn(new, live)
        for s in data()["sales"]:
            self.assertNotIn(s["item_id"], red, s["id"])
        for l in data()["active_listings"]:
            self.assertNotIn(l["item_id"], red)

    def test_sale_rows_are_never_lost_to_a_merge(self):
        # Exclusions keep their rows; a merge moves sales, never drops them.
        self.assertEqual(data()["meta"]["sale_count"], len(data()["sales"]))


if __name__ == "__main__":
    unittest.main(verbosity=2)

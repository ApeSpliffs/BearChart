#!/usr/bin/env python3
"""
Catalogue identity and data-invariant tests.

    python3 tools/test_audit.py

Covers the duplicate audit (name keys, the identity ledger, strict mode) and the
invariants the build promises about data.json: notes never claim anything about
the evidence, the wiki attribution survives, and so on.
"""

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import domain_vocab as V  # noqa: E402

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


if __name__ == "__main__":
    unittest.main(verbosity=2)

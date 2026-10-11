#!/usr/bin/env python3
"""
Guards on the collector-submission schema.

These are text assertions on the SQL rather than a live database test, which
is a real limitation - they prove the file says the right thing, not that the
deployed database does. They are here because the properties they check are
the ones that would be expensive to get wrong: a submission queue that could
reach a published price would let anyone move a valuation, and the person
running this site buys and sells the items it values.

Verify the live database separately with the checks in the README.
"""

import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SQL_PATH = os.path.join(ROOT, "supabase", "migrations", "20261008000002_submissions.sql")

with open(SQL_PATH) as f:
    SQL = f.read()


def body_of(fn):
    """The text of one function definition."""
    m = re.search(r"create or replace function %s\(.*?\$\$(.*?)\$\$;" % fn, SQL, re.S)
    return m.group(1) if m else ""


class IsolationTests(unittest.TestCase):
    """A submission must not be able to become a price on its own."""

    def test_submissions_land_pending(self):
        self.assertIn("status         text not null default 'pending'", SQL)

    def test_the_strongest_evidence_class_cannot_be_self_claimed(self):
        body = body_of("submit_comp")
        self.assertIn("if claimed not in ('collector_report', 'auction_result')", body)
        # completed_sale is the class the engine weighs most heavily. Nobody
        # gets to apply it to their own submission.
        self.assertNotIn("'completed_sale'", body)

    def test_nothing_here_writes_to_the_sales_table(self):
        # The only path from a submission to a published value goes through a
        # human accepting it and the existing sold-comp importer.
        self.assertNotRegex(SQL, r"insert\s+into\s+sales\b")
        self.assertNotRegex(SQL, r"update\s+sales\b")


class IdentityTests(unittest.TestCase):
    def test_the_submitter_is_stamped_server_side(self):
        body = body_of("submit_comp")
        self.assertIn("auth.uid(),", body)
        # A caller must not be able to attribute a submission to somebody else.
        self.assertNotIn("entry->>'user_id'", body)

    def test_submitting_a_sale_requires_an_account(self):
        self.assertIn("raise exception 'sign in to submit a sale'", body_of("submit_comp"))

    def test_reporting_a_problem_does_not(self):
        # Requiring an account here would cut reports to near zero, and a
        # report costs nothing to check.
        self.assertNotIn("sign in", body_of("report_item"))
        self.assertIn("grant execute on function report_item(jsonb) to anon, authenticated;", SQL)

    def test_both_functions_pin_their_search_path(self):
        # A mutable search_path on a SECURITY DEFINER function lets a caller
        # who can create objects shadow a table it reads.
        for fn in ("submit_comp", "report_item"):
            block = re.search(
                r"create or replace function %s\(.*?\$\$" % fn, SQL, re.S).group(0)
            self.assertIn("security definer", block, fn)
            self.assertIn("set search_path = public", block, fn)


class AccessTests(unittest.TestCase):
    def test_row_level_security_is_on_for_both_tables(self):
        self.assertIn("alter table comp_submissions enable row level security", SQL)
        self.assertIn("alter table item_reports enable row level security", SQL)

    def test_the_review_queue_is_not_public(self):
        # Unreviewed prices on public display would be exactly what this
        # design exists to avoid.
        self.assertIn("using (user_id = auth.uid() or is_admin())", SQL)

    def test_reports_are_admin_read_only(self):
        # Otherwise it is a message board anybody can post to.
        self.assertIn("create policy item_reports_admin_read on item_reports for select\n"
                      "  using (is_admin())", SQL)

    def test_no_policy_lets_a_reader_insert_directly(self):
        # Everything goes through the functions, which validate and stamp.
        inserts = re.findall(r"create policy[^;]*for insert[^;]*;", SQL)
        for policy in inserts:
            self.assertIn("is_admin()", policy, policy)

    def test_only_admins_can_change_a_status(self):
        self.assertIn("create policy comp_sub_admin_write on comp_submissions for update\n"
                      "  using (is_admin()) with check (is_admin())", SQL)


class SanityTests(unittest.TestCase):
    def test_prices_are_bounded(self):
        self.assertIn("check (sold_price > 0 and sold_price < 100000)", SQL)

    def test_free_text_is_capped(self):
        self.assertIn("length(note) <= 1000", SQL)   # submissions
        self.assertIn("length(note) <= 500", SQL)    # reports

    def test_report_reasons_are_a_fixed_list(self):
        self.assertIn("reason      text not null check (reason in", SQL)

    def test_the_known_spam_gap_is_written_down(self):
        # An anonymous insert path can be flooded. Saying so in the file is the
        # difference between a documented tradeoff and an oversight.
        self.assertIn("KNOWN GAP", SQL)
        self.assertIn("Turnstile", SQL)


if __name__ == "__main__":
    unittest.main(verbosity=2)

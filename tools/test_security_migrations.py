#!/usr/bin/env python3
"""
Static guards on the security migrations (supabase/migrations/2026100800010*).

Text assertions on the SQL, in the same style as tools/test_submissions.py.
They prove the files say the right thing; the pgTAP suite in
supabase/tests/database/ proves a real database behaves that way
(`npm run test:db` against a local `supabase start`, and in CI).
"""

import glob
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIGRATIONS = os.path.join(ROOT, "supabase", "migrations")


def read(prefix):
    paths = sorted(glob.glob(os.path.join(MIGRATIONS, prefix + "_*.sql")))
    assert len(paths) == 1, "expected exactly one %s_*.sql, found %r" % (prefix, paths)
    with open(paths[0]) as f:
        return f.read()


V100 = read("20261008000100")
V101 = read("20261008000101")
V102 = read("20261008000102")
V103 = read("20261008000103")
V104 = read("20261008000104")
SECURITY_SQL = [V100, V101, V102, V103, V104]


def strip_comments(sql):
    return re.sub(r"--[^\n]*", "", sql)


def function_sql(sql, name):
    """From `create or replace function <name>(` up to the end of its body."""
    m = re.search(r"create or replace function (?:public\.)?%s\(.*?\$\$.*?\$\$;?" % re.escape(name),
                  sql, re.S)
    return m.group(0) if m else ""


def policies(sql, table):
    """{policy name: full statement} for every create policy on `table`."""
    out = {}
    for m in re.finditer(r"create policy (\"[^\"]+\"|\w+) on (?:public\.)?%s\b(.*?);" % re.escape(table),
                         sql, re.S):
        out[m.group(1)] = m.group(0)
    return out


class SubmissionValidationTests(unittest.TestCase):
    """H1 + L3 (20261008000100)."""

    def test_url_validator_is_immutable_and_used_twice(self):
        fn = function_sql(V100, "is_safe_https_url")
        self.assertTrue(fn, "is_safe_https_url is defined")
        self.assertIn("immutable", fn)
        self.assertIn("'^https://", fn)
        self.assertRegex(V100, r"comp_submissions_listing_url_safe check \(listing_url is null or "
                               r"public\.is_safe_https_url\(listing_url\)\)")
        self.assertIn("not is_safe_https_url(v_url)", function_sql(V100, "submit_comp"))

    def test_site_path_refuses_protocol_relative(self):
        fn = function_sql(V100, "is_site_path")
        self.assertIn("p !~ '^//'", fn)

    def test_https_scheme_is_case_insensitive(self):
        self.assertIn("p ~* '^https://", function_sql(V100, "is_safe_https_url"))

    def test_no_regex_repetition_over_postgres_limit(self):
        # Postgres rejects {m,n} with n > 255 ("invalid repetition count").
        for sql in SECURITY_SQL:
            for m in re.finditer(r"\{(\d+),(\d+)\}", strip_comments(sql)):
                self.assertLessEqual(int(m.group(2)), 255, m.group(0))

    def test_limiter_is_server_only(self):
        self.assertIn("revoke all on function public.request_subject() from public, anon, authenticated;", V100)
        self.assertIn("revoke all on function public.consume_rate_limit(text, text, integer, interval) "
                      "from public, anon, authenticated;", V100)
        self.assertIn("security definer", function_sql(V100, "consume_rate_limit"))

    def test_rate_limit_table_has_rls_and_no_policies(self):
        self.assertIn("alter table public.rate_limit_hits enable row level security;", V100)
        self.assertIn("revoke all on public.rate_limit_hits from anon, authenticated;", V100)
        for sql in SECURITY_SQL:
            self.assertNotRegex(sql, r"create policy \w+ on (public\.)?rate_limit_hits")

    def test_report_item_is_limited_and_still_anonymous(self):
        body = function_sql(V100, "report_item")
        self.assertIn("consume_rate_limit('report_item', request_subject()", body)
        self.assertIn("consume_rate_limit('report_item_anon'", body)
        self.assertIn("grant execute on function public.report_item(jsonb) to anon, authenticated;", V100)

    def test_submit_comp_keeps_its_guarantees(self):
        body = function_sql(V100, "submit_comp")
        self.assertRegex(body, r"values \(auth\.uid\(\),\s*-- never from the payload")
        self.assertIn("if claimed not in ('collector_report', 'auction_result')", body)
        self.assertIn("consume_rate_limit('submit_comp'", body)
        self.assertIn("revoke all on function public.submit_comp(jsonb) from public, anon;", V100)
        self.assertIn("grant execute on function public.submit_comp(jsonb) to authenticated;", V100)

    def test_existing_rows_are_cleaned_before_constraints(self):
        cleanup = V100.index("update public.comp_submissions set listing_url = null")
        constraint = V100.index("add constraint comp_submissions_listing_url_safe")
        self.assertLess(cleanup, constraint)
        self.assertNotIn("not valid", strip_comments(V100).lower())


class ReviewStampTests(unittest.TestCase):
    """L4 (20261008000101)."""

    def test_trigger_stamps_reviewer_on_all_three_tables(self):
        fn = function_sql(V101, "stamp_review")
        self.assertIn("new.reviewed_by := auth.uid();", fn)
        self.assertIn("new.reviewed_by := old.reviewed_by;", fn)
        for table in ("comp_submissions", "item_reports", "photo_submissions"):
            self.assertRegex(V101, r"create trigger %s_stamp_review before update on public\.%s\s+"
                                   r"for each row execute function public\.stamp_review\(\);" % (table, table))


class EntitlementGateTests(unittest.TestCase):
    """M1 (20261008000102)."""

    def test_old_owner_only_policies_are_dropped(self):
        self.assertIn("drop policy if exists collections_own on public.collections;", V102)
        self.assertIn("drop policy if exists flows_own on public.portfolio_flows;", V102)

    def test_no_for_all_policy(self):
        for table in ("collections", "portfolio_flows"):
            for name, stmt in policies(V102, table).items():
                self.assertNotRegex(stmt, r"\bfor all\b", name)

    def test_every_write_policy_checks_the_entitlement(self):
        for table, feature in (("collections", "collection_sync"), ("portfolio_flows", "hosted_history")):
            pols = policies(V102, table)
            writes = [s for s in pols.values() if re.search(r"\bfor (insert|update)\b", s)]
            self.assertEqual(len(writes), 2, table)
            for stmt in writes:
                self.assertIn("has_entitlement('%s')" % feature, stmt)

    def test_anon_cannot_run_add_collection_items(self):
        self.assertIn("revoke all on function public.add_collection_items(jsonb) from public, anon;", V102)


class ShowcasePhotoTests(unittest.TestCase):
    """M2 + L2 + L7 (20261008000103)."""

    def test_read_policy_is_not_bucket_only(self):
        stmt = policies(V103, "storage.objects")["showcase_photos_read"]
        self.assertNotRegex(stmt, r"using \(bucket_id = 'showcase-photos'\);")
        self.assertIn("showcase_photo_is_public(name)", stmt)
        self.assertIn("(storage.foldername(name))[1] = (select auth.uid())::text", stmt)
        self.assertIn("is_admin()", stmt)

    def test_public_check_binds_to_the_photo_owner(self):
        fn = function_sql(V103, "showcase_photo_is_public")
        self.assertIn("security definer", fn)
        self.assertIn("set search_path", fn)
        self.assertIn("s.user_id = owner", fn)
        self.assertIn("s.is_public and not s.hidden_by_admin", fn)
        self.assertIn("revoke all on function public.showcase_photo_is_public(text) from public, anon;", V103)

    def test_uploads_are_jpeg_with_generated_names(self):
        self.assertIn("set allowed_mime_types = array['image/jpeg']", V103)
        pols = policies(V103, "storage.objects")
        self.assertIn(r"'^[a-z0-9]{8,40}\.jpg$'", pols["showcase_photos_add"])
        self.assertIn(r"'^[a-z0-9-]{8,64}\.jpg$'", pols['"photo submissions: upload to own folder"'])

    def test_live_save_showcase_is_an_owner_todo(self):
        self.assertIn("save_showcase", V103)
        self.assertIn("TODO (owner)", V103)


class BillingTests(unittest.TestCase):
    """M3 (20261008000104)."""

    def test_grace_is_defined_once(self):
        hits = sum(len(re.findall(r"interval '7 days'", sql)) for sql in SECURITY_SQL)
        self.assertEqual(hits, 1)
        self.assertIn("interval '7 days'", function_sql(V104, "past_due_grace"))

    def test_current_tier_uses_the_grace(self):
        fn = function_sql(V104, "current_tier")
        self.assertIn("public.past_due_grace()", fn)
        self.assertIn("past_due_since", fn)

    def test_apply_subscription_state_is_service_role_only(self):
        sig = "public.apply_subscription_state(uuid, text, text, text, text, timestamptz, timestamptz)"
        self.assertRegex(V104, r"revoke all on function %s\s+from public, anon, authenticated;" % re.escape(sig))
        grants = re.findall(r"grant execute on function %s\s+to (\w+);" % re.escape(sig), V104)
        self.assertEqual(grants, ["service_role"])

    def test_ordering_guard(self):
        fn = function_sql(V104, "apply_subscription_state")
        self.assertIn("on conflict (user_id) do update", fn)
        self.assertRegex(fn, r"where s\.stripe_synced_at is null or excluded\.stripe_synced_at >= s\.stripe_synced_at")


if __name__ == "__main__":
    unittest.main()

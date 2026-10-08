-- Migration 05: database speed-ups flagged by Supabase's advisor.
-- Same rules as before; auth.uid() and is_admin() are now evaluated once per
-- query instead of once per row, and foreign keys get covering indexes.

-- admins_write used to look itself up in the admins table, which Postgres
-- rejects as infinite recursion on every read of admins. A security-definer
-- helper reads the table without going back through the policy.
create or replace function public.is_owner()
 returns boolean language sql stable security definer set search_path to 'public'
as $$ select exists (select 1 from admins a where a.user_id = auth.uid() and a.role = 'owner'); $$;

alter policy admins_write on public.admins
  using ((select public.is_owner())) with check ((select public.is_owner()));

alter policy admins_read on public.admins using ((select public.is_admin()));

alter policy collections_own on public.collections
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

alter policy comp_sub_read_own on public.comp_submissions
  using (user_id = (select auth.uid()) or (select public.is_admin()));

alter policy snapshots_read_own on public.holding_snapshots
  using ((select auth.uid()) = user_id);

alter policy snapshots_write_own on public.holding_snapshots
  with check ((select auth.uid()) = user_id and (select public.has_entitlement('hosted_history')));

alter policy photo_subs_read on public.photo_submissions
  using ((select auth.uid()) = submitter or (select public.is_admin()));

alter policy flows_own on public.portfolio_flows
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

alter policy showcases_delete on public.showcases
  using (user_id = (select auth.uid()) or (select public.is_admin()));

alter policy showcases_read on public.showcases
  using ((is_public and not hidden_by_admin) or user_id = (select auth.uid()) or (select public.is_admin()));

alter policy subs_read_own on public.subscriptions
  using ((select auth.uid()) = user_id);

create index if not exists collections_item_id_idx on public.collections (item_id);
create index if not exists comp_submissions_reviewed_by_idx on public.comp_submissions (reviewed_by);
create index if not exists holding_snapshots_collection_id_idx on public.holding_snapshots (collection_id);
create index if not exists holding_snapshots_item_id_idx on public.holding_snapshots (item_id);
create index if not exists item_photos_submission_id_idx on public.item_photos (submission_id);
create index if not exists item_reports_reviewed_by_idx on public.item_reports (reviewed_by);
create index if not exists item_reports_user_id_idx on public.item_reports (user_id);
create index if not exists photo_submissions_submitter_idx on public.photo_submissions (submitter);
create index if not exists portfolio_flows_item_id_idx on public.portfolio_flows (item_id);
create index if not exists sales_created_by_idx on public.sales (created_by);

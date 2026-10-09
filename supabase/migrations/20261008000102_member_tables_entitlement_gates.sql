-- ===========================================================================
-- Security M1: collections and portfolio_flows honour the membership.
--
-- Both had a single FOR ALL owner-only policy, so a free member could write
-- with a direct insert and skip the has_entitlement() check that
-- add_collection_items() makes. Writes now need the entitlement; reads and
-- deletes stay open to the owner on purpose - a lapsed member keeps, and can
-- erase, their own data.
--
-- The live site syncs through collection_entries (20261008000008); these two
-- tables have no frontend writer. Gating is reversible; dropping them is an
-- owner decision once live row counts are known (see the security spec).
-- ===========================================================================

drop policy if exists collections_own on public.collections;
drop policy if exists collections_read_own on public.collections;
drop policy if exists collections_add_entitled on public.collections;
drop policy if exists collections_change_entitled on public.collections;
drop policy if exists collections_remove_own on public.collections;
create policy collections_read_own on public.collections for select to authenticated
  using ((select auth.uid()) = user_id);
create policy collections_add_entitled on public.collections for insert to authenticated
  with check ((select auth.uid()) = user_id and (select public.has_entitlement('collection_sync')));
create policy collections_change_entitled on public.collections for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and (select public.has_entitlement('collection_sync')));
create policy collections_remove_own on public.collections for delete to authenticated
  using ((select auth.uid()) = user_id);
revoke all on public.collections from anon;

drop policy if exists flows_own on public.portfolio_flows;
drop policy if exists flows_read_own on public.portfolio_flows;
drop policy if exists flows_add_entitled on public.portfolio_flows;
drop policy if exists flows_change_entitled on public.portfolio_flows;
drop policy if exists flows_remove_own on public.portfolio_flows;
create policy flows_read_own on public.portfolio_flows for select to authenticated
  using ((select auth.uid()) = user_id);
create policy flows_add_entitled on public.portfolio_flows for insert to authenticated
  with check ((select auth.uid()) = user_id and (select public.has_entitlement('hosted_history')));
create policy flows_change_entitled on public.portfolio_flows for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and (select public.has_entitlement('hosted_history')));
create policy flows_remove_own on public.portfolio_flows for delete to authenticated
  using ((select auth.uid()) = user_id);
revoke all on public.portfolio_flows, public.holding_snapshots from anon;

-- add_collection_items refuses anonymous callers in its body; refuse them
-- before it runs as well (Supabase grants EXECUTE to anon by default).
revoke all on function public.add_collection_items(jsonb) from public, anon;
grant execute on function public.add_collection_items(jsonb) to authenticated;

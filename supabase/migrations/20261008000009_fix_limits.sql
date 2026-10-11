-- Migration 09: the per-member row limits on wishlists, collection_entries and
-- saved_reports counted rows of the same table inside its own policy, which
-- Postgres rejects as infinite recursion - so every insert failed. The count
-- now comes from a security-definer helper. Already applied to the live project.

create or replace function public.my_row_count(tbl text)
 returns bigint language plpgsql stable security definer set search_path to 'public'
as $$
declare n bigint;
begin
  if tbl = 'wishlists' then select count(*) into n from wishlists where user_id = auth.uid();
  elsif tbl = 'collection_entries' then select count(*) into n from collection_entries where user_id = auth.uid();
  elsif tbl = 'saved_reports' then select count(*) into n from saved_reports where user_id = auth.uid();
  else raise exception 'unknown table';
  end if;
  return n;
end $$;
revoke all on function public.my_row_count(text) from public, anon;
grant execute on function public.my_row_count(text) to authenticated;

alter policy wishlists_add_own on public.wishlists
  with check (user_id = (select auth.uid()) and (select public.my_row_count('wishlists')) < 500);
alter policy collection_entries_add on public.collection_entries
  with check (user_id = (select auth.uid()) and (select public.has_entitlement('collection_sync'))
    and (select public.my_row_count('collection_entries')) < 5000);
alter policy saved_reports_add on public.saved_reports
  with check (user_id = (select auth.uid()) and (select public.has_entitlement('insurance_archive'))
    and (select public.my_row_count('saved_reports')) < 200);

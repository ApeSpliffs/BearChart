-- ===========================================================================
-- Paywall integrity: the sold-comps CSV becomes a server-checked Power feature.
--
-- The CSV used to be a button that asked has_entitlement('api_access') from the
-- browser and then built the file from data the page already held: a lock the
-- visitor holds the key to. Now the export-comps edge function builds the file
-- after claim_export_quota() says yes. It ships switched off (config.features.
-- comps_export = false and COMPS_EXPORT_ENABLED unset) pending legal review.
--
-- What this enforces is the CONVENIENCE of one bulk download, rate limited, not
-- access to the records: sales_public_read still lets anyone page through the
-- sales table, and every comp stays listed, free, on its bear's page. The plans
-- copy says so.
--
-- Idempotent: CI re-applies every migration and expects the same end state.
-- ===========================================================================

-- Power gains comps_export. Everything 20261008000004_showcases.sql granted is
-- kept, showcase included (tools/test_membership.py checks every entitlement a
-- plan sells is in this list).
create or replace function public.has_entitlement(feature text)
 returns boolean
 language sql
 stable
 set search_path to 'public'
as $function$
  select case current_tier()
    when 'power' then feature in (
      'collection_sync','hosted_history','insurance_archive','id_priority',
      'alerts_push','alerts_email','poll_priority','outfit_assembly','api_access',
      'value_digest','wishlist_alerts','showcase','comps_export')
    when 'pro' then feature in (
      'collection_sync','hosted_history','insurance_archive','id_priority','wishlist_alerts')
    else false
  end;
$function$;

-- One row per successful export. RLS on and no policies: only the definer
-- function below writes it and nobody reads it through the API.
create table if not exists public.export_log (
  id         bigserial primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  rows       integer not null check (rows >= 0),
  created_at timestamptz not null default now()
);
create index if not exists export_log_user_recent_idx on public.export_log (user_id, created_at desc);
alter table public.export_log enable row level security;
revoke all on public.export_log from anon, authenticated;

-- May the caller export p_rows rows now? True records the export. At most 10
-- exports and 20,000 rows per rolling 24 hours. Callers check has_entitlement
-- first, so a false here with the entitlement means "over quota".
create or replace function public.claim_export_quota(p_rows integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  n_exports integer;
  n_rows bigint;
begin
  if uid is null then return false; end if;
  if not (public.has_entitlement('comps_export') or public.is_admin()) then return false; end if;
  if p_rows is null or p_rows < 0 then raise exception 'p_rows must be a non-negative count'; end if;
  -- One claim at a time per member, so two parallel requests cannot both fit
  -- under the limit.
  perform pg_advisory_xact_lock(hashtextextended('export_quota:' || uid::text, 0));
  select count(*), coalesce(sum(rows), 0) into n_exports, n_rows
    from public.export_log
   where user_id = uid and created_at > now() - interval '24 hours';
  if n_exports >= 10 or n_rows + p_rows > 20000 then return false; end if;
  insert into public.export_log (user_id, rows) values (uid, p_rows);
  return true;
end $$;

revoke all on function public.claim_export_quota(integer) from public, anon;
grant execute on function public.claim_export_quota(integer) to authenticated;

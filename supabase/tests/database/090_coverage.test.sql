-- Guards against something being forgotten: a new table without RLS, a new
-- table without tests, a SECURITY DEFINER function without a pinned search_path.
begin;
select plan(3);
select is_empty($$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity $$,
  'every public table has RLS enabled');
select set_eq($$ select tablename::text from pg_tables where schemaname = 'public' $$,
  array['admins','items','sales','valuation_config','collections','subscriptions','stripe_events',
        'holding_snapshots','portfolio_flows','comp_submissions','item_reports','photo_submissions',
        'item_photos','showcases','wishlists','collection_entries','value_history','saved_reports',
        'showcase_likes','rate_limit_hits','export_log','waitlist'],
  'table inventory: a new table must come with RLS tests (add it here and in a test file)');
select is_empty($$ select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.prosecdef
                     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%') $$,
  'every SECURITY DEFINER function pins search_path');
select * from finish();
rollback;

-- Comps export (migration 20261008000200): Power-only, server-checked, with a
-- rolling daily quota. The export_log is invisible to every API role.
begin;
select no_plan();
select tests.seed_personas();

-- has_entitlement('comps_export') per persona
select tests.as_user('power');       select ok(public.has_entitlement('comps_export'), 'power: comps_export');
select tests.as_user('trial_power'); select ok(public.has_entitlement('comps_export'), 'trialing power: comps_export');
select tests.as_user('power');       select ok(public.has_entitlement('showcase'), 'power: showcase kept');
select tests.as_user('pro');         select ok(not public.has_entitlement('comps_export'), 'pro: no comps_export');
select tests.as_user('free');        select ok(not public.has_entitlement('comps_export'), 'free: no comps_export');
select tests.as_user('lapsed');      select ok(not public.has_entitlement('comps_export'), 'lapsed: no comps_export');
select tests.as_anon();              select ok(not public.has_entitlement('comps_export'), 'anon: no comps_export');

-- claim_export_quota: refused without the entitlement, and logs nothing
select tests.as_user('pro');
select is(public.claim_export_quota(10), false, 'pro: quota refused');
select tests.as_user('free');
select is(public.claim_export_quota(10), false, 'free: quota refused');
select tests.as_anon();
select throws_ok($$ select public.claim_export_quota(10) $$, '42501', null,
  'anon: cannot call claim_export_quota');
select tests.as_postgres();
select is((select count(*) from public.export_log), 0::bigint, 'refusals are not logged');

-- Power: 10 exports a day, then refused
select tests.as_user('power');
select is(public.claim_export_quota(100), true, 'power: first export allowed');
select is((select count(*)::int from generate_series(2, 10) g where public.claim_export_quota(100)), 9,
  'power: exports 2-10 allowed');
select is(public.claim_export_quota(1), false, 'power: the 11th export in 24 hours is refused');
select throws_ok($$ select public.claim_export_quota(-1) $$, null, null, 'negative row counts are refused');

-- Power: 20,000 rows a day, then refused
select tests.as_user('trial_power');
select is(public.claim_export_quota(19000), true, 'trial_power: 19,000 rows allowed');
select is(public.claim_export_quota(1001), false, 'trial_power: over 20,000 rows in 24 hours is refused');
select is(public.claim_export_quota(1000), true, 'trial_power: exactly 20,000 rows allowed');

-- Older exports fall out of the rolling window
select tests.as_postgres();
update public.export_log set created_at = now() - interval '25 hours' where user_id = tests.uid('power');
select tests.as_user('power');
select is(public.claim_export_quota(100), true, 'power: the window rolls after 24 hours');

-- Admins may export without a subscription
select tests.as_user('admin');
select is(public.claim_export_quota(5), true, 'admin: export allowed');

-- export_log: no API role reads or writes it
select tests.as_user('power');
select throws_ok($$ select 1 from public.export_log $$, '42501', null, 'power: cannot read export_log');
select throws_ok(format($$ insert into public.export_log (user_id, rows) values (%L, 1) $$, tests.uid('power')),
  '42501', null, 'power: cannot write export_log');
select tests.as_anon();
select throws_ok($$ select 1 from public.export_log $$, '42501', null, 'anon: cannot read export_log');
select tests.as_postgres();
select ok((select relrowsecurity from pg_class where oid = 'public.export_log'::regclass), 'export_log has RLS');
select is((select count(*) from pg_policies where schemaname = 'public' and tablename = 'export_log'), 0::bigint,
  'export_log has no policies');
select ok(has_function_privilege('authenticated', 'public.claim_export_quota(integer)', 'execute'),
  'authenticated may call claim_export_quota');
select ok(not has_function_privilege('anon', 'public.claim_export_quota(integer)', 'execute'),
  'anon may not call claim_export_quota');

select * from finish();
rollback;

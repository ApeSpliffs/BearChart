-- past_due grace: a failed card should not cut a member off on day one, but
-- the grace must end. Grace anchor: past_due_since + past_due_grace()
-- (20261008000104_billing_grace_and_sync.sql).
begin;
select no_plan();
select tests.seed_personas();

select is(public.past_due_grace(), interval '7 days', 'past_due_grace() is the 7-day constant');

select tests.as_user('pastdue_grace');
select is(public.current_tier(), 'pro', 'pastdue_grace: still pro inside the grace window');
select ok(public.has_entitlement('collection_sync'), 'pastdue_grace: keeps collection_sync');
select lives_ok($$ insert into public.collection_entries (id, entry) values ('grace-0001', '{}') $$,
  'pastdue_grace: can still sync');

select tests.as_user('pastdue_expired');
select is(public.current_tier(), 'free', 'pastdue_expired: free once the grace has run out');
select ok(not public.has_entitlement('collection_sync'), 'pastdue_expired: no collection_sync');
select throws_ok($$ insert into public.collection_entries (id, entry) values ('expd-0001', '{}') $$,
  '42501', null, 'pastdue_expired: cannot sync');
select tests.as_user('lapsed');
select is(public.current_tier(), 'free', 'lapsed (canceled): free, no grace');

-- A past_due row with no anchor (written before past_due_since existed and not
-- backfilled) is not treated as inside the grace.
select tests.as_postgres();
update public.subscriptions set past_due_since = null where user_id = tests.uid('pastdue_grace');
select tests.as_user('pastdue_grace');
select is(public.current_tier(), 'free', 'past_due with no past_due_since: free');

-- apply_subscription_state: the webhook's only write path.
select tests.as_user('free');
select throws_ok(format($$ select public.apply_subscription_state(%L, 'power', 'active', 'cus_x', 'sub_x', now() + interval '30 days', now()) $$,
  tests.uid('free')), '42501', null, 'authenticated: cannot call apply_subscription_state');
select tests.as_anon();
select throws_ok(format($$ select public.apply_subscription_state(%L, 'power', 'active', 'cus_x', 'sub_x', now() + interval '30 days', now()) $$,
  tests.uid('free')), '42501', null, 'anon: cannot call apply_subscription_state');

select tests.as_service();
select ok(public.apply_subscription_state(tests.uid('other'), 'power', 'active', 'cus_other', 'sub_other_1',
  now() + interval '30 days', '2026-01-02T00:00:00Z'), 'service_role: applies a fresh state');
select ok(not public.apply_subscription_state(tests.uid('other'), 'free', 'canceled', 'cus_other', 'sub_other_1',
  null, '2026-01-01T00:00:00Z'), 'service_role: an older sync is skipped');
select ok(public.apply_subscription_state(tests.uid('other'), 'power', 'past_due', 'cus_other', 'sub_other_1',
  now() + interval '30 days', '2026-01-03T00:00:00Z'), 'service_role: goes past_due');
select tests.as_postgres();
select isnt((select past_due_since from public.subscriptions where user_id = tests.uid('other')), null,
  'past_due_since is stamped on the first past_due');
update public.subscriptions set past_due_since = now() - interval '2 days' where user_id = tests.uid('other');
select tests.as_service();
select ok(public.apply_subscription_state(tests.uid('other'), 'power', 'past_due', 'cus_other', 'sub_other_1',
  now() + interval '30 days', '2026-01-04T00:00:00Z'), 'service_role: still past_due');
select tests.as_postgres();
select ok((select past_due_since < now() - interval '1 day' from public.subscriptions where user_id = tests.uid('other')),
  'a repeated past_due keeps the original anchor (the grace does not restart)');
select tests.as_service();
select ok(public.apply_subscription_state(tests.uid('other'), 'power', 'active', 'cus_other', 'sub_other_1',
  now() + interval '30 days', '2026-01-05T00:00:00Z'), 'service_role: recovers to active');
select tests.as_postgres();
select is((select past_due_since from public.subscriptions where user_id = tests.uid('other')), null,
  'past_due_since clears when the member pays');
select tests.as_user('other');
select is(public.current_tier(), 'power', 'other: power after the synced state');

select * from finish();
rollback;

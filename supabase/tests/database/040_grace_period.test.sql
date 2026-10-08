-- past_due grace: a failed card should not cut a member off on day one, but
-- the grace must end. Grace anchor: current_period_end + 7 days.
begin;
select no_plan();
select tests.seed_personas();

select tests.as_user('pastdue_grace');
select todo_start('security workstream 20261008000100+: 7-day past_due grace (past_due_grace())');
select is(public.current_tier(), 'pro', 'pastdue_grace: still pro inside the grace window');
select ok(public.has_entitlement('collection_sync'), 'pastdue_grace: keeps collection_sync');
select lives_ok($$ insert into public.collection_entries (id, entry) values ('grace-0001', '{}') $$,
  'pastdue_grace: can still sync');
select todo_end();

-- True today and after the grace lands.
select tests.as_user('pastdue_expired');
select is(public.current_tier(), 'free', 'pastdue_expired: free once the grace has run out');
select ok(not public.has_entitlement('collection_sync'), 'pastdue_expired: no collection_sync');
select throws_ok($$ insert into public.collection_entries (id, entry) values ('expd-0001', '{}') $$,
  '42501', null, 'pastdue_expired: cannot sync');
select tests.as_user('lapsed');
select is(public.current_tier(), 'free', 'lapsed (canceled): free, no grace');

select * from finish();
rollback;

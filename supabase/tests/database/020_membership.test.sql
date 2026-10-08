-- Membership state: written only by the payment webhook (service role).
begin;
select no_plan();
select tests.seed_personas();

-- subscriptions: own row only, never writable by a client
select tests.as_user('pro');
select is((select count(*) from public.subscriptions), 1::bigint, 'pro: sees exactly their own subscription');
select is((select user_id from public.subscriptions), tests.uid('pro'), 'pro: the row is their own');
select is(tests.affected($$ update public.subscriptions set tier = 'power' $$), 0::bigint,
  'pro: cannot upgrade themselves');
select is(tests.affected($$ delete from public.subscriptions $$), 0::bigint, 'pro: cannot delete their row');
select tests.as_user('power');
select is((select count(*) from public.subscriptions), 1::bigint, 'power: sees exactly their own subscription');
select tests.as_user('free');
select is((select count(*) from public.subscriptions), 0::bigint, 'free: sees no subscriptions');
select throws_ok(format($$ insert into public.subscriptions (user_id, tier, status) values (%L, 'power', 'active') $$,
  tests.uid('free')), '42501', null, 'free: cannot grant themselves a subscription');
select tests.as_user('admin');
select is((select count(*) from public.subscriptions), 0::bigint, 'admin: sees no one else''s subscription');
select tests.as_anon();
select is_empty($$ select 1 from public.subscriptions $$, 'anon: sees no subscriptions');

-- stripe_events: RLS on, no policies; only the service role
select tests.as_anon();
select is_empty($$ select 1 from public.stripe_events $$, 'anon: cannot read stripe_events');
select throws_ok($$ insert into public.stripe_events (id, type) values ('evt_anon', 'x') $$,
  '42501', null, 'anon: cannot write stripe_events');
select tests.as_user('free');
select is_empty($$ select 1 from public.stripe_events $$, 'free: cannot read stripe_events');
select throws_ok($$ insert into public.stripe_events (id, type) values ('evt_free', 'x') $$,
  '42501', null, 'free: cannot write stripe_events');
select tests.as_user('admin');
select is_empty($$ select 1 from public.stripe_events $$, 'admin: cannot read stripe_events');
select throws_ok($$ insert into public.stripe_events (id, type) values ('evt_admin', 'x') $$,
  '42501', null, 'admin: cannot write stripe_events');
select tests.as_service();
select lives_ok($$ insert into public.stripe_events (id, type) values ('evt_service', 'x') $$,
  'service role: records a webhook event');

-- current_tier() per persona
select tests.as_user('free');            select is(public.current_tier(), 'free',  'current_tier: free');
select tests.as_user('pro');             select is(public.current_tier(), 'pro',   'current_tier: pro');
select tests.as_user('power');           select is(public.current_tier(), 'power', 'current_tier: power');
select tests.as_user('trial_power');     select is(public.current_tier(), 'power', 'current_tier: trialing power');
select tests.as_user('lapsed');          select is(public.current_tier(), 'free',  'current_tier: canceled reads free');
select tests.as_user('pastdue_expired'); select is(public.current_tier(), 'free',  'current_tier: past_due beyond grace reads free');
select tests.as_user('admin');           select is(public.current_tier(), 'free',  'current_tier: admin is not a paid tier');
select tests.as_anon();                  select is(public.current_tier(), 'free',  'current_tier: anon');

-- has_entitlement matrix
select tests.as_user('pro');
select ok(public.has_entitlement('collection_sync'), 'pro: collection_sync');
select ok(not public.has_entitlement('showcase'),    'pro: no showcase');
select ok(not public.has_entitlement('api_access'),  'pro: no api_access');
select tests.as_user('power');
select ok(public.has_entitlement('collection_sync'), 'power: collection_sync');
select ok(public.has_entitlement('showcase'),        'power: showcase');
select ok(public.has_entitlement('api_access'),      'power: api_access');
select tests.as_user('free');
select ok(not public.has_entitlement('collection_sync'), 'free: no collection_sync');
select ok(not public.has_entitlement('showcase'),        'free: no showcase');
select tests.as_user('lapsed');
select ok(not public.has_entitlement('collection_sync'), 'lapsed: no collection_sync');
select ok(not public.has_entitlement('api_access'),      'lapsed: no api_access');

select * from finish();
rollback;

-- Collection sync (Pro and Power): the gate is in the database, not the page.
begin;
select no_plan();
select tests.seed_personas();

-- collections via the RPC: the gated path
select tests.as_user('free');
select throws_like($$ select public.add_collection_items('[{"item_id_slug":"rls-test-bear"}]') $$,
  '%requires a Pro membership%', 'free: add_collection_items refused');
select tests.as_user('pro');
select is(public.add_collection_items('[{"item_id_slug":"rls-test-bear"}]'), 1, 'pro: add_collection_items adds 1');
select tests.as_user('lapsed');
select throws_like($$ select public.add_collection_items('[{"item_id_slug":"rls-test-bear"}]') $$,
  '%requires a Pro membership%', 'lapsed: add_collection_items refused');
select tests.as_anon();
select throws_ok($$ select public.add_collection_items('[{"item_id_slug":"rls-test-bear"}]') $$,
  '42501', null, 'anon: add_collection_items not executable');

-- collections direct writes: gated on collection_sync like the RPC
-- (20261008000102_member_tables_entitlement_gates.sql)
select tests.as_user('free');
select throws_ok(
  format($$ insert into public.collections (user_id, item_id)
            select %L, id from public.items where slug = 'rls-test-bear' $$, tests.uid('free')),
  '42501', null, 'free: direct insert into collections refused');
select tests.as_user('pro');
select lives_ok(
  format($$ insert into public.collections (user_id, item_id, qty)
            select %L, id, 2 from public.items where slug = 'rls-test-bear' $$, tests.uid('pro')),
  'pro: direct insert into own collection allowed');
select tests.as_user('lapsed');
select throws_ok(
  format($$ insert into public.collections (user_id, item_id)
            select %L, id from public.items where slug = 'rls-test-bear' $$, tests.uid('lapsed')),
  '42501', null, 'lapsed: direct insert into collections refused');
select tests.as_postgres();
insert into public.collections (user_id, item_id)
  select tests.uid('lapsed'), id from public.items where slug = 'rls-test-bear';
select tests.as_user('lapsed');
select is((select count(*) from public.collections), 1::bigint, 'lapsed: still reads own collection');
select throws_ok($$ update public.collections set qty = 5 $$,
  '42501', null, 'lapsed: cannot change collection rows');
select is(tests.affected($$ delete from public.collections $$), 1::bigint, 'lapsed: can delete own rows');

-- portfolio_flows: writes need hosted_history; reads/deletes stay with the owner
select tests.as_user('free');
select throws_ok(format($$ insert into public.portfolio_flows (user_id, occurred_on, direction, value_cents)
  values (%L, current_date, 'acquire', 100) $$, tests.uid('free')),
  '42501', null, 'free: portfolio_flows insert refused');
select tests.as_user('pro');
select lives_ok(format($$ insert into public.portfolio_flows (user_id, occurred_on, direction, value_cents)
  values (%L, current_date, 'acquire', 100) $$, tests.uid('pro')),
  'pro: portfolio_flows insert allowed');
select throws_ok(format($$ insert into public.portfolio_flows (user_id, occurred_on, direction, value_cents)
  values (%L, current_date, 'acquire', 100) $$, tests.uid('power')),
  '42501', null, 'pro: cannot write another member''s flows');
select tests.as_user('other');
select is_empty($$ select 1 from public.portfolio_flows $$, 'other: sees no one else''s flows');
select tests.as_anon();
select throws_ok($$ select 1 from public.portfolio_flows $$, '42501', null, 'anon: no access to portfolio_flows');
select throws_ok($$ select 1 from public.holding_snapshots $$, '42501', null, 'anon: no access to holding_snapshots');

-- isolation
select tests.as_user('other');
select is_empty($$ select 1 from public.collections where user_id <> tests.uid('other') $$,
  'other: cannot see anyone else''s collection');
select is(tests.affected(format($$ delete from public.collections where user_id <> %L $$, tests.uid('other'))),
  0::bigint, 'other: cannot delete others'' rows');
select throws_ok(
  format($$ insert into public.collections (user_id, item_id)
            select %L, id from public.items where slug = 'rls-test-bear' $$, tests.uid('pro')),
  '42501', null, 'other: cannot write into somebody else''s collection');
select tests.as_anon();
select throws_ok($$ select 1 from public.collections $$, '42501', null, 'anon: no access to collections');

-- collection_entries (collection_sync)
select tests.as_user('free');
select throws_ok($$ insert into public.collection_entries (id, entry) values ('free-0001', '{}') $$,
  '42501', null, 'free: collection_entries insert refused');
select tests.as_user('pro');
select lives_ok($$ insert into public.collection_entries (id, entry) values ('pro-00001', '{}') $$,
  'pro: collection_entries insert allowed');
select tests.as_user('power');
select lives_ok($$ insert into public.collection_entries (id, entry) values ('pow-00001', '{}') $$,
  'power: collection_entries insert allowed');
select throws_ok(format($$ insert into public.collection_entries (user_id, id, entry) values (%L, 'pow-00002', '{}') $$,
  tests.uid('pro')), '42501', null, 'power: cannot write into another member''s entries');
select tests.as_user('lapsed');
select throws_ok($$ insert into public.collection_entries (id, entry) values ('lap-00001', '{}') $$,
  '42501', null, 'lapsed: collection_entries insert refused');
select tests.as_postgres();
insert into public.collection_entries (user_id, id, entry) values (tests.uid('lapsed'), 'lap-00002', '{}');
select tests.as_user('lapsed');
select is((select count(*) from public.collection_entries), 1::bigint, 'lapsed: still reads own entries');
select throws_ok($$ update public.collection_entries set entry = '{"x":1}' $$,
  '42501', null, 'lapsed: cannot change entries');
select is(tests.affected($$ delete from public.collection_entries $$), 1::bigint, 'lapsed: can delete own');
select tests.as_user('other');
select is_empty($$ select 1 from public.collection_entries $$, 'other: sees none of pro/power entries');
select is(tests.affected($$ update public.collection_entries set entry = '{}' $$), 0::bigint,
  'other: cannot touch pro/power entries');
select tests.as_anon();
select throws_ok($$ select 1 from public.collection_entries $$, '42501', null, 'anon: no access to collection_entries');

select * from finish();
rollback;

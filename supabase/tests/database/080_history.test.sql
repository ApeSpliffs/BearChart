-- Hosted history and reports: writing is paid, reading your own is forever.
begin;
select no_plan();
select tests.seed_personas();

-- value_history (hosted_history)
select tests.as_user('free');
select throws_ok($$ insert into public.value_history (day, snap) values (current_date, '{}') $$,
  '42501', null, 'free: value_history insert refused');
select tests.as_user('pro');
select lives_ok($$ insert into public.value_history (day, snap) values (current_date, '{}') $$,
  'pro: value_history insert allowed');
select tests.as_user('other');
select is_empty($$ select 1 from public.value_history $$, 'other: sees none of pro''s history');
select tests.as_anon();
select throws_ok($$ select 1 from public.value_history $$, '42501', null, 'anon: no access to value_history');

-- saved_reports (insurance_archive)
select tests.as_user('free');
select throws_ok($$ insert into public.saved_reports (kind, filename, body) values ('cover_letter', 'a.txt', 'x') $$,
  '42501', null, 'free: saved_reports insert refused');
select tests.as_user('power');
select lives_ok($$ insert into public.saved_reports (kind, filename, body) values ('cover_letter', 'a.txt', 'x') $$,
  'power: saved_reports insert allowed');
select tests.as_user('other');
select is_empty($$ select 1 from public.saved_reports $$, 'other: sees none of power''s reports');

-- holding_snapshots (hosted_history insert, own read)
select tests.as_postgres();
insert into public.collections (user_id, item_id)
select u, i.id from public.items i, unnest(array[tests.uid('pro'), tests.uid('free'), tests.uid('lapsed')]) u
where i.slug = 'rls-test-bear';
select tests.as_user('pro');
select lives_ok($$ insert into public.holding_snapshots (snapshot_date, user_id, collection_id, item_id, qty, confidence)
                   select current_date, c.user_id, c.id, c.item_id, 1, 'low' from public.collections c $$,
  'pro: writes a snapshot');
select tests.as_user('free');
select throws_ok($$ insert into public.holding_snapshots (snapshot_date, user_id, collection_id, item_id, qty, confidence)
                    select current_date, c.user_id, c.id, c.item_id, 1, 'low' from public.collections c $$,
  '42501', null, 'free: snapshot insert refused');

-- A lapsed member keeps reading what they already have.
select tests.as_postgres();
insert into public.value_history (user_id, day, snap) values (tests.uid('lapsed'), current_date, '{}');
insert into public.saved_reports (user_id, kind, filename, body) values (tests.uid('lapsed'), 'cover_letter', 'b.txt', 'y');
insert into public.holding_snapshots (snapshot_date, user_id, collection_id, item_id, qty, confidence)
select current_date, c.user_id, c.id, c.item_id, 1, 'low' from public.collections c where c.user_id = tests.uid('lapsed');
select tests.as_user('lapsed');
select is((select count(*) from public.value_history), 1::bigint, 'lapsed: reads own value_history');
select is((select count(*) from public.saved_reports), 1::bigint, 'lapsed: reads own saved_reports');
select is((select count(*) from public.holding_snapshots), 1::bigint, 'lapsed: reads own snapshots');
select throws_ok($$ insert into public.value_history (day, snap) values (current_date - 1, '{}') $$,
  '42501', null, 'lapsed: cannot add history');

-- portfolio_flows (own only; writes need hosted_history since 20261008000102)
select tests.as_user('free');
select throws_ok(format($$ insert into public.portfolio_flows (user_id, occurred_on, direction, value_cents) values (%L, current_date, 'acquire', 100) $$,
  tests.uid('free')), '42501', null, 'free: cannot record a flow (hosted_history)');
select tests.as_postgres();
insert into public.portfolio_flows (user_id, occurred_on, direction, value_cents)
  values (tests.uid('free'), current_date, 'acquire', 100);
select tests.as_user('free');
select throws_ok(format($$ insert into public.portfolio_flows (user_id, occurred_on, direction, value_cents) values (%L, current_date, 'acquire', 100) $$,
  tests.uid('pro')), '42501', null, 'free: cannot record a flow for somebody else');
select is((select count(*) from public.portfolio_flows), 1::bigint, 'free: still reads own flow');
select tests.as_user('other');
select is_empty($$ select 1 from public.portfolio_flows $$, 'other: sees none of free''s flows');

-- wishlists (free may keep one)
select tests.as_user('free');
select lives_ok($$ insert into public.wishlists (item_id) values ('rls-test-bear') $$, 'free: adds to wishlist');
select tests.as_anon();
select throws_ok($$ insert into public.wishlists (user_id, item_id) values (gen_random_uuid(), 'rls-test-bear') $$,
  '42501', null, 'anon: no wishlist');
select tests.as_user('other');
select is_empty($$ select 1 from public.wishlists $$, 'other: sees none of free''s wishlist');
select is(tests.affected($$ delete from public.wishlists $$), 0::bigint, 'other: cannot clear free''s wishlist');

select * from finish();
rollback;

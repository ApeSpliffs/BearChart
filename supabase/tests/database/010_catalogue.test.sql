-- The public price guide: anyone reads, only admins write.
begin;
select no_plan();
select tests.seed_personas();

-- Public read
select tests.as_anon();
select isnt_empty($$ select 1 from public.items $$,            'anon: reads items');
select isnt_empty($$ select 1 from public.sales $$,            'anon: reads sales');
select isnt_empty($$ select 1 from public.valuation_config $$, 'anon: reads valuation_config');
select isnt_empty($$ select 1 from public.market_sales $$,     'anon: reads market_sales');
select isnt_empty($$ select 1 from public.item_photos $$,      'anon: reads item_photos');
select tests.as_user('free');
select isnt_empty($$ select 1 from public.items $$,            'free: reads items');
select isnt_empty($$ select 1 from public.market_sales $$,     'free: reads market_sales');
select isnt_empty($$ select 1 from public.item_photos $$,      'free: reads item_photos');
select tests.as_user('pro');
select isnt_empty($$ select 1 from public.sales $$,            'pro: reads sales');
select isnt_empty($$ select 1 from public.valuation_config $$, 'pro: reads valuation_config');

-- Nobody but an admin writes
select tests.as_anon();
select throws_ok($$ insert into public.items (slug, canonical_name, category) values ('anon-bear', 'x', 'bear') $$,
  '42501', null, 'anon: cannot insert items');
select throws_ok($$ insert into public.sales (item_id, sold_price, evidence_type)
                    select id, 1, 'collector_report' from public.items where slug = 'rls-test-bear' $$,
  '42501', null, 'anon: cannot insert sales');
select is(tests.affected($$ update public.items set notes = 'x' $$), 0::bigint, 'anon: cannot update items');
select is(tests.affected($$ delete from public.sales $$), 0::bigint, 'anon: cannot delete sales');

select tests.as_user('free');
select throws_ok($$ insert into public.items (slug, canonical_name, category) values ('free-bear', 'x', 'bear') $$,
  '42501', null, 'free: cannot insert items');
select throws_ok($$ insert into public.valuation_config (key, value) values ('x', '{}') $$,
  '42501', null, 'free: cannot insert valuation_config');
select throws_ok($$ insert into public.item_photos (item_slug, image_url) values ('free-bear', 'https://x.test/a.jpg') $$,
  '42501', null, 'free: cannot insert item_photos');
select is(tests.affected($$ update public.sales set notes = 'x' $$), 0::bigint, 'free: cannot update sales');
select is(tests.affected($$ update public.valuation_config set value = '{}' $$), 0::bigint,
  'free: cannot update valuation_config');
select is(tests.affected($$ delete from public.items $$), 0::bigint, 'free: cannot delete items');

select tests.as_user('power');
select throws_ok($$ insert into public.items (slug, canonical_name, category) values ('power-bear', 'x', 'bear') $$,
  '42501', null, 'power: paying does not make you an editor');
select is(tests.affected($$ delete from public.item_photos $$), 0::bigint, 'power: cannot delete item_photos');

select tests.as_user('admin');
select lives_ok($$ insert into public.items (slug, canonical_name, category) values ('admin-bear', 'Admin Bear', 'bear') $$,
  'admin: inserts items');
select lives_ok($$ insert into public.sales (item_id, sold_price, evidence_type)
                   select id, 12, 'collector_report' from public.items where slug = 'admin-bear' $$,
  'admin: inserts sales');
select is(tests.affected($$ update public.items set notes = 'checked' where slug = 'admin-bear' $$), 1::bigint,
  'admin: updates items');
select is(tests.affected($$ delete from public.sales where item_id = (select id from public.items where slug = 'admin-bear') $$),
  1::bigint, 'admin: deletes sales');
select throws_ok($$ insert into public.sales (item_id, sold_price, evidence_type)
                    select id, 12, 'completed_sale' from public.items where slug = 'admin-bear' $$,
  '23514', null, 'a completed_sale without provenance is refused by the check constraint');

-- The admin roster
select tests.as_user('free');
select is_empty($$ select 1 from public.admins $$, 'free: cannot read admins');
select throws_ok(format($$ insert into public.admins (user_id, role) values (%L, 'owner') $$, tests.uid('free')),
  '42501', null, 'free: cannot make themselves an admin');
select tests.as_user('admin');
select isnt_empty($$ select 1 from public.admins $$, 'admin: reads admins');
select throws_ok(format($$ insert into public.admins (user_id, role) values (%L, 'editor') $$, tests.uid('other')),
  '42501', null, 'editor admin: cannot add admins');
select is(tests.affected($$ update public.admins set role = 'owner' $$), 0::bigint,
  'editor admin: cannot promote themselves');
select tests.as_user('owner');
select lives_ok(format($$ insert into public.admins (user_id, role) values (%L, 'editor') $$, tests.uid('other')),
  'owner: adds an admin');

select * from finish();
rollback;

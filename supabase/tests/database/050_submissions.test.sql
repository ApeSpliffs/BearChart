-- Collector submissions and reports: nothing a stranger sends reaches a price.
begin;
select no_plan();
select tests.seed_personas();

-- submit_comp
select tests.as_anon();
-- Supabase's default privileges grant EXECUTE to anon; the function body refuses.
select throws_like($$ select public.submit_comp('{"item_slug":"rls-test-bear","sold_price":20}') $$,
  '%sign in%', 'anon: submit_comp refused');
select tests.as_user('free');
select lives_ok($$ select public.submit_comp('{"item_slug":"rls-test-bear","sold_price":20}') $$,
  'free: submits a comp');
select throws_like($$ select public.submit_comp('{"item_slug":"rls-test-bear","sold_price":20}') $$,
  '%already have a pending submission%', 'free: one pending submission per item');
select throws_like($$ select public.submit_comp('{"item_slug":"rls-test-bear","sold_price":20,"claimed_type":"completed_sale"}') $$,
  '%verified by a reviewer%', 'free: cannot claim completed_sale');
select throws_like($$ select public.submit_comp('{"item_slug":"no-such-bear","sold_price":20}') $$,
  '%unknown item%', 'free: unknown item refused');
select throws_ok(format($$ insert into public.comp_submissions (user_id, item_slug, sold_price) values (%L, 'rls-test-bear', 1) $$,
  tests.uid('free')), '42501', null, 'free: no direct insert into comp_submissions');
select is((select count(*) from public.comp_submissions), 1::bigint, 'free: sees own submission');
select is(tests.affected($$ update public.comp_submissions set status = 'accepted' $$), 0::bigint,
  'free: cannot accept their own submission');
select tests.as_user('other');
select is_empty($$ select 1 from public.comp_submissions $$, 'other: cannot see free''s submissions');
select tests.as_user('admin');
select isnt_empty($$ select 1 from public.comp_submissions $$, 'admin: sees submissions');
select is(tests.affected($$ update public.comp_submissions set status = 'needs_info' $$), 1::bigint,
  'admin: reviews submissions');

-- report_item
select tests.as_anon();
select lives_ok($$ select public.report_item('{"item_slug":"rls-test-bear","reason":"wrong_year"}') $$,
  'anon: reports a problem');
select is_empty($$ select 1 from public.item_reports $$, 'anon: cannot read reports');
select tests.as_user('free');
select lives_ok($$ select public.report_item('{"item_slug":"rls-test-bear","reason":"duplicate"}') $$,
  'free: reports a problem');
select is_empty($$ select 1 from public.item_reports $$, 'free: cannot read reports');
select throws_ok($$ insert into public.item_reports (item_slug, reason) values ('rls-test-bear', 'other') $$,
  '42501', null, 'free: no direct insert into item_reports');
select tests.as_user('admin');
select is((select count(*) from public.item_reports), 2::bigint, 'admin: reads reports');

-- submit_photo
select tests.as_anon();
select throws_ok($$ select public.submit_photo('rls-test-bear', 'x/abcdefgh.jpg') $$,
  '42501', null, 'anon: submit_photo not executable');
select tests.as_user('free');
select throws_like(format($$ select public.submit_photo('rls-photo-bear', %L) $$, tests.uid('other') || '/abcdefgh.jpg'),
  '%bad upload path%', 'free: path outside own folder refused');
select lives_ok(format($$ select public.submit_photo('rls-photo-bear', %L) $$, tests.uid('free') || '/abcdefgh.jpg'),
  'free: submits a photo from own folder');
select throws_like(format($$ select public.submit_photo('rls-test-bear', %L) $$, tests.uid('free') || '/abcdefgi.jpg'),
  '%already has a photo%', 'free: a bear with a photo takes no more');
select throws_ok(format($$ insert into public.photo_submissions (item_slug, submitter, storage_path) values ('x', %L, 'y') $$,
  tests.uid('free')), '42501', null, 'free: no direct insert into photo_submissions');
select is((select count(*) from public.photo_submissions), 1::bigint, 'free: sees own photo submission');
select tests.as_user('other');
select is_empty($$ select 1 from public.photo_submissions $$, 'other: cannot see free''s photo submission');
select tests.as_user('admin');
select isnt_empty($$ select 1 from public.photo_submissions $$, 'admin: sees photo submissions');

select * from finish();
rollback;

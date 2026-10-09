-- Collector submissions and reports: nothing a stranger sends reaches a price.
begin;
select no_plan();
select tests.seed_personas();

-- submit_comp
select tests.as_anon();
-- 20261008000100 revokes anon's default EXECUTE; the body also refuses.
select throws_ok($$ select public.submit_comp('{"item_slug":"rls-test-bear","sold_price":20}') $$,
  '42501', null, 'anon: submit_comp not executable');
select tests.as_user('free');
select lives_ok($$ select public.submit_comp('{"item_slug":"rls-test-bear","sold_price":20}') $$,
  'free: submits a comp');
select throws_like($$ select public.submit_comp('{"item_slug":"rls-test-bear","sold_price":20}') $$,
  '%already have a pending submission%', 'free: one pending submission per item');
select throws_like($$ select public.submit_comp('{"item_slug":"rls-test-bear","sold_price":20,"claimed_type":"completed_sale"}') $$,
  '%verified by a reviewer%', 'free: cannot claim completed_sale');
select throws_like($$ select public.submit_comp('{"item_slug":"no-such-bear","sold_price":20}') $$,
  '%unknown item%', 'free: unknown item refused');

-- H1: listing links must be https://, ids and free text are capped
select tests.as_user('other');
select throws_like($$ select public.submit_comp('{"item_slug":"rls-test-bear","sold_price":20,"marketplace":"eBay","listing_url":"javascript:alert(1)"}') $$,
  '%https:// address%', 'other: javascript: listing link refused');
select throws_like($$ select public.submit_comp('{"item_slug":"rls-test-bear","sold_price":20,"marketplace":"eBay","listing_url":"http://www.ebay.com/itm/1"}') $$,
  '%https:// address%', 'other: http listing link refused');
select throws_like($$ select public.submit_comp('{"item_slug":"rls-test-bear","sold_price":20,"listing_id":"<script>"}') $$,
  '%looks wrong%', 'other: malformed listing id refused');
select throws_like(format($$ select public.submit_comp(%L) $$,
  json_build_object('item_slug', 'rls-test-bear', 'sold_price', 20, 'marketplace', repeat('x', 61))::text),
  '%too long%', 'other: overlong marketplace refused');
select lives_ok($$ select public.submit_comp('{"item_slug":"rls-test-bear","sold_price":20,"marketplace":"eBay","listing_url":"https://www.ebay.com/itm/123?a=b","listing_id":"123"}') $$,
  'other: https listing link accepted');
select tests.as_postgres();
select ok(public.is_safe_https_url('https://www.ebay.com/itm/1?a=b#c'), 'is_safe_https_url: plain https');
select ok(not public.is_safe_https_url('https://evil.com/"><script>'), 'is_safe_https_url: no quotes or angle brackets');
select ok(not public.is_safe_https_url('https://' || repeat('a', 500) || '.com'), 'is_safe_https_url: length cap');
select throws_ok(format($$ insert into public.comp_submissions (user_id, item_slug, sold_price, listing_url)
  values (%L, 'rls-test-bear', 1, 'javascript:alert(1)') $$, tests.uid('other')),
  '23514', null, 'CHECK constraint: even a privileged insert cannot store javascript:');
delete from public.comp_submissions where user_id = tests.uid('other');

-- L3: 30 comp submissions per member per day
insert into public.rate_limit_hits (bucket, subject, window_start, hits)
values ('submit_comp', 'user:' || tests.uid('other'),
        to_timestamp(floor(extract(epoch from now()) / 86400) * 86400), 30)
on conflict (bucket, subject, window_start) do update set hits = 30;
select tests.as_user('other');
select throws_like($$ select public.submit_comp('{"item_slug":"rls-test-bear","sold_price":20}') $$,
  '%rate limit%', 'other: the 31st submission of the day is refused');
select tests.as_user('free');
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
-- L4: the database stamps the reviewer; a client cannot forge it
select is((select reviewed_by from public.comp_submissions), tests.uid('admin'), 'reviewed_by stamped by the trigger');
select isnt((select reviewed_at from public.comp_submissions), null, 'reviewed_at stamped by the trigger');
select is(tests.affected(format($$ update public.comp_submissions set reviewed_by = %L, review_note = 'x' $$, tests.uid('owner'))),
  1::bigint, 'admin: edits a note');
select is((select reviewed_by from public.comp_submissions), tests.uid('admin'), 'reviewed_by cannot be hand-edited');

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
select is(tests.affected($$ update public.item_reports set status = 'fixed' where reason = 'duplicate' $$), 1::bigint,
  'admin: closes a report');
select is((select reviewed_by from public.item_reports where reason = 'duplicate'), tests.uid('admin'),
  'item_reports.reviewed_by stamped by the trigger');

-- report_item keeps only a path or an https URL
select tests.as_user('free');
select lives_ok($$ select public.report_item('{"item_slug":"rls-test-bear","reason":"other","page_url":"javascript:alert(1)"}') $$,
  'free: a report with a bad page_url still lands');
select lives_ok($$ select public.report_item('{"item_slug":"rls-test-bear","reason":"wrong_name","page_url":"/item/rls-test-bear.html"}') $$,
  'free: a report with a path lands');
select tests.as_user('admin');
select is((select page_url from public.item_reports where reason = 'other'), null, 'unsafe page_url dropped');
select is((select page_url from public.item_reports where reason = 'wrong_name'), '/item/rls-test-bear.html', 'path page_url kept');

-- L3: 10 reports per requester per hour (anon is keyed by client IP)
select tests.as_anon();
select set_config('request.headers', '{"cf-connecting-ip":"203.0.113.9"}', true);
select lives_ok($$ select public.report_item('{"item_slug":"rls-test-bear","reason":"other"}') from generate_series(1, 10) $$,
  'anon: ten reports in an hour are fine');
select throws_like($$ select public.report_item('{"item_slug":"rls-test-bear","reason":"other"}') $$,
  '%rate limit%', 'anon: the eleventh from the same address is refused');
select set_config('request.headers', '{"cf-connecting-ip":"203.0.113.10"}', true);
select lives_ok($$ select public.report_item('{"item_slug":"rls-test-bear","reason":"other"}') $$,
  'anon: another address is unaffected');
select set_config('request.headers', '', true);

-- rate_limit_hits and the limiter are server-only
select throws_ok($$ select 1 from public.rate_limit_hits $$, '42501', null, 'anon: no access to rate_limit_hits');
select throws_ok($$ select public.consume_rate_limit('x', 'y', 1, interval '1 hour') $$, '42501', null,
  'anon: consume_rate_limit not executable');
select tests.as_user('free');
select throws_ok($$ select 1 from public.rate_limit_hits $$, '42501', null, 'free: no access to rate_limit_hits');
select throws_ok($$ select public.consume_rate_limit('x', 'y', 1, interval '1 hour') $$, '42501', null,
  'free: consume_rate_limit not executable');

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
select is(tests.affected($$ update public.photo_submissions set status = 'approved' $$), 1::bigint,
  'admin: approves a photo');
select is((select reviewed_by from public.photo_submissions), tests.uid('admin'),
  'photo_submissions.reviewed_by stamped by the trigger');

select * from finish();
rollback;

-- Member showcases (Power) and likes.
begin;
select no_plan();
select tests.seed_personas();

-- save_showcase (the 5-argument version in the migrations)
select tests.as_anon();
select throws_ok($$ select public.save_showcase('anon-case', 'Anon', null, '{}', true) $$,
  '42501', null, 'anon: save_showcase not executable');
select tests.as_user('free');
select throws_like($$ select public.save_showcase('free-case', 'Free', null, '{}', true) $$,
  '%Power membership%', 'free: showcase refused');
select tests.as_user('pro');
select throws_like($$ select public.save_showcase('pro-case', 'Pro', null, '{}', true) $$,
  '%Power membership%', 'pro: showcase refused');
select tests.as_user('power');
select is(public.save_showcase('power-case', 'Power', 'hi', array['rls-test-bear'], true), 'power-case',
  'power: saves a public showcase');
select throws_like($$ select public.save_showcase('admin', 'Power', null, '{}', true) $$,
  '%reserved%', 'power: reserved handle refused');
select tests.as_user('trial_power');
select throws_like($$ select public.save_showcase('power-case', 'Trial', null, '{}', true) $$,
  '%taken%', 'trial_power: cannot take another member''s handle');
select is(public.save_showcase('trial-case', 'Trial', null, '{}', false), 'trial-case',
  'trial_power: saves a private showcase');

-- Visibility
select tests.as_anon();
select throws_ok($$ select count(*) from public.showcases $$, '42501', null,
  'anon: no access to showcases (browsing needs an account, 000012)');
select tests.as_user('free');
select is((select count(*) from public.showcases where is_public), 1::bigint,
  'free: sees the public showcase');
select is_empty($$ select 1 from public.showcases where handle = 'trial-case' $$, 'free: cannot see a private showcase');

-- Direct writes: owners go through save_showcase; only admins update directly
select tests.as_user('power');
select is(tests.affected($$ update public.showcases set like_count = 999 $$), 0::bigint,
  'power: cannot update own showcase row directly');
select throws_ok(format($$ insert into public.showcases (user_id, handle, display_name) values (%L, 'sneaky', 'S') $$,
  tests.uid('free')), '42501', null, 'power: cannot insert a showcase row directly');

-- Likes
select tests.as_user('free');
select lives_ok(format($$ insert into public.showcase_likes (showcase_user) values (%L) $$, tests.uid('power')),
  'free: likes a public showcase');
select throws_ok(format($$ insert into public.showcase_likes (showcase_user) values (%L) $$, tests.uid('trial_power')),
  '42501', null, 'free: cannot like a private showcase');
select tests.as_user('other');
select lives_ok(format($$ insert into public.showcase_likes (showcase_user) values (%L) $$, tests.uid('power')),
  'other: likes a public showcase');
select tests.as_user('power');
select throws_ok(format($$ insert into public.showcase_likes (showcase_user) values (%L) $$, tests.uid('power')),
  '42501', null, 'power: cannot like own showcase');
select tests.as_user('free');
select is((select like_count from public.showcases where handle = 'power-case'), 2,
  'like_count is kept by the trigger');
select tests.as_anon();
select throws_ok(format($$ insert into public.showcase_likes (showcase_user) values (%L) $$, tests.uid('power')),
  '42501', null, 'anon: cannot like');
select tests.as_user('free');
select is((select count(*) from public.showcase_likes), 1::bigint, 'free: sees only own likes');
select is(tests.affected($$ delete from public.showcase_likes $$), 1::bigint, 'free: removes own like');
select is((select like_count from public.showcases where handle = 'power-case'), 1,
  'like_count drops when a like is removed');

-- Moderation
select tests.as_user('admin');
select is(tests.affected($$ update public.showcases set hidden_by_admin = true where handle = 'power-case' $$), 1::bigint,
  'admin: hides a showcase');
select tests.as_user('free');
select is_empty($$ select 1 from public.showcases where handle = 'power-case' $$, 'free: hidden showcase is gone');
select tests.as_user('power');
select isnt_empty($$ select 1 from public.showcases where handle = 'power-case' $$, 'power: still sees own hidden showcase');
select is(tests.affected($$ update public.showcases set hidden_by_admin = false $$), 0::bigint,
  'power: cannot unhide own showcase');
select tests.as_user('admin');
select isnt_empty($$ select 1 from public.showcases where handle = 'power-case' $$, 'admin: sees hidden showcase');

-- The 7-argument save_showcase exported from production (000011).
select has_function('public', 'save_showcase',
  array['text', 'text', 'text', 'text[]', 'boolean', 'jsonb', 'text'],
  'save_showcase(handle, name, bio, bears, public, details, theme) exists');
select hasnt_function('public', 'save_showcase',
  array['text', 'text', 'text', 'text[]', 'boolean'], 'the retired 5-argument overload is gone');
select tests.as_user('power');
select throws_like($$ select public.save_showcase('power-case', 'Power', null, array['rls-test-bear'], true,
  '{"rls-test-bear": {"photo": "00000000-0000-0000-0000-000000000000/abcdef.jpg"}}'::jsonb, 'rose') $$,
  '%bad photo%', 'power: a photo path outside your own folder is refused');
select throws_like($$ select public.save_showcase('power-case', 'Power', null, '{}', true, '{}'::jsonb, 'neon') $$,
  '%unknown theme%', 'power: unknown theme refused');

select * from finish();
rollback;

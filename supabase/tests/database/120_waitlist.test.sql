-- The membership waitlist (migration 20261008000300): written only through
-- join_waitlist(), rate-limited, idempotent, readable by the owner alone.
begin;
select no_plan();
select tests.seed_personas();

create or replace function pg_temp.from_ip(p_ip text) returns void language sql as $$
  select set_config('request.headers', json_build_object('x-forwarded-for', p_ip)::text, true)
$$;

-- Anyone can join; the answer is always 'ok'
select tests.as_anon();
select pg_temp.from_ip('203.0.113.1, 10.0.0.1');
select is(public.join_waitlist('A@B.co', 'pro', 'plans'), 'ok', 'anon: joins');
select is(public.join_waitlist('a@b.co', 'power', 'plans'), 'ok', 'the same address again: still ok');
select tests.as_user('free');
select pg_temp.from_ip('203.0.113.2');
select is(public.join_waitlist('member@example.com'), 'ok', 'a member joins with the defaults');

select tests.as_postgres();
select is((select count(*) from public.waitlist where lower(email) = 'a@b.co'), 1::bigint,
  'one row per address, whatever the case');
select is((select plan from public.waitlist where email = 'a@b.co'), 'power', 'a repeat updates the plan only');
select is((select user_id from public.waitlist where email = 'member@example.com'), tests.uid('free'),
  'a member''s row carries their id');
select is((select user_id from public.waitlist where email = 'a@b.co'), null, 'anon rows carry no user');
select ok((select ip_hash from public.waitlist where email = 'a@b.co') ~ '^[0-9a-f]{64}$',
  'the IP is stored hashed');
select is((select count(*) from public.waitlist where ip_hash like '%203.0.113%'), 0::bigint,
  'never the IP itself');

-- Bad input
select tests.as_anon();
select throws_ok($$ select public.join_waitlist('not-an-email') $$, 'P0001', 'invalid_email', 'invalid email refused');
select throws_ok($$ select public.join_waitlist(null) $$, 'P0001', 'invalid_email', 'no email refused');
select throws_ok(format($$ select public.join_waitlist(%L) $$, repeat('a', 250) || '@b.co'),
  'P0001', 'invalid_email', 'over 254 characters refused');
select is(public.join_waitlist('odd@plan.co', 'gold'), 'ok', 'an unknown plan is stored as any');
select tests.as_postgres();
select is((select plan from public.waitlist where email = 'odd@plan.co'), 'any', 'unknown plan -> any');

-- Per IP: 5 an hour
select tests.as_anon();
select pg_temp.from_ip('198.51.100.7');
select is((select count(*)::int from generate_series(1, 5) g
           where public.join_waitlist('ip' || g || '@x.co') = 'ok'), 5, 'five from one IP');
select throws_ok($$ select public.join_waitlist('ip6@x.co') $$, 'P0001', 'rate_limited', 'the sixth is refused');
select pg_temp.from_ip('198.51.100.8');
select is(public.join_waitlist('other-ip@x.co'), 'ok', 'another IP is not affected');

-- The hour rolls
select tests.as_postgres();
update public.waitlist set created_at = now() - interval '61 minutes' where email like 'ip%@x.co';
select tests.as_anon();
select pg_temp.from_ip('198.51.100.7');
select is(public.join_waitlist('ip6@x.co'), 'ok', 'the per-IP window rolls after an hour');

-- A forged leftmost x-forwarded-for does not buy more tries: the rightmost
-- hop (the proxy's) is what counts.
select tests.as_anon();
select pg_temp.from_ip('10.9.9.1, 198.51.100.99');
select is(public.join_waitlist('spoof1@x.co'), 'ok', 'forged leftmost 1: allowed (1 of 5)');
select pg_temp.from_ip('10.9.9.2, 198.51.100.99');
select is(public.join_waitlist('spoof2@x.co'), 'ok', 'forged leftmost 2: allowed (2 of 5)');
select pg_temp.from_ip('10.9.9.3, 198.51.100.99');
select is(public.join_waitlist('spoof3@x.co'), 'ok', 'forged leftmost 3: allowed (3 of 5)');
select pg_temp.from_ip('10.9.9.4, 198.51.100.99');
select is(public.join_waitlist('spoof4@x.co'), 'ok', 'forged leftmost 4: allowed (4 of 5)');
select pg_temp.from_ip('10.9.9.5, 198.51.100.99');
select is(public.join_waitlist('spoof5@x.co'), 'ok', 'forged leftmost 5: allowed (5 of 5)');
select pg_temp.from_ip('10.9.9.200, 198.51.100.99');
select throws_ok($$ select public.join_waitlist('spoof6@x.co') $$, 'P0001', 'rate_limited',
  'a sixth with yet another forged leftmost value is still refused');
select pg_temp.from_ip('198.51.100.99, 10.9.9.1');
select is(public.join_waitlist('spoof7@x.co'), 'ok', 'only the rightmost hop identifies the client');

-- The hash is salted with a private value, never a fixed public string
select tests.as_postgres();
select ok((select ip_hash from public.waitlist where email = 'spoof7@x.co')
          <> encode(extensions.digest('10.9.9.1:bearchart-waitlist', 'sha256'), 'hex'),
  'no fixed public salt');
select is((select ip_hash from public.waitlist where email = 'spoof7@x.co'),
  encode(extensions.digest('10.9.9.1:' || (select salt from private.waitlist_salt), 'sha256'), 'hex'),
  'hashed with the private random salt');
select set_config('app.waitlist_salt', 'owner-secret', true);
select tests.as_anon();
select pg_temp.from_ip('203.0.113.77');
select is(public.join_waitlist('salted@x.co'), 'ok', 'joins with a readable GUC set');
select tests.as_postgres();
select is((select ip_hash from public.waitlist where email = 'salted@x.co'),
  encode(extensions.digest('203.0.113.77:' || (select salt from private.waitlist_salt), 'sha256'), 'hex'),
  'a readable GUC is never used as the salt');
select tests.as_anon();
select throws_ok($$ select salt from private.waitlist_salt $$, '42501', null, 'anon cannot read the salt');
select tests.as_user('free');
select throws_ok($$ select salt from private.waitlist_salt $$, '42501', null, 'members cannot read the salt');

-- Overall: past 120 an hour still answers ok, but the row is held for review
select tests.as_postgres();
insert into public.waitlist (email, created_at)
select 'bulk' || g || '@x.co', now() from generate_series(1, 120) g;
select tests.as_anon();
select pg_temp.from_ip('192.0.2.50');
select is(public.join_waitlist('late@x.co'), 'ok', 'over 120 an hour: still ok to the caller');
select tests.as_postgres();
select is((select held from public.waitlist where email = 'late@x.co'), true, '... but held for review');
select is((select held from public.waitlist where email = 'member@example.com'), false, 'earlier rows are not held');
insert into public.waitlist (email, created_at)
select 'flood' || g || '@x.co', now() from generate_series(1, 1000) g;
select tests.as_anon();
select pg_temp.from_ip('192.0.2.51');
select throws_ok($$ select public.join_waitlist('flooded@x.co') $$, 'P0001', 'rate_limited',
  'past 1,000 an hour the table stops growing');

-- Reads and writes: the owner alone
select tests.as_anon();
select throws_ok($$ select 1 from public.waitlist $$, '42501', null, 'anon: no SELECT at all');
select throws_ok($$ delete from public.waitlist $$, '42501', null, 'anon: no DELETE');
select throws_ok($$ truncate public.waitlist $$, '42501', null, 'anon: no TRUNCATE');
select throws_ok($$ insert into public.waitlist (email) values ('x@y.co') $$, '42501', null,
  'anon: cannot insert directly');
select tests.as_user('free');
select is_empty($$ select 1 from public.waitlist $$, 'a member cannot read the list, even their own row');
select throws_ok($$ update public.waitlist set plan = 'pro' $$, '42501', null, 'a member cannot update');
select throws_ok($$ truncate public.waitlist $$, '42501', null, 'a member cannot truncate');
select throws_ok($$ insert into public.waitlist (email) values ('x@y.co') $$, '42501', null,
  'a member cannot insert directly');
delete from public.waitlist;
select tests.as_postgres();
select ok((select count(*) from public.waitlist) > 100, 'a member''s DELETE removes nothing (RLS)');
select tests.as_user('free');
select tests.as_user('admin');
select is_empty($$ select 1 from public.waitlist $$, 'an editor admin cannot read it');
select tests.as_user('owner');
select ok((select count(*) from public.waitlist) > 100, 'the owner reads the list');
delete from public.waitlist where email = 'a@b.co';
select tests.as_postgres();
select is((select count(*) from public.waitlist where email = 'a@b.co'), 0::bigint, 'the owner can remove someone');
select ok((select relrowsecurity from pg_class where oid = 'public.waitlist'::regclass), 'waitlist has RLS');

select * from finish();
rollback;

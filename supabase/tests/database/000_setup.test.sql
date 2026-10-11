-- RLS test helpers. Run first (files run in alphabetical order) and COMMITTED:
-- every other file runs in its own transaction and rolls back.
--
-- The "tests" schema exists only in local/CI databases. It is never in a
-- migration, so it never reaches production.
create extension if not exists pgtap with schema extensions;
create schema if not exists tests;
grant usage on schema tests to anon, authenticated, service_role;

create or replace function tests.create_user(p_name text) returns uuid
language plpgsql security definer set search_path = auth, public as $$
declare v uuid;
begin
  select id into v from auth.users where email = p_name || '@rls.test';
  if v is null then
    insert into auth.users (id, instance_id, aud, role, email,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
            'authenticated', 'authenticated', p_name || '@rls.test', '{}', '{}', now(), now())
    returning id into v;
  end if;
  return v;
end $$;

create or replace function tests.uid(p_name text) returns uuid
language sql stable security definer set search_path = auth as $$
  select id from auth.users where email = p_name || '@rls.test'
$$;

-- Act as a signed-in member (what PostgREST does with a verified JWT).
create or replace function tests.as_user(p_name text) returns void
language plpgsql as $$
declare v uuid := tests.uid(p_name);
begin
  if v is null then raise exception 'no test user %', p_name; end if;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v, 'role', 'authenticated')::text, true);
end $$;

create or replace function tests.as_anon() returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
end $$;

create or replace function tests.as_service() returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end $$;

create or replace function tests.as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);   -- allowed: session_user is postgres
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Rows touched by an UPDATE/DELETE (RLS hides rows rather than erroring).
create or replace function tests.affected(sql text) returns bigint
language plpgsql as $$
declare n bigint;
begin execute sql; get diagnostics n = row_count; return n; end $$;

-- Personas. Call as postgres at the top of each file (inside its transaction).
--   free, other     : signed in, no subscription row
--   pro, power      : active
--   trial_power     : power, trialing
--   lapsed          : pro, canceled, period over
--   pastdue_grace   : pro, past_due for 3 days (inside the past_due_grace() window)
--   pastdue_expired : pro, past_due for 8 days (outside it)
--   (the grace is anchored on past_due_since, not current_period_end: Stripe has
--   already moved the period end forward when a renewal fails)
--   admin / owner   : rows in public.admins (editor / owner), no subscription
create or replace function tests.seed_personas() returns void language plpgsql as $$
begin
  perform tests.create_user(x) from unnest(array['free','pro','power','trial_power',
    'lapsed','pastdue_grace','pastdue_expired','admin','owner','other']) x;
  insert into public.subscriptions (user_id, tier, status, current_period_end, past_due_since) values
    (tests.uid('pro'),             'pro',   'active',   now() + interval '30 days', null),
    (tests.uid('power'),           'power', 'active',   now() + interval '30 days', null),
    (tests.uid('trial_power'),     'power', 'trialing', now() + interval '7 days',  null),
    (tests.uid('lapsed'),          'pro',   'canceled', now() - interval '1 day',   null),
    (tests.uid('pastdue_grace'),   'pro',   'past_due', now() + interval '27 days', now() - interval '3 days'),
    (tests.uid('pastdue_expired'), 'pro',   'past_due', now() + interval '22 days', now() - interval '8 days')
  on conflict (user_id) do nothing;
  insert into public.admins (user_id, role) values
    (tests.uid('admin'), 'editor'), (tests.uid('owner'), 'owner')
  on conflict do nothing;
  insert into public.items (slug, canonical_name, category)
  values ('rls-test-bear', 'RLS Test Bear', 'bear') on conflict (slug) do nothing;
  insert into public.sales (item_id, sold_price, evidence_type)
  select id, 10, 'collector_report' from public.items where slug = 'rls-test-bear';
  insert into public.item_photos (item_slug, image_url)
  values ('rls-test-bear', 'https://example.test/rls-test-bear.jpg')
  on conflict (item_slug) do nothing;
end $$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

begin; select plan(1); select ok(true, 'test helpers installed'); select * from finish(); rollback;

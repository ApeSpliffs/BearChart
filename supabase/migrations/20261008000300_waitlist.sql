-- The membership waitlist (plans page, before memberships open).
--
-- One email, once: "memberships are open". Writes only through
-- join_waitlist(), which anyone may call. It is idempotent - it answers 'ok'
-- whether or not the address was already on the list, so it cannot be used to
-- test whether someone signed up - and rate-limited:
--
--   * 5 per client IP per hour. The IP is the RIGHTMOST x-forwarded-for entry,
--     the one appended by Supabase's own proxy; everything to its left is
--     whatever the client sent and can be forged.
--     OWNER TODO: confirm against the deployed proxy chain (log
--     current_setting('request.headers') once from a real request) that the
--     rightmost hop is the client as Supabase saw it, not a CDN in front.
--   * Past 120 an hour overall the address is still accepted, silently, but
--     the row is HELD (held = true): the owner reviews held rows before the
--     launch email goes out. Refusing would let one flood lock everyone else
--     out; accepting quietly costs nothing and tells an abuser nothing. A hard
--     ceiling of 1,000 an hour stops the table itself being flooded.
--     OWNER TODO: add a captcha or double opt-in if abuse ever appears.
--
-- The IP is never stored, only a salted hash of it for the rate limit. The
-- salt is private: app.waitlist_salt if the owner sets it (OWNER TODO, e.g.
-- `alter database postgres set app.waitlist_salt = '<random>'`), otherwise a
-- random salt generated once into private.waitlist_salt, which no API role can
-- read. Only the owner can read or delete rows (privacy.html#waitlist).

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.waitlist (
  id          uuid primary key default gen_random_uuid(),
  email       text not null check (char_length(email) <= 254),
  plan        text not null default 'any' check (plan in ('any', 'pro', 'power')),
  source      text check (char_length(source) <= 40),
  user_id     uuid references auth.users(id) on delete set null,
  ip_hash     text,
  held        boolean not null default false,
  created_at  timestamptz not null default now(),
  notified_at timestamptz
);
create unique index if not exists waitlist_email_uq on public.waitlist (lower(email));
create index if not exists waitlist_ip_recent on public.waitlist (ip_hash, created_at);
create index if not exists waitlist_created on public.waitlist (created_at);

alter table public.waitlist enable row level security;
-- No API role writes directly: everything goes through join_waitlist(). The
-- owner reads and removes rows (RLS below); nobody else can touch the table.
revoke all on public.waitlist from public, anon, authenticated;
grant select, delete on public.waitlist to authenticated;
drop policy if exists waitlist_owner_read on public.waitlist;
create policy waitlist_owner_read on public.waitlist for select to authenticated
  using ((select public.is_owner()));
drop policy if exists waitlist_owner_delete on public.waitlist;
create policy waitlist_owner_delete on public.waitlist for delete to authenticated
  using ((select public.is_owner()));

-- The fallback salt: random, generated once, in a schema no API role can see.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.waitlist_salt (
  only_row boolean primary key default true check (only_row),
  salt     text not null default encode(extensions.gen_random_bytes(32), 'hex')
);
insert into private.waitlist_salt default values on conflict do nothing;
revoke all on private.waitlist_salt from public, anon, authenticated;

create or replace function public.join_waitlist(p_email text, p_plan text default 'any',
                                                p_source text default 'plans')
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  em    text := lower(trim(coalesce(p_email, '')));
  pl    text := coalesce(p_plan, 'any');
  hdrs  json := nullif(current_setting('request.headers', true), '')::json;
  xff   text[] := string_to_array(coalesce(hdrs ->> 'x-forwarded-for', ''), ',');
  -- Rightmost hop: appended by the proxy, not by the client.
  ip    text := trim(coalesce(xff[array_length(xff, 1)], ''));
  salt  text := coalesce(nullif(current_setting('app.waitlist_salt', true), ''),
                         (select s.salt from private.waitlist_salt s limit 1));
  ih    text := case when ip = '' then null
                     else encode(extensions.digest(ip || ':' || salt, 'sha256'), 'hex') end;
  hour  bigint;
begin
  if char_length(em) > 254 or em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_email';
  end if;
  if pl not in ('any', 'pro', 'power') then pl := 'any'; end if;
  if ih is not null and (select count(*) from waitlist
                          where ip_hash = ih and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'rate_limited';
  end if;
  select count(*) into hour from waitlist where created_at > now() - interval '1 hour';
  if hour >= 1000 then raise exception 'rate_limited'; end if;
  insert into waitlist (email, plan, source, user_id, ip_hash, held)
  values (em, pl, left(p_source, 40), auth.uid(), ih, hour >= 120)
  on conflict ((lower(email))) do update set plan = excluded.plan;
  return 'ok';
end $$;

revoke all on function public.join_waitlist(text, text, text) from public;
grant execute on function public.join_waitlist(text, text, text) to anon, authenticated;

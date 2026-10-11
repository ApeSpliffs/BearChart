-- The membership waitlist (plans page, before memberships open).
--
-- One email, once: "memberships are open". Writes only through
-- join_waitlist(), which is callable by anyone, rate-limited (5 per IP per
-- hour, 120 per hour overall) and idempotent - it answers 'ok' whether or not
-- the address was already on the list, so it cannot be used to test whether
-- someone signed up. The IP is never stored, only a salted hash of it for the
-- rate limit. Only the owner can read or delete rows (privacy.html#waitlist).

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.waitlist (
  id          uuid primary key default gen_random_uuid(),
  email       text not null check (char_length(email) <= 254),
  plan        text not null default 'any' check (plan in ('any', 'pro', 'power')),
  source      text check (char_length(source) <= 40),
  user_id     uuid references auth.users(id) on delete set null,
  ip_hash     text,
  created_at  timestamptz not null default now(),
  notified_at timestamptz
);
create unique index if not exists waitlist_email_uq on public.waitlist (lower(email));
create index if not exists waitlist_ip_recent on public.waitlist (ip_hash, created_at);
create index if not exists waitlist_created on public.waitlist (created_at);

alter table public.waitlist enable row level security;
-- No insert/update policies: writes only through join_waitlist(). The owner reads.
drop policy if exists waitlist_owner_read on public.waitlist;
create policy waitlist_owner_read on public.waitlist for select using ((select public.is_owner()));
drop policy if exists waitlist_owner_delete on public.waitlist;
create policy waitlist_owner_delete on public.waitlist for delete using ((select public.is_owner()));
revoke insert, update on public.waitlist from anon, authenticated;

create or replace function public.join_waitlist(p_email text, p_plan text default 'any',
                                                p_source text default 'plans')
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  em   text := lower(trim(coalesce(p_email, '')));
  pl   text := coalesce(p_plan, 'any');
  hdrs json := nullif(current_setting('request.headers', true), '')::json;
  ip   text := trim(split_part(coalesce(hdrs ->> 'x-forwarded-for', ''), ',', 1));
  ih   text := case when ip = '' then null
                    else encode(extensions.digest(ip || ':bearchart-waitlist', 'sha256'), 'hex') end;
begin
  if char_length(em) > 254 or em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_email';
  end if;
  if pl not in ('any', 'pro', 'power') then pl := 'any'; end if;
  -- Per IP: 5 an hour. Overall: 120 an hour (the ceiling for an anonymous endpoint).
  if ih is not null and (select count(*) from waitlist
                          where ip_hash = ih and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'rate_limited';
  end if;
  if (select count(*) from waitlist where created_at > now() - interval '1 hour') >= 120 then
    raise exception 'rate_limited';
  end if;
  insert into waitlist (email, plan, source, user_id, ip_hash)
  values (em, pl, left(p_source, 40), auth.uid(), ih)
  on conflict ((lower(email))) do update set plan = excluded.plan;
  return 'ok';
end $$;

revoke all on function public.join_waitlist(text, text, text) from public;
grant execute on function public.join_waitlist(text, text, text) to anon, authenticated;

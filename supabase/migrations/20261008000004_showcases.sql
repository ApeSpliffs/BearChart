-- Migration 04: member showcases (Power membership).
-- Already applied to the live project; kept here so the schema can be rebuilt.

-- Power gains value_digest, wishlist_alerts and showcase; Pro gains wishlist_alerts.
create or replace function public.has_entitlement(feature text)
 returns boolean
 language sql
 stable
 set search_path to 'public'
as $function$
  select case current_tier()
    when 'power' then feature in (
      'collection_sync','hosted_history','insurance_archive','id_priority',
      'alerts_push','alerts_email','poll_priority','outfit_assembly','api_access',
      'value_digest','wishlist_alerts','showcase')
    when 'pro' then feature in (
      'collection_sync','hosted_history','insurance_archive','id_priority','wishlist_alerts')
    else false
  end;
$function$;

create table if not exists public.showcases (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  handle text not null unique check (handle ~ '^[a-z0-9][a-z0-9-]{2,23}$'),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 40),
  bio text check (bio is null or char_length(bio) <= 160),
  bears text[] not null default '{}' check (cardinality(bears) <= 12),
  is_public boolean not null default false,
  hidden_by_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists showcases_public_idx on public.showcases (updated_at desc)
  where is_public and not hidden_by_admin;

alter table public.showcases enable row level security;

drop policy if exists showcases_read on public.showcases;
create policy showcases_read on public.showcases for select
  using ((is_public and not hidden_by_admin) or user_id = auth.uid() or is_admin());

drop policy if exists showcases_admin_update on public.showcases;
create policy showcases_admin_update on public.showcases for update
  using (is_admin()) with check (is_admin());

drop policy if exists showcases_delete on public.showcases;
create policy showcases_delete on public.showcases for delete
  using (user_id = auth.uid() or is_admin());

-- Members write only through this function, which checks the membership.
create or replace function public.save_showcase(p_handle text, p_name text, p_bio text, p_bears text[], p_public boolean)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  uid uuid := auth.uid();
  h text := lower(btrim(coalesce(p_handle, '')));
  b text;
begin
  if uid is null then raise exception 'sign in to make a showcase'; end if;
  if not (has_entitlement('showcase') or is_admin()) then
    raise exception 'showcases are a Power membership feature';
  end if;
  if h !~ '^[a-z0-9][a-z0-9-]{2,23}$' then
    raise exception 'pick a name of 3-24 letters, numbers or dashes';
  end if;
  if h in ('admin','admins','bearchart','jays','jaysretro','jaysretroexchange','support','help','official','buildabear','build-a-bear','staff','mod','moderator') then
    raise exception 'that name is reserved';
  end if;
  if exists (select 1 from showcases where handle = h and user_id <> uid) then
    raise exception 'that name is taken';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 40 then
    raise exception 'display name must be 1-40 characters';
  end if;
  if p_bio is not null and char_length(p_bio) > 160 then
    raise exception 'bio must be 160 characters or fewer';
  end if;
  if cardinality(coalesce(p_bears, '{}')) > 12 then
    raise exception 'pick up to 12 bears';
  end if;
  foreach b in array coalesce(p_bears, '{}') loop
    if b !~ '^[a-z0-9-]{1,120}$' then raise exception 'unknown bear'; end if;
  end loop;
  insert into showcases (user_id, handle, display_name, bio, bears, is_public, updated_at)
  values (uid, h, btrim(p_name), nullif(btrim(coalesce(p_bio, '')), ''), coalesce(p_bears, '{}'), coalesce(p_public, false), now())
  on conflict (user_id) do update
    set handle = excluded.handle, display_name = excluded.display_name, bio = excluded.bio,
        bears = excluded.bears, is_public = excluded.is_public, updated_at = now();
  return h;
end $function$;

revoke all on function public.save_showcase(text, text, text, text[], boolean) from public, anon;
grant execute on function public.save_showcase(text, text, text, text[], boolean) to authenticated;

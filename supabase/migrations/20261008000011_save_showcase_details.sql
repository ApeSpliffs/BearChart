-- The 7-argument save_showcase (per-bear photo path + note, colour theme),
-- exported from production on 2026-10-11 with pg_get_functiondef. It was
-- created in the dashboard and never committed (drift noted in 000007).
-- Photo paths must start with the caller's own uid. The 5-argument overload
-- is retired: the site only calls this one.

create or replace function public.save_showcase(p_handle text, p_name text, p_bio text, p_bears text[], p_public boolean, p_details jsonb default '{}'::jsonb, p_theme text default 'rose') returns text
language plpgsql security definer
set search_path = public
as $_$
declare
  uid uuid := auth.uid();
  h text := lower(btrim(coalesce(p_handle, '')));
  b text;
  k text;
  v jsonb;
  d jsonb := coalesce(p_details, '{}'::jsonb);
  clean jsonb := '{}'::jsonb;
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
  if coalesce(p_theme, 'rose') not in ('rose', 'honey', 'mint', 'sky', 'plum', 'night') then
    raise exception 'unknown theme';
  end if;
  if jsonb_typeof(d) <> 'object' then raise exception 'bad showcase details'; end if;
  for k, v in select * from jsonb_each(d) loop
    if not (k = any(coalesce(p_bears, '{}'))) or jsonb_typeof(v) <> 'object' then continue; end if;
    if v ? 'photo' and jsonb_typeof(v->'photo') = 'string'
       and (v->>'photo') !~ ('^' || uid::text || '/[A-Za-z0-9_-]{6,64}\.jpg$') then
      raise exception 'bad photo';
    end if;
    if v ? 'note' and char_length(coalesce(v->>'note', '')) > 80 then
      raise exception 'notes must be 80 characters or fewer';
    end if;
    clean := clean || jsonb_build_object(k, jsonb_strip_nulls(jsonb_build_object(
      'photo', case when jsonb_typeof(v->'photo') = 'string' then v->>'photo' end,
      'note', nullif(btrim(coalesce(v->>'note', '')), ''))));
  end loop;
  insert into showcases (user_id, handle, display_name, bio, bears, is_public, details, theme, updated_at)
  values (uid, h, btrim(p_name), nullif(btrim(coalesce(p_bio, '')), ''), coalesce(p_bears, '{}'),
          coalesce(p_public, false), clean, coalesce(p_theme, 'rose'), now())
  on conflict (user_id) do update
    set handle = excluded.handle, display_name = excluded.display_name, bio = excluded.bio,
        bears = excluded.bears, is_public = excluded.is_public, details = excluded.details,
        theme = excluded.theme, updated_at = now();
  return h;
end $_$;


revoke all on function public.save_showcase(text, text, text, text[], boolean, jsonb, text) from public, anon;
grant execute on function public.save_showcase(text, text, text, text[], boolean, jsonb, text) to authenticated;

drop function if exists public.save_showcase(text, text, text, text[], boolean);

-- Migration 07: richer showcases - members' own bear photos, a note per bear
-- and a colour theme. Already applied to the live project.

alter table public.showcases
  add column if not exists details jsonb not null default '{}'::jsonb,
  add column if not exists theme text not null default 'rose';

alter table public.showcases drop constraint if exists showcases_theme_check;
alter table public.showcases add constraint showcases_theme_check
  check (theme in ('rose', 'honey', 'mint', 'sky', 'plum', 'night'));

-- Photos live in a private bucket. Any signed-in member can view them (the
-- page asks for short-lived links); only the owner can add or remove theirs,
-- and only with the showcase entitlement.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('showcase-photos', 'showcase-photos', false, 2097152,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists showcase_photos_read on storage.objects;
create policy showcase_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'showcase-photos');

drop policy if exists showcase_photos_add on storage.objects;
create policy showcase_photos_add on storage.objects for insert to authenticated
  with check (bucket_id = 'showcase-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and ((select public.has_entitlement('showcase')) or (select public.is_admin())));

drop policy if exists showcase_photos_remove on storage.objects;
create policy showcase_photos_remove on storage.objects for delete to authenticated
  using (bucket_id = 'showcase-photos'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.is_admin())));

-- save_showcase gains p_details (per-bear photo path and note) and p_theme.
-- The full function body is in the live project; it validates that photo
-- paths sit in the member's own folder and notes are at most 80 characters.
-- (The older 5-argument version should be dropped:)
-- drop function if exists public.save_showcase(text, text, text, text[], boolean);

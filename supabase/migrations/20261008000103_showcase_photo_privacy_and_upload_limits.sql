-- ===========================================================================
-- Security M2 + L2: showcase photos are private unless shown on a public
-- showcase, and member uploads accept only the JPEGs the pages produce.
--
-- M2. The read policy used to be bucket-only, so any signed-in member could
-- list or sign any member's photos - private showcases, hidden showcases and
-- photos no longer used. Storage signs only objects that pass the SELECT
-- policy, so the policy is the enforcement point: a photo is readable by its
-- owner, an admin, or anyone when a PUBLIC, non-hidden showcase OWNED BY THE
-- PHOTO'S OWNER references it. Binding the reference to the folder owner
-- means even a save_showcase that failed to validate paths could not expose
-- somebody else's photo by referencing it.
--
-- L7 / TODO (owner): the live 7-argument save_showcase(p_handle, p_name,
-- p_bio, p_bears, p_public, p_details, p_theme) is not in the repo. Export it
-- (pg_get_functiondef) into 20261008000011_save_showcase_details.sql, confirm
-- it requires every photo path to start with auth.uid() || '/', and drop the
-- 5-argument overload. This policy is safe whether or not it does.
--
-- L2. Both member-upload buckets take only image/jpeg (the pages re-encode
-- every photo to JPEG through a canvas) under names the pages generate.
-- Content type is still declared by the client; the admin page re-encodes
-- again before anything reaches the public bear-photos bucket. Server-side
-- re-encoding of showcase photos (seen by other members without review) is a
-- documented follow-up.
-- ===========================================================================

create or replace function public.showcase_photo_is_public(p_name text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare owner uuid;
begin
  begin
    owner := split_part(p_name, '/', 1)::uuid;
  exception when invalid_text_representation then
    return false;
  end;
  return exists (
    select 1 from showcases s
    where s.user_id = owner
      and s.is_public and not s.hidden_by_admin
      and exists (select 1 from jsonb_each(s.details) d
                  where jsonb_typeof(d.value) = 'object'
                    and d.value->>'photo' = p_name
                    and d.key = any (s.bears)));
end $$;
revoke all on function public.showcase_photo_is_public(text) from public, anon;
grant execute on function public.showcase_photo_is_public(text) to authenticated;

drop policy if exists showcase_photos_read on storage.objects;
create policy showcase_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'showcase-photos' and (
           (storage.foldername(name))[1] = (select auth.uid())::text
        or (select public.is_admin())
        or public.showcase_photo_is_public(name)));

-- L2: both member-upload buckets accept only the JPEG the page re-encodes to,
-- under names the page generates, directly inside the member's own folder.
update storage.buckets set allowed_mime_types = array['image/jpeg']
  where id in ('showcase-photos', 'photo-submissions');

drop policy if exists showcase_photos_add on storage.objects;
create policy showcase_photos_add on storage.objects for insert to authenticated
  with check (bucket_id = 'showcase-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and array_length(storage.foldername(name), 1) = 1
    and storage.filename(name) ~ '^[a-z0-9]{8,40}\.jpg$'
    and ((select public.has_entitlement('showcase')) or (select public.is_admin())));

drop policy if exists "photo submissions: upload to own folder" on storage.objects;
create policy "photo submissions: upload to own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'photo-submissions'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and array_length(storage.foldername(name), 1) = 1
    and storage.filename(name) ~ '^[a-z0-9-]{8,64}\.jpg$');

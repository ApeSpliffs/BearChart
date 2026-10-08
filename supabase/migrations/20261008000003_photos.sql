-- BearChart migration 03: member photo submissions.
--
--   psql "$DATABASE_URL" -f supabase_migration_03_photos.sql
--
-- Signed-in members can send a photo for a bear that has none. It lands in a
-- private bucket and a 'pending' row; nothing is public until an admin approves
-- it, which copies the file into the public bucket and records it in
-- item_photos. Same rule as sold-price submissions: nobody's upload reaches the
-- site unreviewed - including the people who run it.
--
-- Safe to re-run.

create table if not exists photo_submissions (
  id           uuid primary key default gen_random_uuid(),
  item_slug    text not null check (item_slug ~ '^[a-z0-9-]{1,120}$'),
  submitter    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  storage_path text not null,
  status       text not null default 'pending'
               check (status in ('pending', 'approved', 'rejected')),
  created_at   timestamptz not null default now(),
  reviewed_at  timestamptz,
  reviewed_by  uuid
);

-- One photo waiting per member per bear: a second upload is more reviewing,
-- not more evidence.
create unique index if not exists photo_submissions_one_pending
  on photo_submissions (item_slug, submitter) where status = 'pending';
create index if not exists photo_submissions_status on photo_submissions (status, created_at);

create table if not exists item_photos (
  item_slug     text primary key check (item_slug ~ '^[a-z0-9-]{1,120}$'),
  image_url     text not null,
  credit        text not null default 'Photo by a BearChart member',
  submission_id uuid references photo_submissions(id) on delete set null,
  approved_at   timestamptz not null default now()
);

alter table photo_submissions enable row level security;
alter table item_photos enable row level security;

-- Approved photos are public; only admins write them.
drop policy if exists item_photos_read on item_photos;
create policy item_photos_read on item_photos for select using (true);
drop policy if exists item_photos_admin_insert on item_photos;
create policy item_photos_admin_insert on item_photos for insert with check (is_admin());
drop policy if exists item_photos_admin_update on item_photos;
create policy item_photos_admin_update on item_photos for update using (is_admin()) with check (is_admin());
drop policy if exists item_photos_admin_delete on item_photos;
create policy item_photos_admin_delete on item_photos for delete using (is_admin());

-- Submissions: you see your own, admins see all. There is no insert policy:
-- the only way in is submit_photo(), which stamps the submitter itself.
drop policy if exists photo_subs_read on photo_submissions;
create policy photo_subs_read on photo_submissions for select
  using (auth.uid() = submitter or is_admin());
drop policy if exists photo_subs_admin_update on photo_submissions;
create policy photo_subs_admin_update on photo_submissions for update
  using (is_admin()) with check (is_admin());

create or replace function submit_photo(item text, path text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  new_id uuid;
begin
  if uid is null then
    raise exception 'sign in to add a photo';
  end if;
  if item is null or item !~ '^[a-z0-9-]{1,120}$' then
    raise exception 'unknown item';
  end if;
  -- The file must sit in the caller's own folder, under a name we generated.
  if path is null or path !~ ('^' || uid::text || '/[a-z0-9-]{8,64}\.(jpg|webp)$') then
    raise exception 'bad upload path';
  end if;
  if exists (select 1 from item_photos where item_slug = item) then
    raise exception 'this bear already has a photo';
  end if;
  if exists (select 1 from photo_submissions
             where item_slug = item and submitter = uid and status = 'pending') then
    raise exception 'you already have a pending photo for this bear';
  end if;
  if (select count(*) from photo_submissions
      where submitter = uid and created_at > now() - interval '1 day') >= 20 then
    raise exception 'daily photo limit reached';
  end if;
  insert into photo_submissions (item_slug, submitter, storage_path)
  values (item, uid, path)
  returning id into new_id;
  return new_id;
end;
$$;

revoke all on function submit_photo(text, text) from public;
revoke all on function submit_photo(text, text) from anon;
grant execute on function submit_photo(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage. Uploads go to a PRIVATE bucket; only approved copies are public.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photo-submissions', 'photo-submissions', false, 3145728,
        array['image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bear-photos', 'bear-photos', true, 3145728,
        array['image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Members upload into a folder named after their own user id, nowhere else.
drop policy if exists "photo submissions: upload to own folder" on storage.objects;
create policy "photo submissions: upload to own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'photo-submissions'
              and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "photo submissions: owner or admin reads" on storage.objects;
create policy "photo submissions: owner or admin reads" on storage.objects
  for select to authenticated
  using (bucket_id = 'photo-submissions'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- The owner may withdraw an upload (the page does this if registering it
-- fails); admins clear rejected ones.
drop policy if exists "photo submissions: owner or admin deletes" on storage.objects;
create policy "photo submissions: owner or admin deletes" on storage.objects
  for delete to authenticated
  using (bucket_id = 'photo-submissions'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- The public bucket is written only by admins, on approval.
drop policy if exists "bear photos: admin reads" on storage.objects;
create policy "bear photos: admin reads" on storage.objects
  for select to authenticated
  using (bucket_id = 'bear-photos' and public.is_admin());
drop policy if exists "bear photos: admin writes" on storage.objects;
create policy "bear photos: admin writes" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'bear-photos' and public.is_admin());
drop policy if exists "bear photos: admin updates" on storage.objects;
create policy "bear photos: admin updates" on storage.objects
  for update to authenticated
  using (bucket_id = 'bear-photos' and public.is_admin())
  with check (bucket_id = 'bear-photos' and public.is_admin());
drop policy if exists "bear photos: admin deletes" on storage.objects;
create policy "bear photos: admin deletes" on storage.objects
  for delete to authenticated
  using (bucket_id = 'bear-photos' and public.is_admin());

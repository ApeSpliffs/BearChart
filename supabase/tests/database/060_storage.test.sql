-- Storage buckets: who may upload, read and delete what.
begin;
select no_plan();
select tests.seed_personas();
-- storage.protect_delete blocks direct DELETEs unless this is set; the
-- policies below are what we are testing, not the Storage API guard.
select set_config('storage.allow_delete_query', 'true', true);

-- showcase-photos: write = own folder + showcase entitlement (or admin)
select tests.as_user('power');
select lives_ok(format($$ insert into storage.objects (bucket_id, name) values ('showcase-photos', %L) $$,
  tests.uid('power') || '/abcdefgh.jpg'), 'power: upload into own showcase folder');
select throws_ok(format($$ insert into storage.objects (bucket_id, name) values ('showcase-photos', %L) $$,
  tests.uid('free') || '/abcdefgh.jpg'), '42501', null, 'power: cannot upload into another member''s folder');
-- L2: only the names the page generates (<8-40 lowercase alnum>.jpg)
select throws_ok(format($$ insert into storage.objects (bucket_id, name) values ('showcase-photos', %L) $$,
  tests.uid('power') || '/a.jpg'), '42501', null, 'power: short name refused');
select throws_ok(format($$ insert into storage.objects (bucket_id, name) values ('showcase-photos', %L) $$,
  tests.uid('power') || '/abcdefgh.html'), '42501', null, 'power: non-.jpg name refused');
select throws_ok(format($$ insert into storage.objects (bucket_id, name) values ('showcase-photos', %L) $$,
  tests.uid('power') || '/sub/abcdefgh.jpg'), '42501', null, 'power: nested path refused');
select isnt_empty($$ select 1 from storage.objects where bucket_id = 'showcase-photos' $$,
  'power: reads own showcase photo');
select tests.as_user('pro');
select throws_ok(format($$ insert into storage.objects (bucket_id, name) values ('showcase-photos', %L) $$,
  tests.uid('pro') || '/abcdefgh.jpg'), '42501', null, 'pro: no showcase entitlement');
select tests.as_anon();
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('showcase-photos', 'x/abcdefgh.jpg') $$,
  '42501', null, 'anon: cannot upload');
select is_empty($$ select 1 from storage.objects where bucket_id = 'showcase-photos' $$, 'anon: cannot list');
-- M2: a showcase photo is readable by its owner, an admin, or anyone signed in
-- when a PUBLIC, non-hidden showcase of the photo's owner shows it.
select tests.as_user('free');
select is_empty($$ select 1 from storage.objects where bucket_id = 'showcase-photos' $$,
  'free: cannot read a photo whose owner has no public showcase');
select tests.as_user('admin');
select isnt_empty($$ select 1 from storage.objects where bucket_id = 'showcase-photos' $$,
  'admin: reads any showcase photo');
select tests.as_postgres();
insert into public.showcases (user_id, handle, display_name, bears, is_public, details)
values (tests.uid('power'), 'photo-case', 'Photo', array['rls-test-bear'], false,
        jsonb_build_object('rls-test-bear', jsonb_build_object('photo', tests.uid('power') || '/abcdefgh.jpg')));
select tests.as_user('free');
select is_empty($$ select 1 from storage.objects where bucket_id = 'showcase-photos' $$,
  'free: cannot read a photo on a PRIVATE showcase');
select tests.as_postgres();
update public.showcases set is_public = true where handle = 'photo-case';
select tests.as_user('free');
select isnt_empty($$ select 1 from storage.objects where bucket_id = 'showcase-photos' $$,
  'free: reads a photo shown on a public showcase');
select tests.as_postgres();
update public.showcases set hidden_by_admin = true where handle = 'photo-case';
select tests.as_user('free');
select is_empty($$ select 1 from storage.objects where bucket_id = 'showcase-photos' $$,
  'free: cannot read it once an admin hides the showcase');
-- Another member's public showcase cannot expose power's photo by naming it.
select tests.as_postgres();
update public.showcases set hidden_by_admin = false, is_public = true,
  details = '{}'::jsonb where handle = 'photo-case';
insert into public.showcases (user_id, handle, display_name, bears, is_public, details)
values (tests.uid('trial_power'), 'thief-case', 'Thief', array['rls-test-bear'], true,
        jsonb_build_object('rls-test-bear', jsonb_build_object('photo', tests.uid('power') || '/abcdefgh.jpg')));
select tests.as_user('free');
select is_empty($$ select 1 from storage.objects where bucket_id = 'showcase-photos' $$,
  'free: another member''s showcase cannot expose power''s photo');
select tests.as_anon();
select throws_ok($$ select public.showcase_photo_is_public('x/abcdefgh.jpg') $$, '42501', null,
  'anon: showcase_photo_is_public not executable');
select tests.as_user('free');
select ok(not public.showcase_photo_is_public('not-a-uuid/abcdefgh.jpg'), 'a malformed path is not public');
select is(tests.affected($$ delete from storage.objects where bucket_id = 'showcase-photos' $$), 0::bigint,
  'free: cannot delete someone else''s photo');
select tests.as_user('power');
select is(tests.affected($$ delete from storage.objects where bucket_id = 'showcase-photos' $$), 1::bigint,
  'power: can delete own photo');

-- photo-submissions: own folder only; owner or admin reads
select tests.as_user('free');
select lives_ok(format($$ insert into storage.objects (bucket_id, name) values ('photo-submissions', %L) $$,
  tests.uid('free') || '/abcdefgh.jpg'), 'free: upload submission into own folder');
select throws_ok(format($$ insert into storage.objects (bucket_id, name) values ('photo-submissions', %L) $$,
  tests.uid('free') || '/photo.svg'), '42501', null, 'free: only generated .jpg names');
select throws_ok(format($$ insert into storage.objects (bucket_id, name) values ('photo-submissions', %L) $$,
  tests.uid('other') || '/abcdefgh.jpg'), '42501', null, 'free: not into another folder');
select isnt_empty($$ select 1 from storage.objects where bucket_id = 'photo-submissions' $$, 'free: reads own upload');
select tests.as_user('other');
select is_empty($$ select 1 from storage.objects where bucket_id = 'photo-submissions' $$, 'other: cannot read');
select is(tests.affected($$ delete from storage.objects where bucket_id = 'photo-submissions' $$), 0::bigint,
  'other: cannot delete');
select tests.as_anon();
select is_empty($$ select 1 from storage.objects where bucket_id = 'photo-submissions' $$, 'anon: cannot read');
select tests.as_user('admin');
select isnt_empty($$ select 1 from storage.objects where bucket_id = 'photo-submissions' $$, 'admin: reads all');

-- bear-photos: admin-only writes (public bucket: served by URL, not by listing)
select tests.as_user('power');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('bear-photos', 'x.jpg') $$,
  '42501', null, 'power: cannot write public bucket');
select tests.as_anon();
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('bear-photos', 'y.jpg') $$,
  '42501', null, 'anon: cannot write public bucket');
select tests.as_user('admin');
select lives_ok($$ insert into storage.objects (bucket_id, name) values ('bear-photos', 'x.jpg') $$,
  'admin: writes public bucket');
select tests.as_user('free');
select is(tests.affected($$ delete from storage.objects where bucket_id = 'bear-photos' $$), 0::bigint,
  'free: cannot delete from public bucket');

-- L2: member-upload buckets accept JPEG only
select tests.as_postgres();
select is((select allowed_mime_types from storage.buckets where id = 'showcase-photos'), array['image/jpeg'],
  'showcase-photos: JPEG only');
select is((select allowed_mime_types from storage.buckets where id = 'photo-submissions'), array['image/jpeg'],
  'photo-submissions: JPEG only');

select * from finish();
rollback;

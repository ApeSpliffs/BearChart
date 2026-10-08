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
  tests.uid('power') || '/a.jpg'), 'power: upload into own showcase folder');
select throws_ok(format($$ insert into storage.objects (bucket_id, name) values ('showcase-photos', %L) $$,
  tests.uid('free') || '/x.jpg'), '42501', null, 'power: cannot upload into another member''s folder');
select isnt_empty($$ select 1 from storage.objects where bucket_id = 'showcase-photos' $$,
  'power: reads own showcase photo');
select tests.as_user('pro');
select throws_ok(format($$ insert into storage.objects (bucket_id, name) values ('showcase-photos', %L) $$,
  tests.uid('pro') || '/a.jpg'), '42501', null, 'pro: no showcase entitlement');
select tests.as_anon();
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('showcase-photos', 'x/a.jpg') $$,
  '42501', null, 'anon: cannot upload');
select is_empty($$ select 1 from storage.objects where bucket_id = 'showcase-photos' $$, 'anon: cannot list');
-- Today any signed-in member may read every showcase photo, even one whose
-- owner has no public showcase (power has none in this file).
select tests.as_user('free');
select todo_start('security workstream 20261008000100+: showcase photos readable only by owner, admin, or via a public showcase');
select is_empty($$ select 1 from storage.objects where bucket_id = 'showcase-photos' $$,
  'free: cannot read a photo whose owner has no public showcase');
select todo_end();
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

select * from finish();
rollback;

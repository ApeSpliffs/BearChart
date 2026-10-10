-- Data accuracy (migration 20261008000250): the NWOT condition, the new sale
-- columns, and merging one item into another without losing anything a member
-- saved.
begin;
select no_plan();
select tests.seed_personas();
select tests.as_postgres();

-- The condition vocabulary (tools/domain_vocab.py CONDITION_CODES).
insert into public.items (slug, canonical_name, category)
values ('nwot-test-bear', 'NWOT Test Bear', 'bear'), ('merge-old-bear', 'Old Bear', 'bear'),
       ('merge-new-bear', 'New Bear', 'bear');

select lives_ok($$ insert into public.sales (item_id, sold_price, evidence_type, condition)
                   select id, 20, 'collector_report', 'NWOT' from public.items
                    where slug = 'nwot-test-bear' $$,
  'a new-without-tags sale is accepted');
select throws_ok($$ insert into public.sales (item_id, sold_price, evidence_type, condition)
                    select id, 20, 'collector_report', 'Brand New' from public.items
                     where slug = 'nwot-test-bear' $$,
  '23514', null, 'a condition outside the vocabulary is refused');
select lives_ok($$ insert into public.sales (item_id, sold_price, evidence_type, condition,
                                             ship_price, seller_is_operator, attributes, excluded)
                   select id, 30, 'collector_report', 'NWT', 0, true,
                          '{"size_in": 16, "sound": null}', '{"reason": "test"}'
                     from public.items where slug = 'nwot-test-bear' $$,
  'shipping, operator flag, attributes and quarantine are stored');
select throws_ok($$ insert into public.sales (item_id, sold_price, evidence_type, ship_price)
                    select id, 30, 'collector_report', -1 from public.items
                     where slug = 'nwot-test-bear' $$,
  '23514', null, 'a negative shipping price is refused');
select is((select seller_is_operator from public.sales s join public.items i on i.id = s.item_id
            where i.slug = 'nwot-test-bear' and s.sold_price = 20), false,
  'seller_is_operator defaults to false');

-- Merging: every reference moves to the survivor.
insert into public.sales (item_id, sold_price, evidence_type)
  select id, 15, 'collector_report' from public.items where slug = 'merge-old-bear';
insert into public.wishlists (user_id, item_id) values
  (tests.uid('pro'), 'merge-old-bear'), (tests.uid('power'), 'merge-old-bear'),
  (tests.uid('power'), 'merge-new-bear');
insert into public.collection_entries (user_id, id, entry) values
  (tests.uid('pro'), 'entry-merge-1', '{"item_id": "merge-old-bear", "qty": 1}');

insert into public.item_photos (item_slug, image_url) values
  ('merge-old-bear', 'https://example.test/old.jpg'),
  ('merge-new-bear', 'https://example.test/new.jpg');
insert into public.photo_submissions (item_slug, submitter, storage_path) values
  ('merge-old-bear', tests.uid('pro'), 'pro/old.jpg'),
  ('merge-new-bear', tests.uid('pro'), 'pro/new.jpg'),
  ('merge-old-bear', tests.uid('power'), 'power/old.jpg');

select lives_ok($$ select public.merge_item_slug('merge-old-bear', 'merge-new-bear') $$,
  'merge_item_slug runs, even with a pending photo on both slugs');
select is((select image_url from public.item_photos where item_slug = 'merge-new-bear'),
  'https://example.test/new.jpg', 'the survivor keeps its own photo');
select is((select count(*) from public.item_photos where item_slug = 'merge-old-bear'), 0::bigint,
  'no orphan photo row is left on the old slug');
select is((select count(*) from public.photo_submissions where item_slug = 'merge-old-bear'), 0::bigint,
  'every submission now names the survivor');
select is((select count(*) from public.photo_submissions
            where item_slug = 'merge-new-bear' and submitter = tests.uid('pro')
              and status = 'pending'), 1::bigint,
  'a member with a pending photo on both keeps exactly one pending');
select is((select status from public.photo_submissions where storage_path = 'pro/old.jpg'),
  'rejected', 'the old duplicate is rejected, not lost');
select is((select status from public.photo_submissions where storage_path = 'power/old.jpg'),
  'pending', 'a non-conflicting pending submission simply moves');
select is((select count(*) from public.items where slug = 'merge-old-bear'), 0::bigint,
  'the merged item row is gone');
select is((select count(*) from public.sales s join public.items i on i.id = s.item_id
            where i.slug = 'merge-new-bear' and s.sold_price = 15), 1::bigint,
  'its sale moved to the survivor rather than cascading away');
select is((select count(*) from public.wishlists where item_id = 'merge-old-bear'), 0::bigint,
  'no wishlist still names the old id');
select is((select count(*) from public.wishlists where item_id = 'merge-new-bear'), 2::bigint,
  'each member keeps the bear once, even when they had listed both');
select is((select entry->>'item_id' from public.collection_entries where id = 'entry-merge-1'),
  'merge-new-bear', 'a cloud collection entry follows the merge');
select lives_ok($$ select public.merge_item_slug('merge-old-bear', 'merge-new-bear') $$,
  'running it twice is harmless');

-- Owner-run only.
select tests.as_user('admin');
select throws_ok($$ select public.merge_item_slug('a-bear', 'b-bear') $$,
  '42501', null, 'no client role can merge items');

select * from finish();
rollback;

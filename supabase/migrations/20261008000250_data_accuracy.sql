-- Data accuracy (audit workstream 3).
--
--  * sales.condition gains 'NWOT' (new without tags). The list must equal
--    tools/domain_vocab.py CONDITION_CODES; tools/test_import.py enforces it.
--  * Columns for what the pipeline now records: product line, variant group and
--    size on items; shipping, operator flag, parsed attributes, quarantine and
--    reassignment on sales. seed.sql (tools/export_sql.py) fills them.
--  * Config values (fees, recency, operator cap, multipliers) are NOT written
--    here: seed.sql upserts valuation_config from data.json, so the numbers have
--    one home (tools/domain_vocab.py) and cannot drift into SQL.
-- Idempotent: safe to run twice.

-- ---------------------------------------------------------------------------
-- sales.condition: add NWOT
-- ---------------------------------------------------------------------------

alter table public.sales drop constraint if exists sales_condition_check;
alter table public.sales add constraint sales_condition_check check (condition in
  ('NWT','NWOT','Mint','Excellent','Good','Fair','Poor','Damaged','Incomplete','Unknown'));

-- ---------------------------------------------------------------------------
-- items: line, variants, size, provenance of the catalogue entry
-- ---------------------------------------------------------------------------

alter table public.items
  -- The product line ("Mini", "Promise Pets"). Used to be overloaded onto
  -- items.variant, which made every item in a line warn about variants.
  add column if not exists line             text,
  add column if not exists variant_of       text,
  add column if not exists variant_group    text,
  add column if not exists size_in          numeric(5,1),
  add column if not exists size_class       text,
  add column if not exists catalogue_source text;

-- ---------------------------------------------------------------------------
-- sales: shipping, operator flag, attributes, quarantine
-- ---------------------------------------------------------------------------

alter table public.sales
  -- What the buyer paid for shipping. Shown, never folded into a valuation.
  add column if not exists ship_price         numeric(10,2),
  -- Sold by Jay's Retro Exchange (the operator). Capped in every valuation.
  add column if not exists seller_is_operator boolean not null default false,
  -- Parsed from the listing title: {size_in, sound}.
  add column if not exists attributes         jsonb,
  -- Kept for transparency, ignored by the engine: {reason}.
  add column if not exists excluded           jsonb,
  add column if not exists reassigned_from    text,
  add column if not exists condition_basis    text,
  add column if not exists variant_basis      text;

alter table public.sales drop constraint if exists sales_ship_price_check;
alter table public.sales add constraint sales_ship_price_check
  check (ship_price is null or ship_price >= 0);

-- ---------------------------------------------------------------------------
-- Merging one catalogue item into another (tools/catalogue_identity.json)
-- ---------------------------------------------------------------------------
--
-- Rewrites every place an item is referenced, by slug or by uuid, so nothing a
-- member saved is lost: cloud collection entries, showcases, wishlists, photos,
-- submissions and reports by slug; sales, legacy collections, snapshots and
-- flows by uuid. The merged items row is then deleted (its sales already moved,
-- so the cascade removes nothing). If the survivor is not seeded yet, the old
-- row is simply renamed. The browser does the same through canonicalId(), so
-- running this is not urgent. Owner-run only: no client can call it.

create or replace function public.merge_item_slug(p_old text, p_new text)
returns void language plpgsql security definer set search_path = public as $$
declare
  old_id uuid;
  new_id uuid;
begin
  if p_old is null or p_new is null or p_old = p_new then
    return;
  end if;
  select id into old_id from items where slug = p_old;
  select id into new_id from items where slug = p_new;

  update collection_entries
     set entry = jsonb_set(entry, '{item_id}', to_jsonb(p_new))
   where entry->>'item_id' = p_old;

  update showcases s
     set bears = (select coalesce(array_agg(x.b order by x.o), '{}')
                    from (select b, min(o) as o
                            from unnest(array_replace(s.bears, p_old, p_new))
                                 with ordinality as u(b, o)
                           group by b) x)
   where p_old = any (s.bears);

  insert into wishlists (user_id, item_id, created_at)
    select user_id, p_new, created_at from wishlists where item_id = p_old
    on conflict do nothing;
  delete from wishlists where item_id = p_old;

  -- One approved photo per item: the survivor's own photo wins, and the old
  -- slug's row (otherwise an orphan nothing can show) is removed.
  update item_photos set item_slug = p_new
   where item_slug = p_old
     and not exists (select 1 from item_photos where item_slug = p_new);
  delete from item_photos where item_slug = p_old;
  -- One pending submission per member per item: a member with a pending photo
  -- on both slugs keeps the survivor's; the old one is rejected, not deleted,
  -- so the stored file and the review trail stay accounted for.
  update photo_submissions o set status = 'rejected'
   where o.item_slug = p_old and o.status = 'pending'
     and exists (select 1 from photo_submissions n
                  where n.item_slug = p_new and n.submitter = o.submitter
                    and n.status = 'pending');
  update photo_submissions set item_slug = p_new where item_slug = p_old;
  update comp_submissions set item_slug = p_new where item_slug = p_old;
  update item_reports set item_slug = p_new where item_slug = p_old;

  if old_id is not null then
    if new_id is null then
      update items set slug = p_new where id = old_id;
    else
      update sales set item_id = new_id where item_id = old_id;
      update collections set item_id = new_id where item_id = old_id;
      update holding_snapshots set item_id = new_id where item_id = old_id;
      update portfolio_flows set item_id = new_id where item_id = old_id;
      delete from items where id = old_id;
    end if;
  end if;
end $$;
revoke all on function public.merge_item_slug(text, text) from public, anon, authenticated;

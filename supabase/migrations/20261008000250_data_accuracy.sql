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

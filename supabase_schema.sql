-- ============================================================================
-- BearChart - Supabase / PostgreSQL schema
--
-- Public users may read. Only authenticated admins may write. There is no
-- unrestricted write path anywhere in this file.
--
-- Apply with:  supabase db push     (or paste into the SQL editor)
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Admin roles
-- ---------------------------------------------------------------------------

create table if not exists admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  role       text not null default 'editor' check (role in ('editor', 'owner')),
  created_at timestamptz not null default now()
);

-- Security definer so the policies below can consult this table without
-- recursing through its own RLS.
create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from admins a where a.user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- Items
-- ---------------------------------------------------------------------------

create table if not exists items (
  id                  uuid primary key default gen_random_uuid(),
  slug                text unique not null,
  canonical_name      text not null,
  aliases             text[] not null default '{}',
  category            text not null,
  subcategory         text,
  species             text,

  release_year        int check (release_year between 1996 and 2100),
  release_month       int check (release_month between 1 and 12),
  retirement_year     int,

  -- Section 18: versions and variants are first-class. Two rows that differ
  -- only by version are different items and are never averaged together.
  version             text,
  variant             text,

  -- Section 25: an original release and a Vault reissue are not the same item.
  original_release    boolean not null default true,
  vault_release       boolean not null default false,
  vault_release_year  int,
  rerelease_years     int[],

  fur_color           text,
  eye_color           text,
  paw_pad_style       text,
  nose_style          text,
  size                text,
  tag_era             text,
  barcode             text,
  upc                 text,
  mpn                 text,

  sound               text,
  sound_type          text,
  scent               text,
  scent_type          text,
  stuffing_type       text,
  unstuffed_available boolean,

  licensed            boolean not null default false,
  franchise           text,
  limited_edition     boolean not null default false,
  edition_size        int,
  numbered            boolean not null default false,
  employee_exclusive  boolean not null default false,
  store_exclusive     boolean not null default false,
  event_exclusive     boolean not null default false,
  zoo_exclusive       boolean not null default false,
  international_exclusive boolean not null default false,
  online_exclusive    boolean not null default false,
  mini_bean           boolean not null default false,
  loveable_legends    boolean not null default false,
  retired             boolean,
  is_lot              boolean not null default false,

  rarity              text,
  notes               text,

  -- Images carry their provenance the same way sales do. Store your own photos in
  -- a Supabase Storage bucket and put the public URL here; do not hotlink official
  -- Build-A-Bear product photography.
  image_url           text,
  image_credit        text,
  image_source        text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists items_name_idx
  on items using gin (to_tsvector('english'::regconfig, canonical_name));

-- Section 19: search has to cover aliases, franchise, species and notes too.
--
-- array_to_string() is STABLE, not IMMUTABLE (it depends on the element type's
-- output function), so Postgres refuses it inside an index expression. Aliases
-- therefore get their own array index, which is the better tool for them anyway:
-- exact alias lookup is a containment test, not a full-text match.
create index if not exists items_search_idx
  on items using gin (to_tsvector('english'::regconfig,
    coalesce(canonical_name, '') || ' ' ||
    coalesce(franchise, '') || ' ' ||
    coalesce(species, '') || ' ' ||
    coalesce(variant, '') || ' ' ||
    coalesce(notes, '')));

create index if not exists items_aliases_idx on items using gin (aliases);

create index if not exists items_year_idx     on items (release_year);
create index if not exists items_category_idx on items (category);
create index if not exists items_franchise_idx on items (franchise) where franchise is not null;

-- ---------------------------------------------------------------------------
-- Sales - sold observations only
-- ---------------------------------------------------------------------------

create table if not exists sales (
  id                uuid primary key default gen_random_uuid(),
  item_id           uuid not null references items(id) on delete cascade,

  sale_date         date,
  sold_price        numeric(10,2) not null check (sold_price > 0),
  -- Set only where the source recorded a range rather than one transaction.
  price_high        numeric(10,2) check (price_high is null or price_high >= sold_price),
  currency          text not null default 'USD',
  -- >1 when the row is an average across several sales (a Terapeak-style summary
  -- rather than one transaction). Counts toward confidence, contributes one value
  -- to the median.
  sample_size       int check (sample_size is null or sample_size > 0),

  condition         text check (condition in
                      ('NWT','Mint','Excellent','Good','Fair','Poor','Damaged',
                       'Incomplete','Unknown')),
  completeness      text check (completeness in
                      ('complete','packaged','some_originals','bare','unstuffed',
                       'altered','unknown')),

  tags_present               boolean,
  birth_certificate_present  boolean,
  outfit_present             boolean,
  accessories_present        boolean,
  sound_present              boolean,
  sound_working              boolean,
  scent_present              boolean,
  stuffing_status            text,

  marketplace       text,
  source_url        text,
  listing_id        text,
  evidence_type     text not null default 'completed_sale' check (evidence_type in
                      ('completed_sale','auction_result','collector_report',
                       'historical_archive','retail_reference','active_listing')),
  verified          boolean not null default false,
  -- A sale you made yourself: condition and contents are known, not inferred.
  first_party       boolean not null default false,
  shipping_included boolean,
  notes             text,

  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id),

  -- Section 33: a row may only claim to be a verified completed sale if it can
  -- prove it. Anything thinner belongs to a weaker evidence type.
  constraint completed_sale_needs_provenance check (
    evidence_type <> 'completed_sale'
    or (sale_date is not null and marketplace is not null and listing_id is not null)
  ),

  -- An average across several sales is never a single verified transaction.
  constraint aggregate_is_not_a_completed_sale check (
    sample_size is null or sample_size = 1 or evidence_type <> 'completed_sale'
  )
);

create index if not exists sales_item_date_idx on sales (item_id, sale_date desc);
create index if not exists sales_evidence_idx  on sales (evidence_type);

-- ---------------------------------------------------------------------------
-- Valuation config - section 4/5/8 multipliers live in data, not in code
-- ---------------------------------------------------------------------------

create table if not exists valuation_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- User collections
-- ---------------------------------------------------------------------------

create table if not exists collections (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  item_id      uuid not null references items(id) on delete cascade,
  condition    text,
  completeness text,
  qty          int not null default 1 check (qty > 0),
  paid_price   numeric(10,2),
  notes        text,
  created_at   timestamptz not null default now()
);

create index if not exists collections_user_idx on collections (user_id);

-- ---------------------------------------------------------------------------
-- Adding to your own collection from the browser
--
-- The page knows items by slug; the table keys on uuid. This resolves one to the
-- other and stamps auth.uid() server-side, so a caller cannot write rows into
-- somebody else's collection by passing a different user_id.
--
-- security invoker (the default) means RLS still applies to the insert.
-- ---------------------------------------------------------------------------

create or replace function add_collection_items(entries jsonb)
returns integer
language plpgsql
set search_path = public
as $$
declare
  added integer := 0;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  -- Syncing a collection to the server is a paid feature, and this is the line
  -- that enforces it. Hiding the button in the page enforces nothing.
  if not has_entitlement('collection_sync') then
    raise exception 'collection sync requires a Pro membership';
  end if;

  insert into collections (user_id, item_id, condition, completeness, qty)
  select
    auth.uid(),                      -- never taken from the caller's payload
    i.id,
    nullif(e->>'condition', ''),
    nullif(e->>'completeness', ''),
    greatest(coalesce((e->>'qty')::int, 1), 1)
  from jsonb_array_elements(entries) as e
  join items i on i.slug = e->>'item_id_slug';

  get diagnostics added = row_count;
  return added;
end $$;

-- ---------------------------------------------------------------------------
-- Membership
--
-- This is where a paid feature is actually refused. The browser can only hide a
-- button; these policies are what a request has to get past, however it is made.
-- ---------------------------------------------------------------------------

create table if not exists subscriptions (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  tier           text not null default 'free' check (tier in ('free','pro','power')),
  status         text not null default 'active'
                 check (status in ('active','past_due','canceled','trialing')),
  provider       text,
  provider_customer_id     text,
  provider_subscription_id text unique,
  current_period_end timestamptz,
  updated_at     timestamptz not null default now()
);

-- The tier in force, according to the server. A lapsed or cancelled
-- subscription reads as free the moment its period ends - no grace period is
-- granted here, because a grace period should be a deliberate product decision
-- rather than an accident of a missing date check.
create or replace function current_tier()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select s.tier from subscriptions s
    where s.user_id = auth.uid()
      and s.status in ('active','trialing')
      and (s.current_period_end is null or s.current_period_end > now())
  ), 'free');
$$;

create or replace function has_entitlement(feature text)
returns boolean
language sql
stable
-- A mutable search_path lets a caller who can create objects shadow a table this
-- function names and have it resolve to theirs. Pinning it removes that.
set search_path = public
as $$
  select case current_tier()
    when 'power' then feature in (
      'collection_sync','hosted_history','insurance_archive','id_priority',
      'value_digest','wishlist_alerts',
      'alerts_push','alerts_email','poll_priority',
      'outfit_assembly','api_access')
    when 'pro' then feature in (
      'collection_sync','hosted_history','insurance_archive','id_priority',
      'value_digest','wishlist_alerts')
    else false
  end;
$$;

-- Webhook idempotency. Stripe delivers at least once, not exactly once, and
-- retries anything that does not return 2xx. Recording the event id first makes
-- a replay a no-op instead of a second month of membership.
create table if not exists stripe_events (
  id          text primary key,
  type        text not null,
  received_at timestamptz not null default now()
);

alter table subscriptions enable row level security;
alter table stripe_events enable row level security;

-- No policy on stripe_events at all: RLS on with zero policies denies every
-- client. Only the service role, which bypasses RLS, may touch it.

-- You may read your own subscription and nothing else. Writes come only from
-- the payment webhook, which runs with the service role - a client that could
-- write this table could simply grant itself the top tier.
drop policy if exists subs_read_own on subscriptions;
create policy subs_read_own on subscriptions for select
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Portfolio history
--
-- Snapshots are IMMUTABLE facts about what was believed on a given day, never a
-- view recomputed from today's comps. When a 2019 sale turns up tomorrow it
-- changes what we now think that item was worth in 2019 - rewriting the history
-- to match would give the user a chart that changes shape every night and can
-- never be reconciled with an export they already filed.
-- ---------------------------------------------------------------------------

create table if not exists holding_snapshots (
  snapshot_date    date not null,
  user_id          uuid not null references auth.users(id) on delete cascade,
  collection_id    uuid not null references collections(id) on delete cascade,
  item_id          uuid not null references items(id),

  qty              integer not null check (qty > 0),
  -- null, never 0, when the item has no comps. Zero is a claim; null is the truth.
  unit_value_cents integer,
  value_cents      integer,
  lower_bound_cents integer,
  confidence       text not null,
  comp_count       integer not null default 0,
  -- The multiplier chain, frozen, so a figure can be explained years later.
  valuation_basis  jsonb not null default '{}',

  primary key (snapshot_date, collection_id)
);
create index if not exists snapshots_user_day
  on holding_snapshots (user_id, snapshot_date);

-- What the collector added or removed. Netted out of performance so that going
-- shopping does not read as appreciation.
create table if not exists portfolio_flows (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  occurred_on   date not null,
  item_id       uuid references items(id) on delete set null,
  direction     text not null check (direction in ('acquire','dispose')),
  qty           integer not null default 1 check (qty > 0),
  value_cents   integer not null,
  actual_price_cents integer,
  note          text
);
create index if not exists flows_user_day on portfolio_flows (user_id, occurred_on);

alter table holding_snapshots enable row level security;
alter table portfolio_flows   enable row level security;

-- Reading your own history is always allowed; a lapsed member does not lose
-- sight of their own data. Writing new history server-side is the paid part.
drop policy if exists snapshots_read_own on holding_snapshots;
create policy snapshots_read_own on holding_snapshots for select
  using (auth.uid() = user_id);
drop policy if exists snapshots_write_own on holding_snapshots;
create policy snapshots_write_own on holding_snapshots for insert
  with check (auth.uid() = user_id and has_entitlement('hosted_history'));
drop policy if exists flows_own on portfolio_flows;
create policy flows_own on portfolio_flows for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Convenience view: only the evidence that may drive a valuation
-- ---------------------------------------------------------------------------

create or replace view market_sales as
  select *
  from sales
  where evidence_type in
    ('completed_sale', 'auction_result', 'collector_report', 'historical_archive');

-- Without this a view runs with its creator's permissions and ignores the
-- caller's RLS. Harmless while sales are public; a trap the moment they are not.
alter view market_sales set (security_invoker = true);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists items_touch on items;
create trigger items_touch before update on items
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table items             enable row level security;
alter table sales             enable row level security;
alter table valuation_config  enable row level security;
alter table collections       enable row level security;
alter table admins            enable row level security;

-- Public read of the guide itself.
drop policy if exists items_public_read on items;
create policy items_public_read on items for select using (true);

drop policy if exists sales_public_read on sales;
create policy sales_public_read on sales for select using (true);

drop policy if exists config_public_read on valuation_config;
create policy config_public_read on valuation_config for select using (true);

-- Writes are admin-only, one policy per verb so nothing is granted by accident.
drop policy if exists items_admin_insert on items;
create policy items_admin_insert on items for insert with check (is_admin());
drop policy if exists items_admin_update on items;
create policy items_admin_update on items for update using (is_admin()) with check (is_admin());
drop policy if exists items_admin_delete on items;
create policy items_admin_delete on items for delete using (is_admin());

drop policy if exists sales_admin_insert on sales;
create policy sales_admin_insert on sales for insert with check (is_admin());
drop policy if exists sales_admin_update on sales;
create policy sales_admin_update on sales for update using (is_admin()) with check (is_admin());
drop policy if exists sales_admin_delete on sales;
create policy sales_admin_delete on sales for delete using (is_admin());

drop policy if exists config_admin_write on valuation_config;
create policy config_admin_write on valuation_config for all
  using (is_admin()) with check (is_admin());

-- A collector sees and edits only their own collection.
drop policy if exists collections_own on collections;
create policy collections_own on collections for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- The admin roster is readable only by admins, and writable by owners only.
drop policy if exists admins_read on admins;
create policy admins_read on admins for select using (is_admin());
drop policy if exists admins_write on admins;
create policy admins_write on admins for all
  using (exists (select 1 from admins a where a.user_id = auth.uid() and a.role = 'owner'))
  with check (exists (select 1 from admins a where a.user_id = auth.uid() and a.role = 'owner'));

-- ---------------------------------------------------------------------------
-- Seed the valuation config to match data.json
-- ---------------------------------------------------------------------------

insert into valuation_config (key, value) values
  ('condition_multipliers', '{"NWT":1.25,"Mint":1.25,"Excellent":1.10,"Good":1.00,
     "Fair":0.75,"Poor":0.50,"Damaged":0.35,"Incomplete":0.60,"Unknown":1.00}'::jsonb),
  ('completeness_multipliers', '{"complete":1.15,"packaged":1.15,"some_originals":1.05,
     "bare":1.00,"unstuffed":1.00,"altered":0.85,"unknown":1.00}'::jsonb),
  ('bands', '{"buy":[0.55,0.70],"trade":[0.75,0.90],"high_ask":[1.10,1.30]}'::jsonb),
  ('confidence', '{"high_min":10,"medium_min":4,"low_min":1}'::jsonb)
on conflict (key) do nothing;


-- ---------------------------------------------------------------------------
-- Two linter warnings that stay, deliberately
--
-- current_tier() and is_admin() are SECURITY DEFINER and callable by anon. Both
-- are intentional and neither can be "fixed" without breaking something:
--
--   * is_admin() is referenced by the admins table's own RLS policy. As
--     SECURITY INVOKER it would re-enter that policy and recurse for ever.
--   * A role must hold EXECUTE on a function named in a policy for the policy to
--     evaluate, so revoking EXECUTE from anon/authenticated disables RLS rather
--     than tightening it.
--
-- Verified against the live project: anon gets false from is_admin() and 'free'
-- from current_tier(). Neither reveals anything.
--
-- stripe_events also shows as "RLS enabled, no policy". That is the intent:
-- RLS on with zero policies denies every client, and only the service role --
-- which the payment webhook uses -- bypasses it.
-- ---------------------------------------------------------------------------

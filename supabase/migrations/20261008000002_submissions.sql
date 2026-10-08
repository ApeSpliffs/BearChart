-- ===========================================================================
-- BearChart migration 02: collector submissions and problem reports
--
-- Apply after the base schema (20261008000001):
--   supabase db push
--
-- THE RULE THIS WHOLE FILE EXISTS TO ENFORCE
--   A submission is not a comp. Nothing here can move a valuation.
--
--   Submitted rows land in their own table with status 'pending' and stay
--   there. They reach the price guide only when an admin accepts one and it is
--   exported through tools/export_submissions.py into the same sold-comp
--   importer that every other observation goes through. There is no path from
--   "a stranger typed a number" to "the site publishes that number".
--
--   That matters more here than on most sites, because the operator buys and
--   sells the items being valued. A submission queue that fed straight into
--   prices would be an open invitation to talk a bear up before selling it -
--   or down before buying one.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Sold comps submitted by collectors
-- ---------------------------------------------------------------------------
create table if not exists comp_submissions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  item_slug      text not null,

  sold_price     numeric(10,2) not null check (sold_price > 0 and sold_price < 100000),
  sale_date      date,
  marketplace    text,
  listing_id     text,
  listing_url    text,
  condition      text,
  completeness   text,

  -- What the submitter says this is. Deliberately NOT the evidence_type the
  -- engine consumes: a stranger's word is a collector_report at best, and it
  -- becomes anything stronger only if a reviewer can verify the listing.
  -- 'completed_sale' is not accepted here at all - see submit_comp().
  claimed_type   text not null default 'collector_report',

  note           text check (note is null or length(note) <= 1000),

  status         text not null default 'pending'
                 check (status in ('pending', 'accepted', 'rejected', 'needs_info')),
  review_note    text,
  reviewed_by    uuid references auth.users(id),
  reviewed_at    timestamptz,
  exported_at    timestamptz,

  created_at     timestamptz not null default now()
);

create index if not exists comp_submissions_status_idx
  on comp_submissions (status, created_at desc);
create index if not exists comp_submissions_item_idx
  on comp_submissions (item_slug);
create index if not exists comp_submissions_user_idx
  on comp_submissions (user_id, created_at desc);

alter table comp_submissions enable row level security;

-- A submitter sees their own history and nothing else. The queue is not a
-- public feed: unreviewed prices on display would be exactly the thing this
-- design is avoiding.
drop policy if exists comp_sub_read_own on comp_submissions;
create policy comp_sub_read_own on comp_submissions for select
  using (user_id = auth.uid() or is_admin());

-- No direct inserts. Everything goes through submit_comp(), which stamps the
-- user and refuses a claim it cannot accept from an untrusted caller.
drop policy if exists comp_sub_admin_write on comp_submissions;
create policy comp_sub_admin_write on comp_submissions for update
  using (is_admin()) with check (is_admin());
drop policy if exists comp_sub_admin_delete on comp_submissions;
create policy comp_sub_admin_delete on comp_submissions for delete
  using (is_admin());

-- ---------------------------------------------------------------------------
-- "Something is wrong on this page"
-- ---------------------------------------------------------------------------
create table if not exists item_reports (
  id          uuid primary key default gen_random_uuid(),
  -- Null for a signed-out reporter. Requiring an account here would cut the
  -- reporting rate to near zero, and the thing being reported - a duplicate, a
  -- wrong year - costs nothing to check and is worthless to fake.
  user_id     uuid references auth.users(id) on delete set null,
  item_slug   text not null,

  reason      text not null check (reason in
                ('duplicate', 'wrong_year', 'wrong_name', 'wrong_species',
                 'wrong_image', 'bad_value', 'not_a_real_item', 'other')),
  note        text check (note is null or length(note) <= 500),
  -- Where the reader was, so a report can be reproduced.
  page_url    text check (page_url is null or length(page_url) <= 500),

  status      text not null default 'open'
              check (status in ('open', 'fixed', 'declined', 'duplicate_report')),
  review_note text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,

  created_at  timestamptz not null default now()
);

create index if not exists item_reports_status_idx
  on item_reports (status, created_at desc);
create index if not exists item_reports_item_idx on item_reports (item_slug);

alter table item_reports enable row level security;

-- Read is admin-only. A public report table is a message board, and this one
-- would be a message board anybody can post to.
drop policy if exists item_reports_admin_read on item_reports;
create policy item_reports_admin_read on item_reports for select
  using (is_admin());
drop policy if exists item_reports_admin_write on item_reports;
create policy item_reports_admin_write on item_reports for update
  using (is_admin()) with check (is_admin());
drop policy if exists item_reports_admin_delete on item_reports;
create policy item_reports_admin_delete on item_reports for delete
  using (is_admin());

-- ---------------------------------------------------------------------------
-- The only ways in
-- ---------------------------------------------------------------------------

-- Submitting a comp requires an account. Evidence has to be attributable: a
-- reviewer needs somebody to ask when a listing id does not check out, and an
-- anonymous price is not evidence, it is a rumour.
create or replace function submit_comp(entry jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  claimed text;
begin
  if auth.uid() is null then
    raise exception 'sign in to submit a sale';
  end if;
  if not exists (select 1 from items where slug = entry->>'item_slug') then
    raise exception 'unknown item';
  end if;

  claimed := coalesce(nullif(entry->>'claimed_type', ''), 'collector_report');
  -- An untrusted caller cannot label their own submission as the strongest
  -- class of evidence. Only a reviewer can promote it, and only after checking.
  if claimed not in ('collector_report', 'auction_result') then
    raise exception 'that evidence type has to be verified by a reviewer';
  end if;

  -- One pending submission per person per item: a queue full of the same
  -- claim is not more evidence, it is more reviewing.
  if exists (
    select 1 from comp_submissions
    where user_id = auth.uid()
      and item_slug = entry->>'item_slug'
      and status = 'pending'
  ) then
    raise exception 'you already have a pending submission for this item';
  end if;

  insert into comp_submissions (
    user_id, item_slug, sold_price, sale_date, marketplace, listing_id,
    listing_url, condition, completeness, claimed_type, note
  ) values (
    auth.uid(),                                  -- never from the payload
    entry->>'item_slug',
    (entry->>'sold_price')::numeric,
    nullif(entry->>'sale_date', '')::date,
    nullif(entry->>'marketplace', ''),
    nullif(entry->>'listing_id', ''),
    nullif(entry->>'listing_url', ''),
    nullif(entry->>'condition', ''),
    nullif(entry->>'completeness', ''),
    claimed,
    nullif(entry->>'note', '')
  )
  returning id into new_id;

  return new_id;
end $$;

-- Reporting a problem does not require an account.
create or replace function report_item(entry jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  if not exists (select 1 from items where slug = entry->>'item_slug') then
    raise exception 'unknown item';
  end if;

  insert into item_reports (user_id, item_slug, reason, note, page_url)
  values (
    auth.uid(),                                  -- null when signed out
    entry->>'item_slug',
    entry->>'reason',
    left(nullif(entry->>'note', ''), 500),
    left(nullif(entry->>'page_url', ''), 500)
  )
  returning id into new_id;

  return new_id;
end $$;

revoke all on function submit_comp(jsonb) from public;
revoke all on function report_item(jsonb) from public;
grant execute on function submit_comp(jsonb) to authenticated;
grant execute on function report_item(jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- KNOWN GAP, stated rather than papered over
--
-- report_item() is callable anonymously, so the reports table can be flooded.
-- The damage is bounded - reports are admin-read-only, the reason is a fixed
-- enum and the note is capped at 500 characters, so a flood is a delete
-- statement rather than a leak - but it is a real gap. If it is ever abused,
-- the fix is a captcha (Cloudflare Turnstile verified in an edge function)
-- rather than requiring an account, which would cost more reports than the
-- spam does.
-- ---------------------------------------------------------------------------

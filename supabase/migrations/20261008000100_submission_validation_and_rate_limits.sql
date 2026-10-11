-- ===========================================================================
-- Security H1 + L3: URL validation, length caps and database-side rate limits
-- for collector submissions and problem reports.
--
-- One rule (is_safe_https_url) is enforced in two places: a CHECK constraint,
-- so nothing reaches the table any other way, and submit_comp, so the caller
-- gets a readable message. The admin page still treats every stored link as
-- untrusted (it renders through sanitize.js), but a javascript: URL can no
-- longer be stored at all.
--
-- Supersedes the "KNOWN GAP" note in 20261008000002_submissions.sql: anonymous
-- reports are now rate limited (10 per requester per hour, 300 anonymous per
-- hour in total). Trade-off, accepted: a flood can use up the anonymous budget
-- and suppress anonymous reports for up to an hour. Signed-in reports are
-- unaffected. A captcha (Turnstile) is the next step if that is ever abused.
-- ===========================================================================

-- The scheme is matched case-insensitively (~*): browsers treat HTTPS:// as
-- https://, and the page accepts it.
create or replace function public.is_safe_https_url(p text)
returns boolean language sql immutable parallel safe set search_path = public as $$
  select p is not null
     and char_length(p) <= 500
     and p ~* '^https://[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+(?::[0-9]{1,5})?(?:[/?#][^[:space:][:cntrl:]"''<>\\`]*)?$';
$$;

-- A path on this site (what the report form sends: location.pathname).
-- Postgres caps a regex repetition count at 255, so length is checked apart.
create or replace function public.is_site_path(p text)
returns boolean language sql immutable parallel safe set search_path = public as $$
  select p is not null and char_length(p) <= 500 and p ~ '^/[A-Za-z0-9._~/%-]*$'
     and p !~ '^//';   -- '//host' is protocol-relative: another site, not a path
$$;

-- Clean existing rows so the constraints can be validated, not just NOT VALID.
-- (Review the UPDATE counts when applying to production.)
update public.comp_submissions set listing_url = null
  where listing_url is not null and not public.is_safe_https_url(listing_url);
update public.comp_submissions set marketplace = left(marketplace, 60) where char_length(marketplace) > 60;
update public.comp_submissions set listing_id = null
  where listing_id is not null and listing_id !~ '^[A-Za-z0-9._:/-]{1,64}$';
update public.comp_submissions set condition = left(condition, 30) where char_length(condition) > 30;
update public.comp_submissions set completeness = left(completeness, 30) where char_length(completeness) > 30;
update public.comp_submissions set review_note = left(review_note, 2000) where char_length(review_note) > 2000;
update public.item_reports set page_url = null
  where page_url is not null and not (public.is_site_path(page_url) or public.is_safe_https_url(page_url));

alter table public.comp_submissions
  drop constraint if exists comp_submissions_listing_url_safe,
  drop constraint if exists comp_submissions_marketplace_len,
  drop constraint if exists comp_submissions_listing_id_shape,
  drop constraint if exists comp_submissions_condition_len,
  drop constraint if exists comp_submissions_completeness_len,
  drop constraint if exists comp_submissions_review_note_len;
alter table public.comp_submissions
  add constraint comp_submissions_listing_url_safe check (listing_url is null or public.is_safe_https_url(listing_url)),
  add constraint comp_submissions_marketplace_len  check (marketplace is null or char_length(marketplace) <= 60),
  add constraint comp_submissions_listing_id_shape check (listing_id is null or listing_id ~ '^[A-Za-z0-9._:/-]{1,64}$'),
  add constraint comp_submissions_condition_len    check (condition is null or char_length(condition) <= 30),
  add constraint comp_submissions_completeness_len check (completeness is null or char_length(completeness) <= 30),
  add constraint comp_submissions_review_note_len  check (review_note is null or char_length(review_note) <= 2000);

alter table public.item_reports drop constraint if exists item_reports_page_url_shape;
alter table public.item_reports add constraint item_reports_page_url_shape check (
  page_url is null or public.is_site_path(page_url) or public.is_safe_https_url(page_url));

-- Rate limiting -----------------------------------------------------------
create table if not exists public.rate_limit_hits (
  bucket       text not null,
  subject      text not null,
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (bucket, subject, window_start)
);
alter table public.rate_limit_hits enable row level security;   -- no policies: clients denied
revoke all on public.rate_limit_hits from anon, authenticated;

-- Who is asking: the signed-in user, else Cloudflare's client IP (not
-- client-spoofable), else the first X-Forwarded-For hop, else one shared bucket.
create or replace function public.request_subject()
returns text language sql stable set search_path = public as $$
  select coalesce(
    'user:' || auth.uid()::text,
    'ip:' || nullif(btrim(nullif(current_setting('request.headers', true), '')::json->>'cf-connecting-ip'), ''),
    'ip:' || nullif(btrim(split_part(nullif(current_setting('request.headers', true), '')::json->>'x-forwarded-for', ',', 1)), ''),
    'anon');
$$;

-- Increments then raises when over. Raising rolls back this increment, but
-- the committed count is already at p_max, so every later call keeps raising
-- until the window rolls over.
create or replace function public.consume_rate_limit(p_bucket text, p_subject text, p_max integer, p_window interval)
returns void language plpgsql security definer set search_path = public as $$
declare
  secs double precision := extract(epoch from p_window);
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / secs) * secs);
  n integer;
begin
  insert into rate_limit_hits as r (bucket, subject, window_start, hits)
  values (p_bucket, p_subject, w, 1)
  on conflict (bucket, subject, window_start) do update set hits = r.hits + 1
  returning hits into n;
  if random() < 0.01 then
    delete from rate_limit_hits where window_start < now() - interval '2 days';
  end if;
  if n > p_max then
    raise exception 'rate limit exceeded, try again later';
  end if;
end $$;
revoke all on function public.request_subject() from public, anon, authenticated;
revoke all on function public.consume_rate_limit(text, text, integer, interval) from public, anon, authenticated;

-- submit_comp: same contract as migration 02, plus validation and a daily cap.
create or replace function public.submit_comp(entry jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  new_id   uuid;
  claimed  text;
  v_url    text := nullif(btrim(entry->>'listing_url'), '');
  v_id     text := nullif(btrim(entry->>'listing_id'), '');
  v_market text := nullif(btrim(entry->>'marketplace'), '');
  max_per_day constant integer := 30;
begin
  if auth.uid() is null then raise exception 'sign in to submit a sale'; end if;
  if not exists (select 1 from items where slug = entry->>'item_slug') then raise exception 'unknown item'; end if;
  claimed := coalesce(nullif(entry->>'claimed_type', ''), 'collector_report');
  if claimed not in ('collector_report', 'auction_result') then
    raise exception 'that evidence type has to be verified by a reviewer';
  end if;
  if v_url is not null and not is_safe_https_url(v_url) then
    raise exception 'the listing link must be a full https:// address';
  end if;
  if v_id is not null and v_id !~ '^[A-Za-z0-9._:/-]{1,64}$' then raise exception 'the listing id looks wrong'; end if;
  if char_length(coalesce(v_market, '')) > 60 then raise exception 'the marketplace name is too long'; end if;
  if char_length(coalesce(entry->>'condition', '')) > 30
     or char_length(coalesce(entry->>'completeness', '')) > 30 then
    raise exception 'condition or completeness is too long';
  end if;
  if exists (select 1 from comp_submissions
             where user_id = auth.uid() and item_slug = entry->>'item_slug' and status = 'pending') then
    raise exception 'you already have a pending submission for this item';
  end if;
  perform consume_rate_limit('submit_comp', 'user:' || auth.uid()::text, max_per_day, interval '1 day');

  insert into comp_submissions (user_id, item_slug, sold_price, sale_date, marketplace, listing_id,
                                listing_url, condition, completeness, claimed_type, note)
  values (auth.uid(),                                  -- never from the payload
          entry->>'item_slug', (entry->>'sold_price')::numeric,
          nullif(entry->>'sale_date', '')::date, v_market, v_id, v_url,
          nullif(entry->>'condition', ''), nullif(entry->>'completeness', ''),
          claimed, nullif(entry->>'note', ''))
  returning id into new_id;
  return new_id;
end $$;

create or replace function public.report_item(entry jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  new_id uuid;
  v_page text := nullif(entry->>'page_url', '');
  per_subject_per_hour constant integer := 10;
  anon_total_per_hour  constant integer := 300;
begin
  if not exists (select 1 from items where slug = entry->>'item_slug') then raise exception 'unknown item'; end if;
  perform consume_rate_limit('report_item', request_subject(), per_subject_per_hour, interval '1 hour');
  if auth.uid() is null then
    perform consume_rate_limit('report_item_anon', 'all', anon_total_per_hour, interval '1 hour');
  end if;
  if v_page is not null and not (is_site_path(v_page) or is_safe_https_url(v_page)) then
    v_page := null;
  end if;
  insert into item_reports (user_id, item_slug, reason, note, page_url)
  values (auth.uid(), entry->>'item_slug', entry->>'reason', left(nullif(entry->>'note', ''), 500), v_page)
  returning id into new_id;
  return new_id;
end $$;

-- Supabase's default privileges grant EXECUTE on new public functions to anon
-- directly (not through PUBLIC), so anon is revoked by name: submitting a sale
-- needs an account, and now the database refuses before the body even runs.
revoke all on function public.submit_comp(jsonb) from public, anon;
revoke all on function public.report_item(jsonb) from public;
grant execute on function public.submit_comp(jsonb) to authenticated;
grant execute on function public.report_item(jsonb) to anon, authenticated;

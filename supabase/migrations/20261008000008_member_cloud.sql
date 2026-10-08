-- Migration 08: Pro and Power member storage. Already applied to the live project.
-- collection_entries: each collection entry, keyed by a client id, synced
--   between devices (collection_sync).
-- value_history: one row per day of collection value, so history survives a
--   new phone or a cleared browser (hosted_history).
-- saved_reports: insurance schedules and cover letters kept on the account
--   (insurance_archive).
-- Reading your own rows always works, so nothing is lost if a membership
-- lapses; adding and changing them needs the entitlement.

create table if not exists public.collection_entries (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null check (id ~ '^[A-Za-z0-9_-]{6,64}$'),
  entry jsonb not null check (jsonb_typeof(entry) = 'object' and pg_column_size(entry) < 4000),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
alter table public.collection_entries enable row level security;
create policy collection_entries_read on public.collection_entries for select to authenticated
  using (user_id = (select auth.uid()));
create policy collection_entries_add on public.collection_entries for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.has_entitlement('collection_sync'))
    and (select count(*) from public.collection_entries c where c.user_id = (select auth.uid())) < 5000);
create policy collection_entries_change on public.collection_entries for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (select public.has_entitlement('collection_sync')));
create policy collection_entries_remove on public.collection_entries for delete to authenticated
  using (user_id = (select auth.uid()));
grant select, insert, update, delete on public.collection_entries to authenticated;

create table if not exists public.value_history (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day date not null,
  snap jsonb not null check (jsonb_typeof(snap) = 'object' and pg_column_size(snap) < 2000),
  flows jsonb not null default '[]'::jsonb check (jsonb_typeof(flows) = 'array' and pg_column_size(flows) < 20000),
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);
alter table public.value_history enable row level security;
create policy value_history_read on public.value_history for select to authenticated
  using (user_id = (select auth.uid()));
create policy value_history_add on public.value_history for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.has_entitlement('hosted_history')));
create policy value_history_change on public.value_history for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (select public.has_entitlement('hosted_history')));
grant select, insert, update on public.value_history to authenticated;

create table if not exists public.saved_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('insurance_schedule', 'cover_letter')),
  filename text not null check (char_length(filename) between 1 and 120),
  body text not null check (char_length(body) <= 400000),
  created_at timestamptz not null default now()
);
create index if not exists saved_reports_user_idx on public.saved_reports (user_id, created_at desc);
alter table public.saved_reports enable row level security;
create policy saved_reports_read on public.saved_reports for select to authenticated
  using (user_id = (select auth.uid()));
create policy saved_reports_add on public.saved_reports for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.has_entitlement('insurance_archive'))
    and (select count(*) from public.saved_reports r where r.user_id = (select auth.uid())) < 200);
create policy saved_reports_remove on public.saved_reports for delete to authenticated
  using (user_id = (select auth.uid()));
grant select, insert, delete on public.saved_reports to authenticated;
revoke all on public.collection_entries, public.value_history, public.saved_reports from anon;

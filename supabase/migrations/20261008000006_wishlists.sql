-- Migration 06: wishlists saved to member accounts.
-- Already applied to the live project; kept here so the schema can be rebuilt.
-- Each member reads and changes only their own list. Any future "Most Wanted"
-- report must count these in aggregate only, above a minimum number of members.

create table if not exists public.wishlists (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item_id text not null check (item_id ~ '^[a-z0-9-]{1,120}$'),
  created_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

alter table public.wishlists enable row level security;

drop policy if exists wishlists_read_own on public.wishlists;
create policy wishlists_read_own on public.wishlists for select
  using (user_id = (select auth.uid()));
-- 500 bears per member is far more than anyone hunts for at once, and stops a
-- script from filling the table.
drop policy if exists wishlists_add_own on public.wishlists;
create policy wishlists_add_own on public.wishlists for insert
  with check (user_id = (select auth.uid())
    and (select count(*) from public.wishlists w where w.user_id = (select auth.uid())) < 500);
drop policy if exists wishlists_remove_own on public.wishlists;
create policy wishlists_remove_own on public.wishlists for delete
  using (user_id = (select auth.uid()));

create index if not exists wishlists_item_idx on public.wishlists (item_id);

revoke all on public.wishlists from anon;
grant select, insert, delete on public.wishlists to authenticated;

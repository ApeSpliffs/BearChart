-- Likes on member showcases.
-- Any signed-in member can like another member's public showcase, once.
-- Members only ever see their own likes; everyone sees the total, which is
-- kept on the showcase by a trigger so the owner cannot change it.

alter table public.showcases add column if not exists like_count integer not null default 0;

create table if not exists public.showcase_likes (
  showcase_user uuid not null references public.showcases (user_id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (showcase_user, user_id)
);
create index if not exists showcase_likes_user_idx on public.showcase_likes (user_id);

alter table public.showcase_likes enable row level security;
revoke all on public.showcase_likes from anon;
revoke all on public.showcase_likes from authenticated;
grant select, insert, delete on public.showcase_likes to authenticated;

create policy showcase_likes_read on public.showcase_likes
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy showcase_likes_add on public.showcase_likes
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and showcase_user <> (select auth.uid())
    and exists (
      select 1 from public.showcases s
      where s.user_id = showcase_user and s.is_public and not s.hidden_by_admin
    )
  );

create policy showcase_likes_remove on public.showcase_likes
  for delete to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.showcase_like_tally()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update showcases set like_count = like_count + 1 where user_id = new.showcase_user;
    return new;
  end if;
  update showcases set like_count = greatest(like_count - 1, 0) where user_id = old.showcase_user;
  return old;
end $$;
revoke execute on function public.showcase_like_tally() from public, anon, authenticated;

create trigger showcase_likes_tally
  after insert or delete on public.showcase_likes
  for each row execute function public.showcase_like_tally();

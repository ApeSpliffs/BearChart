-- Changes made in the production dashboard that no migration recorded,
-- found with `supabase db diff --linked` on 2026-10-11. Idempotent: on
-- production it only adds the missing search index; on a fresh database it
-- recreates what production already has.

-- Release tracking columns (upcoming / at-retail items).
alter table public.items add column if not exists announced_msrp numeric(10,2);
alter table public.items add column if not exists announcement_source text;
alter table public.items add column if not exists expected_release text;
alter table public.items add column if not exists needs_review boolean not null default false;
alter table public.items add column if not exists release_status text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'items_release_status_check') then
    alter table public.items add constraint items_release_status_check
      check (release_status = any (array['upcoming'::text, 'current'::text]));
  end if;
end $$;

-- Defined in 000001 but missing in production.
create index if not exists items_name_idx
  on public.items using gin (to_tsvector('english'::regconfig, canonical_name));

-- Browsing showcases needs an account: public showcases are visible to
-- signed-in members only (showcase.js gates the page the same way).
drop policy if exists showcases_read on public.showcases;
create policy showcases_read on public.showcases for select
  using ((is_public and not hidden_by_admin and (select auth.uid()) is not null)
         or user_id = (select auth.uid())
         or (select public.is_admin()));
revoke select on table public.showcases from anon;

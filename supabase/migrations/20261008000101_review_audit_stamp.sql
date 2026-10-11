-- ===========================================================================
-- Security L4: who reviewed what is stamped by the database.
--
-- The admin page sends only the new status. This trigger records the reviewer
-- (auth.uid()) and the time whenever the status changes, and otherwise keeps
-- the stored values: neither field can be written or forged from a client.
-- ===========================================================================

create or replace function public.stamp_review()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status is distinct from old.status then
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  else
    new.reviewed_by := old.reviewed_by;   -- not hand-editable
    new.reviewed_at := old.reviewed_at;
  end if;
  return new;
end $$;
revoke all on function public.stamp_review() from public, anon, authenticated;

drop trigger if exists comp_submissions_stamp_review on public.comp_submissions;
create trigger comp_submissions_stamp_review before update on public.comp_submissions
  for each row execute function public.stamp_review();
drop trigger if exists item_reports_stamp_review on public.item_reports;
create trigger item_reports_stamp_review before update on public.item_reports
  for each row execute function public.stamp_review();
drop trigger if exists photo_submissions_stamp_review on public.photo_submissions;
create trigger photo_submissions_stamp_review before update on public.photo_submissions
  for each row execute function public.stamp_review();

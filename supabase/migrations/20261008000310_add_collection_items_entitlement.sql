-- Production's add_collection_items also checks the collection_sync
-- entitlement in its body (a dashboard edit; found by `db diff --linked`).
-- Recorded here so a fresh database matches production. RLS (000102) gates
-- the same writes; this refuses earlier with a clear message.
create or replace function public.add_collection_items(entries jsonb)
returns integer
language plpgsql
set search_path = public
as $$
declare added integer := 0;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if not has_entitlement('collection_sync') then
    raise exception 'collection sync requires a Pro membership';
  end if;

  insert into collections (user_id, item_id, condition, completeness, qty)
  select auth.uid(), i.id,
         nullif(e->>'condition',''), nullif(e->>'completeness',''),
         greatest(coalesce((e->>'qty')::int, 1), 1)
  from jsonb_array_elements(entries) as e
  join items i on i.slug = e->>'item_id_slug';

  get diagnostics added = row_count;
  return added;
end $$;

revoke all on function public.add_collection_items(jsonb) from public, anon;
grant execute on function public.add_collection_items(jsonb) to authenticated;

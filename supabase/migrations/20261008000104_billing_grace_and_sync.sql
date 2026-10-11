-- M3: billing correctness.
--  * A failed renewal (past_due) keeps the paid tier for a named grace period,
--    counted from when the subscription FIRST went past_due, then reads free.
--  * The webhook writes through one ordered, atomic function: a slower handler
--    that read older Stripe state cannot overwrite a newer sync.
-- Cancellation still reads free as soon as the period ends (no grace).

alter table public.subscriptions
  add column if not exists past_due_since timestamptz,
  add column if not exists stripe_synced_at timestamptz;
update public.subscriptions set past_due_since = updated_at
  where status = 'past_due' and past_due_since is null;

-- The ONE place the grace period is defined.
create or replace function public.past_due_grace()
returns interval language sql immutable set search_path = public as $$ select interval '7 days' $$;

-- past_due skips the period-end check on purpose: when a renewal fails, Stripe
-- has already advanced current_period_end, so it no longer says anything about
-- payment. past_due_since is the anchor instead.
create or replace function public.current_tier()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((
    select s.tier from subscriptions s
    where s.user_id = auth.uid()
      and (
            (s.status in ('active','trialing')
             and (s.current_period_end is null or s.current_period_end > now()))
         or (s.status = 'past_due'
             and s.past_due_since is not null
             and s.past_due_since > now() - public.past_due_grace())
      )
  ), 'free');
$$;

-- Atomic, ordered write used only by the webhook (service role).
-- Returns false when the stored row was synced from newer Stripe state.
create or replace function public.apply_subscription_state(
  p_user_id uuid, p_tier text, p_status text, p_customer_id text, p_subscription_id text,
  p_current_period_end timestamptz, p_synced_at timestamptz)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  insert into subscriptions as s (user_id, tier, status, provider, provider_customer_id,
      provider_subscription_id, current_period_end, past_due_since, stripe_synced_at, updated_at)
  values (p_user_id, p_tier, p_status, 'stripe', p_customer_id, p_subscription_id,
      p_current_period_end, case when p_status = 'past_due' then now() end, p_synced_at, now())
  on conflict (user_id) do update set
      tier = excluded.tier,
      status = excluded.status,
      provider = excluded.provider,
      provider_customer_id = excluded.provider_customer_id,
      provider_subscription_id = excluded.provider_subscription_id,
      current_period_end = excluded.current_period_end,
      past_due_since = case
        when excluded.status <> 'past_due' then null
        when s.status = 'past_due' and s.past_due_since is not null then s.past_due_since
        else now() end,
      stripe_synced_at = excluded.stripe_synced_at,
      updated_at = now()
    where s.stripe_synced_at is null or excluded.stripe_synced_at >= s.stripe_synced_at;
  return found;
end $$;
revoke all on function public.apply_subscription_state(uuid, text, text, text, text, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.apply_subscription_state(uuid, text, text, text, text, timestamptz, timestamptz)
  to service_role;

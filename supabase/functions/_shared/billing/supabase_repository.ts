/**
 * Supabase adapters (Deno only).
 *
 * The repository and event log use the SERVICE ROLE client: they write tables
 * no browser may write. That key never leaves the server.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import type {
  EventLog,
  MembershipReader,
  MembershipRepository,
} from "./ports.ts";

export function createMembershipRepository(
  admin: SupabaseClient,
): MembershipRepository {
  return {
    async userIdForCustomer(customerId) {
      const { data, error } = await admin
        .from("subscriptions")
        .select("user_id")
        .eq("provider_customer_id", customerId)
        .maybeSingle();
      if (error) throw new Error(`customer lookup failed: ${error.message}`);
      return data?.user_id ?? null;
    },

    async applyState(row) {
      // Atomic and ordered: the SQL refuses a row older than the stored one.
      const { data, error } = await admin.rpc("apply_subscription_state", {
        p_user_id: row.userId,
        p_tier: row.tier,
        p_status: row.status,
        p_customer_id: row.customerId,
        p_subscription_id: row.subscriptionId,
        p_current_period_end: row.currentPeriodEnd,
        p_synced_at: row.syncedAt,
      });
      if (error) throw new Error(`apply_subscription_state failed: ${error.message}`);
      return data === true;
    },
  };
}

/** Webhook idempotency on public.stripe_events (RLS on, no policies). */
export function createEventLog(admin: SupabaseClient): EventLog {
  return {
    async claim(id, type) {
      const { error } = await admin.from("stripe_events").insert({ id, type });
      if (!error) return "claimed";
      if (error.code === "23505") return "duplicate";
      throw new Error(`event log write failed: ${error.message}`);
    },
    async release(id) {
      // Roll the claim back so Stripe's retry can do real work.
      const { error } = await admin.from("stripe_events").delete().eq("id", id);
      if (error) throw new Error(`event release failed: ${error.message}`);
    },
  };
}

/**
 * The caller's own membership, read with THEIR client under RLS: a caller
 * cannot reach somebody else's customer id by naming it.
 */
export function createUserMembershipReader(
  client: SupabaseClient,
): MembershipReader {
  return {
    async forUser(userId) {
      const { data, error } = await client
        .from("subscriptions")
        .select("provider_customer_id, provider_subscription_id, status")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw new Error(`membership read failed: ${error.message}`);
      if (!data) return null;
      return {
        customerId: data.provider_customer_id ?? null,
        subscriptionId: data.provider_subscription_id ?? null,
        status: data.status ?? null,
      };
    },
  };
}

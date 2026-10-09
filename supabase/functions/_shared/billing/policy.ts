/**
 * Pure billing rules. No I/O, no Deno, no Stripe SDK.
 *
 * The tier is always derived from the price id Stripe reports, matched
 * against price ids from the environment - never from a request body. A
 * client that could name its own tier would not need to pay.
 */

import type {
  MemberStatus,
  MembershipRow,
  MembershipSummary,
  PriceTable,
  SubscriptionView,
  Tier,
} from "./types.ts";

/** Owner-tunable policy: a disputed membership charge revokes the membership. */
export const REVOKE_ON_DISPUTE = true;
/** Owner-tunable policy: a fully refunded membership charge revokes it. */
export const REVOKE_ON_FULL_REFUND = true;

export const LIVE_STATUSES: readonly string[] = ["active", "trialing", "past_due"];

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(s: unknown): s is string {
  return typeof s === "string" && UUID.test(s);
}

/** Price id -> paid tier. Null/empty input, or an unset env price, never match. */
export function tierForPrice(
  priceId: string | null | undefined,
  prices: PriceTable,
): "pro" | "power" | null {
  if (!priceId) return null;
  if (prices.power && priceId === prices.power) return "power";
  if (prices.pro && priceId === prices.pro) return "pro";
  return null;
}

/** Plan name (the only thing a browser may send) -> price id. */
export function priceForPlan(plan: string, prices: PriceTable): string | null {
  if (plan === "pro") return prices.pro || null;
  if (plan === "power") return prices.power || null;
  return null;
}

/** Stripe's status vocabulary onto ours. Anything unknown is not paid. */
export function mapStatus(s: string): MemberStatus {
  switch (s) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
    case "unpaid":
      return "past_due";
    default:
      return "canceled";
  }
}

function liveRank(status: string): number {
  if (status === "active" || status === "trialing") return 3;
  if (status === "past_due") return 2;
  if (status === "unpaid") return 1;
  return 0;
}

function tierRank(t: Tier | null): number {
  return t === "power" ? 2 : t === "pro" ? 1 : 0;
}

/**
 * The one subscription that decides the member's tier: among subscriptions
 * on our prices, the most alive, then the highest tier, then the newest.
 */
export function pickEffectiveSubscription(
  subs: readonly SubscriptionView[],
  prices: PriceTable,
): SubscriptionView | null {
  const ours = subs.filter((s) => tierForPrice(s.priceId, prices) !== null);
  ours.sort((a, b) =>
    liveRank(b.status) - liveRank(a.status) ||
    tierRank(tierForPrice(b.priceId, prices)) -
      tierRank(tierForPrice(a.priceId, prices)) ||
    b.created - a.created
  );
  return ours[0] ?? null;
}

/** The subscriptions row that reflects `sub` (or no subscription at all). */
export function membershipRowFor(
  userId: string,
  customerId: string,
  sub: SubscriptionView | null,
  prices: PriceTable,
  syncedAt: string,
): MembershipRow {
  if (!sub) {
    return {
      userId,
      tier: "free",
      status: "canceled",
      customerId,
      subscriptionId: null,
      currentPeriodEnd: null,
      syncedAt,
    };
  }
  const status = mapStatus(sub.status);
  const tier: Tier = status === "canceled"
    ? "free"
    : (tierForPrice(sub.priceId, prices) ?? "free");
  return {
    userId,
    tier,
    status,
    customerId,
    subscriptionId: sub.id,
    currentPeriodEnd: sub.currentPeriodEnd == null
      ? null
      : new Date(sub.currentPeriodEnd * 1000).toISOString(),
    syncedAt,
  };
}

/** A membership that should be managed in the portal, not bought again. */
export function hasLiveMembership(
  m: MembershipSummary | null | undefined,
): boolean {
  return !!m?.customerId && !!m.subscriptionId &&
    LIVE_STATUSES.includes(m.status ?? "");
}

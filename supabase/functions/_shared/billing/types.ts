/**
 * Billing vocabulary shared by every layer. Types only: nothing here runs.
 *
 * The views (SubscriptionView, ChargeView, InvoiceView) are the slices of
 * Stripe objects the domain needs, mapped by the gateway adapter so the domain
 * never depends on the Stripe SDK.
 */

export type Tier = "free" | "pro" | "power";
export type MemberStatus = "active" | "trialing" | "past_due" | "canceled";

/** Price ids from the environment. null = not configured (never matches). */
export interface PriceTable {
  pro: string | null;
  power: string | null;
}

export interface SubscriptionView {
  id: string;
  customerId: string;
  status: string;
  priceId: string | null;
  currentPeriodEnd: number | null;
  created: number;
  metadataUserId: string | null;
}

export interface ChargeView {
  id: string;
  customerId: string | null;
  invoiceId: string | null;
  refunded: boolean;
}

export interface InvoiceView {
  id: string;
  customerId: string | null;
  subscriptionId: string | null;
}

// deno-lint-ignore no-explicit-any
export type StripeObject = Record<string, any>;

/** A verified Stripe event, reduced to what routing needs. */
export interface BillingEvent {
  id: string;
  type: string;
  created: number;
  object: StripeObject;
}

/** One row of public.subscriptions, as written by apply_subscription_state(). */
export interface MembershipRow {
  userId: string;
  tier: Tier;
  status: MemberStatus;
  customerId: string;
  subscriptionId: string | null;
  currentPeriodEnd: string | null;
  syncedAt: string;
}

/** What the caller's own subscriptions row says (read under their RLS). */
export interface MembershipSummary {
  customerId: string | null;
  subscriptionId: string | null;
  status: string | null;
}

export type HandleResult = {
  status: "processed" | "duplicate" | "ignored";
  reason?: string;
};

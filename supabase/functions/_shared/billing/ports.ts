/**
 * Ports: what the billing domain needs from the outside world. Adapters
 * (stripe_gateway.ts, supabase_repository.ts) implement them for Deno; tests
 * implement them with in-memory fakes.
 */

import type {
  ChargeView,
  InvoiceView,
  MembershipRow,
  MembershipSummary,
  SubscriptionView,
} from "./types.ts";

export interface SubscriptionGateway {
  /** Every subscription of the customer (status "all"). */
  listSubscriptions(customerId: string): Promise<SubscriptionView[]>;
  retrieveSubscription(id: string): Promise<SubscriptionView>;
  retrieveCharge(id: string): Promise<ChargeView>;
  retrieveInvoice(id: string): Promise<InvoiceView>;
  /** Immediate cancellation, no proration. */
  cancelSubscription(id: string): Promise<void>;
}

export interface CheckoutGateway {
  createCheckoutSession(i: {
    priceId: string;
    userId: string;
    email: string | null;
    customerId: string | null;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string }>;
  createPortalSession(
    i: { customerId: string; returnUrl: string },
  ): Promise<{ url: string }>;
}

export interface MembershipRepository {
  userIdForCustomer(customerId: string): Promise<string | null>;
  /** false = a newer sync already landed; this one was skipped as stale. */
  applyState(row: MembershipRow): Promise<boolean>;
}

export interface EventLog {
  claim(id: string, type: string): Promise<"claimed" | "duplicate">;
  release(id: string): Promise<void>;
}

/** Reads the caller's own membership summary (under their RLS). */
export interface MembershipReader {
  forUser(userId: string): Promise<MembershipSummary | null>;
}

export interface Clock {
  now(): Date;
}

export interface Logger {
  info(m: string, meta?: unknown): void;
  warn(m: string, meta?: unknown): void;
  error(m: string, meta?: unknown): void;
}

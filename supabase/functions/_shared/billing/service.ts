/**
 * Webhook application service: routes a verified Stripe event to a sync of
 * the customer's membership.
 *
 * Every event re-reads the customer's FULL subscription list from Stripe and
 * writes the effective state, so the row converges on Stripe's current truth
 * whatever order events arrive in. apply_subscription_state() additionally
 * rejects a slower handler that read older state (its stripe_synced_at guard).
 *
 * The user is never taken from the request alone: the recorded customer ->
 * user link wins, then the client_reference_id / subscription metadata that
 * create-checkout set server-side from the caller's verified JWT.
 */

import type {
  Clock,
  EventLog,
  Logger,
  MembershipRepository,
  SubscriptionGateway,
} from "./ports.ts";
import {
  isUuid,
  LIVE_STATUSES,
  membershipRowFor,
  pickEffectiveSubscription,
  REVOKE_ON_DISPUTE,
  REVOKE_ON_FULL_REFUND,
  tierForPrice,
} from "./policy.ts";
import type {
  BillingEvent,
  ChargeView,
  HandleResult,
  PriceTable,
} from "./types.ts";

export interface BillingServiceDeps {
  gateway: SubscriptionGateway;
  repo: MembershipRepository;
  events: EventLog;
  prices: PriceTable;
  clock: Clock;
  log: Logger;
}

export interface BillingService {
  handle(e: BillingEvent): Promise<HandleResult>;
}

const ignored = (reason: string): HandleResult => ({
  status: "ignored",
  reason,
});

/** Stripe fields may be an id or an expanded object. */
function idOf(v: unknown): string | null {
  if (typeof v === "string") return v || null;
  if (v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string") {
    return (v as { id: string }).id;
  }
  return null;
}

export function createBillingService(deps: BillingServiceDeps): BillingService {
  const { gateway, repo, events, prices, clock, log } = deps;

  async function sync(
    customerId: string,
    hint?: string | null,
  ): Promise<HandleResult> {
    // Captured BEFORE the read: a handler that read older state must lose.
    const syncedAt = clock.now();
    const subs = await gateway.listSubscriptions(customerId);
    const ours = subs.filter((s) => tierForPrice(s.priceId, prices) !== null);
    const known = await repo.userIdForCustomer(customerId);

    if (known && hint && hint !== known) {
      log.warn("customer/user mismatch; keeping recorded user", {
        customerId,
      });
    }
    const userId = known ?? (isUuid(hint) ? hint : null) ??
      ours.map((s) => s.metadataUserId).find(isUuid) ?? null;

    if (!userId) {
      if (ours.length === 0) return ignored("not a BearChart customer");
      // Ours, but the link has not landed yet: fail so Stripe retries rather
      // than silently dropping somebody's membership.
      throw new Error("no user for stripe customer");
    }

    const live = ours.filter((s) => LIVE_STATUSES.includes(s.status));
    if (live.length > 1) {
      log.warn("duplicate live subscriptions", {
        customerId,
        ids: live.map((s) => s.id),
      });
    }

    const row = membershipRowFor(
      userId,
      customerId,
      pickEffectiveSubscription(ours, prices),
      prices,
      syncedAt.toISOString(),
    );
    const applied = await repo.applyState(row);
    if (!applied) log.info("stale sync skipped", { customerId });
    return { status: "processed" };
  }

  async function revokeForCharge(c: ChargeView): Promise<HandleResult> {
    // The Stripe account may be shared with the store: only a charge that
    // paid a membership invoice is ours to act on.
    if (!c.invoiceId) return ignored("not a membership charge");
    const invoice = await gateway.retrieveInvoice(c.invoiceId);
    if (!invoice.subscriptionId) return ignored("not a membership charge");
    const sub = await gateway.retrieveSubscription(invoice.subscriptionId);
    if (tierForPrice(sub.priceId, prices) === null) {
      return ignored("not a membership charge");
    }
    if (sub.status !== "canceled") await gateway.cancelSubscription(sub.id);
    return sync(sub.customerId, sub.metadataUserId);
  }

  async function route(e: BillingEvent): Promise<HandleResult> {
    const o = e.object;
    switch (e.type) {
      case "checkout.session.completed": {
        const customer = idOf(o.customer);
        if (o.mode !== "subscription" || !customer) {
          return ignored("not a subscription checkout");
        }
        // Set server-side by create-checkout from the caller's verified JWT.
        if (!isUuid(o.client_reference_id)) {
          throw new Error("checkout session has no valid client_reference_id");
        }
        return sync(customer, o.client_reference_id);
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
      case "customer.subscription.paused":
      case "customer.subscription.resumed": {
        const customer = idOf(o.customer);
        if (!customer) return ignored("no customer");
        return sync(customer, o.metadata?.bearchart_user_id ?? null);
      }
      case "invoice.paid":
      case "invoice.payment_succeeded":
      case "invoice.payment_failed": {
        const customer = idOf(o.customer);
        if (!idOf(o.subscription) || !customer) {
          return ignored("not a subscription invoice");
        }
        return sync(customer);
      }
      case "charge.refunded": {
        if (!REVOKE_ON_FULL_REFUND || !o.refunded) {
          return ignored("partial refund");
        }
        return revokeForCharge({
          id: o.id,
          customerId: idOf(o.customer),
          invoiceId: idOf(o.invoice),
          refunded: !!o.refunded,
        });
      }
      case "charge.dispute.created": {
        if (!REVOKE_ON_DISPUTE) return ignored("disputes do not revoke");
        const chargeId = idOf(o.charge);
        if (!chargeId) return ignored("dispute without a charge");
        return revokeForCharge(await gateway.retrieveCharge(chargeId));
      }
      default:
        // Acknowledged and left claimed, so Stripe does not retry forever.
        return ignored("unhandled type");
    }
  }

  return {
    async handle(e: BillingEvent): Promise<HandleResult> {
      // Stripe delivers at least once. Claiming the id first makes replays
      // harmless; releasing it on failure lets the retry do real work.
      if ((await events.claim(e.id, e.type)) === "duplicate") {
        return { status: "duplicate" };
      }
      try {
        return await route(e);
      } catch (err) {
        await events.release(e.id);
        throw err;
      }
    },
  };
}

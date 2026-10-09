/**
 * Starting a membership. The caller comes from a verified JWT, never the body.
 * The browser names a plan, never a price: a caller who could pass a price id
 * could pass a $0 one and receive Power.
 *
 * A member who already has a live subscription is sent to the billing portal
 * to change plan instead of being sold a second, concurrent subscription.
 */

import type { CheckoutGateway } from "./ports.ts";
import { hasLiveMembership, priceForPlan } from "./policy.ts";
import type { MembershipSummary, PriceTable } from "./types.ts";

export interface Caller {
  id: string;
  email: string | null;
}

export type CheckoutResult =
  | { kind: "unknown_plan" }
  | { kind: "portal"; url: string }
  | { kind: "checkout"; url: string };

export interface CheckoutServiceDeps {
  gateway: CheckoutGateway;
  prices: PriceTable;
  siteUrl: string;
}

export function createCheckoutService(deps: CheckoutServiceDeps) {
  const { gateway, prices, siteUrl } = deps;
  return {
    async start(
      caller: Caller,
      plan: string,
      membership: MembershipSummary | null,
    ): Promise<CheckoutResult> {
      const priceId = priceForPlan(plan, prices);
      if (!priceId) return { kind: "unknown_plan" };

      if (hasLiveMembership(membership)) {
        const { url } = await gateway.createPortalSession({
          customerId: membership!.customerId!,
          returnUrl: `${siteUrl}/account.html`,
        });
        return { kind: "portal", url };
      }

      // Reuse the Stripe customer if this user has bought before, so one
      // person does not accumulate duplicate customers.
      const customerId = membership?.customerId ?? null;
      const { url } = await gateway.createCheckoutSession({
        priceId,
        userId: caller.id,
        email: customerId ? null : caller.email,
        customerId,
        successUrl: `${siteUrl}/account.html?checkout=done`,
        cancelUrl: `${siteUrl}/plans.html?checkout=cancelled`,
      });
      return { kind: "checkout", url };
    },
  };
}

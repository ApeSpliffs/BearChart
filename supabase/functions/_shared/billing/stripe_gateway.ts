/**
 * Stripe adapter (Deno only). Maps SDK objects onto the domain's views so
 * nothing outside this file depends on the Stripe SDK.
 */

import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import type { CheckoutGateway, SubscriptionGateway } from "./ports.ts";
import type {
  BillingEvent,
  ChargeView,
  InvoiceView,
  SubscriptionView,
} from "./types.ts";

export interface StripeGatewayOptions {
  secretKey: string;
  /** Only the webhook needs it. */
  webhookSecret?: string;
}

export type StripeGateway = SubscriptionGateway & CheckoutGateway & {
  verifyEvent(body: string, signature: string): Promise<BillingEvent>;
};

const idOf = (v: unknown): string | null =>
  typeof v === "string"
    ? v
    : v && typeof v === "object"
    ? ((v as { id?: string }).id ?? null)
    : null;

function subscriptionView(s: Stripe.Subscription): SubscriptionView {
  const meta = s.metadata?.bearchart_user_id;
  return {
    id: s.id,
    customerId: idOf(s.customer) ?? "",
    status: s.status,
    priceId: s.items?.data?.[0]?.price?.id ?? null,
    currentPeriodEnd: s.current_period_end ?? null,
    created: s.created,
    metadataUserId: typeof meta === "string" && meta ? meta : null,
  };
}

export function createStripeGateway(opts: StripeGatewayOptions): StripeGateway {
  const stripe = new Stripe(opts.secretKey, {
    apiVersion: "2024-06-20",
    httpClient: Stripe.createFetchHttpClient(),
  });
  // Deno's crypto is async-only, so the synchronous constructEvent silently
  // fails here. This provider plus constructEventAsync is what works.
  const cryptoProvider = Stripe.createSubtleCryptoProvider();

  return {
    async verifyEvent(body, signature) {
      if (!opts.webhookSecret) throw new Error("webhook secret not configured");
      const e = await stripe.webhooks.constructEventAsync(
        body,
        signature,
        opts.webhookSecret,
        undefined,
        cryptoProvider,
      );
      return {
        id: e.id,
        type: e.type,
        created: e.created,
        object: e.data.object as unknown as Record<string, unknown>,
      };
    },

    async listSubscriptions(customerId) {
      const out: SubscriptionView[] = [];
      for await (
        const s of stripe.subscriptions.list({
          customer: customerId,
          status: "all",
          limit: 100,
        })
      ) out.push(subscriptionView(s));
      return out;
    },

    async retrieveSubscription(id) {
      return subscriptionView(await stripe.subscriptions.retrieve(id));
    },

    async retrieveCharge(id): Promise<ChargeView> {
      const c = await stripe.charges.retrieve(id);
      return {
        id: c.id,
        customerId: idOf(c.customer),
        invoiceId: idOf(c.invoice),
        refunded: c.refunded,
      };
    },

    async retrieveInvoice(id): Promise<InvoiceView> {
      const i = await stripe.invoices.retrieve(id);
      return {
        id: i.id,
        customerId: idOf(i.customer),
        subscriptionId: idOf(i.subscription),
      };
    },

    async cancelSubscription(id) {
      await stripe.subscriptions.cancel(id, { prorate: false });
    },

    async createCheckoutSession(i) {
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [{ price: i.priceId, quantity: 1 }],
        // The link the webhook trusts, set from the caller's verified JWT.
        client_reference_id: i.userId,
        customer: i.customerId ?? undefined,
        customer_email: i.customerId ? undefined : (i.email ?? undefined),
        allow_promotion_codes: true,
        success_url: i.successUrl,
        cancel_url: i.cancelUrl,
        subscription_data: { metadata: { bearchart_user_id: i.userId } },
      });
      if (!session.url) throw new Error("checkout session has no url");
      return { url: session.url };
    },

    async createPortalSession(i) {
      const session = await stripe.billingPortal.sessions.create({
        customer: i.customerId,
        return_url: i.returnUrl,
      });
      return { url: session.url };
    },
  };
}

/*
 * Stripe webhook -> subscriptions table.
 *
 * This is the only thing in BearChart that may grant a paid tier. Everything
 * else - the plans page, entitlements.js, the buttons - is presentation.
 *
 * TWO RULES, AND THE WHOLE FUNCTION IS BUILT AROUND THEM
 * =====================================================
 * 1. Verify the signature before reading the body. An unverified webhook is an
 *    open endpoint that hands out memberships: anyone who finds the URL can POST
 *    {"type":"customer.subscription.updated", ...} and grant themselves Power.
 *    The signature is what proves Stripe sent it.
 *
 * 2. Never take the user id or the tier from the request. Both are resolved
 *    server-side - the user from the Stripe customer we recorded at checkout,
 *    the tier from the price id Stripe reports. A client that could name its own
 *    tier does not need to pay.
 *
 * Deploy:
 *   supabase secrets set STRIPE_SECRET_KEY=sk_live_...
 *   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
 *   supabase secrets set PRICE_PRO=price_...  PRICE_POWER=price_...
 *   supabase functions deploy stripe-webhook --no-verify-jwt
 *
 * --no-verify-jwt is correct and necessary here: Stripe is not a signed-in user
 * and carries no Supabase JWT. The Stripe signature is this endpoint's auth, and
 * it is checked below before anything else happens.
 */

import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { withObservability } from "../_shared/observability.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-06-20",
  httpClient: Stripe.createFetchHttpClient(),
});

// Deno's crypto is async-only, so the synchronous constructEvent silently fails
// here. This provider plus constructEventAsync is the combination that works.
const cryptoProvider = Stripe.createSubtleCryptoProvider();

// Service role: this function must write a table no client may write. The key
// never leaves the server and must never appear in anything a browser loads.
const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

/** Price id -> tier. Resolved from env, never from the request body. */
function tierForPrice(priceId: string | null | undefined): string | null {
  if (!priceId) return null;
  if (priceId === Deno.env.get("PRICE_POWER")) return "power";
  if (priceId === Deno.env.get("PRICE_PRO")) return "pro";
  return null;
}

/** Stripe's status vocabulary mapped onto ours. Anything unknown is not paid. */
function mapStatus(s: string): string {
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

async function userIdForCustomer(customerId: string): Promise<string | null> {
  const { data } = await admin
    .from("subscriptions")
    .select("user_id")
    .eq("provider_customer_id", customerId)
    .maybeSingle();
  return data?.user_id ?? null;
}

async function upsert(row: Record<string, unknown>) {
  const { error } = await admin
    .from("subscriptions")
    .upsert(row, { onConflict: "user_id" });
  if (error) throw new Error(`subscriptions upsert failed: ${error.message}`);
}

Deno.serve(withObservability("stripe-webhook", async (req) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("missing signature", { status: 400 });

  // The raw body is required: any reserialisation changes the bytes the
  // signature was computed over and verification fails.
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      Deno.env.get("STRIPE_WEBHOOK_SECRET")!,
      undefined,
      cryptoProvider,
    );
  } catch (err) {
    // Do not log the body here - an unverified payload is attacker-controlled.
    console.error("signature verification failed:", (err as Error).message);
    return new Response("invalid signature", { status: 400 });
  }

  // Stripe retries on any non-2xx, and delivers at least once rather than
  // exactly once. Recording the id first makes replays harmless.
  const { error: seenError } = await admin
    .from("stripe_events")
    .insert({ id: event.id, type: event.type });
  if (seenError) {
    if (seenError.code === "23505") {
      return new Response(JSON.stringify({ ok: true, duplicate: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    console.error("event log write failed:", seenError.message);
    return new Response("event log unavailable", { status: 500 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;

        // client_reference_id was set server-side at checkout from the caller's
        // verified JWT. It is the only link between a Stripe customer and a
        // BearChart user, and it was never client-supplied.
        const userId = session.client_reference_id;
        if (!userId) throw new Error("checkout session has no client_reference_id");
        if (!session.subscription) break; // one-off payment, not a membership

        const sub = await stripe.subscriptions.retrieve(
          session.subscription as string,
        );
        const tier = tierForPrice(sub.items.data[0]?.price?.id);
        if (!tier) throw new Error(`unrecognised price on ${sub.id}`);

        await upsert({
          user_id: userId,
          tier,
          status: mapStatus(sub.status),
          provider: "stripe",
          provider_customer_id: sub.customer as string,
          provider_subscription_id: sub.id,
          current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        });
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = await userIdForCustomer(sub.customer as string);
        if (!userId) {
          // The checkout event may not have landed yet. Fail loudly so Stripe
          // retries rather than silently dropping somebody's membership.
          throw new Error(`no user for stripe customer ${sub.customer}`);
        }

        const cancelled = event.type === "customer.subscription.deleted";
        const tier = cancelled ? "free" : tierForPrice(sub.items.data[0]?.price?.id);

        await upsert({
          user_id: userId,
          tier: tier ?? "free",
          status: cancelled ? "canceled" : mapStatus(sub.status),
          provider: "stripe",
          provider_customer_id: sub.customer as string,
          provider_subscription_id: sub.id,
          current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        });
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const userId = await userIdForCustomer(invoice.customer as string);
        if (!userId) break;
        // past_due, not canceled. Stripe has its own retry schedule, and cutting
        // someone off over one bounced card is a decision to make deliberately.
        const { error } = await admin
          .from("subscriptions")
          .update({ status: "past_due", updated_at: new Date().toISOString() })
          .eq("user_id", userId);
        if (error) throw new Error(error.message);
        break;
      }

      default:
        break; // unhandled types are acknowledged, not retried forever
    }
  } catch (err) {
    // Roll the idempotency record back so Stripe's retry can do real work.
    await admin.from("stripe_events").delete().eq("id", event.id);
    console.error(`handling ${event.type} failed:`, (err as Error).message);
    return new Response("handler error", { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}));

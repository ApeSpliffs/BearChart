/*
 * Stripe webhook -> subscriptions table. Wiring only; the logic lives in
 * _shared/billing/ (webhook_handler -> service -> policy, behind ports).
 *
 * This is the only thing in Plush Price Guide that may grant a paid tier. Two rules:
 *  1. Verify the signature before reading the body (webhook_handler.ts).
 *  2. Never take the user id or the tier from the request (service.ts,
 *     policy.ts): the user comes from the recorded customer, the tier from the
 *     price id Stripe reports.
 *
 * Deploy:
 *   supabase secrets set STRIPE_SECRET_KEY=sk_live_... STRIPE_WEBHOOK_SECRET=whsec_...
 *   supabase secrets set PRICE_PRO=price_... PRICE_POWER=price_... BEARCHART_ENV=production
 *   supabase functions deploy stripe-webhook --no-verify-jwt
 *
 * --no-verify-jwt is correct: Stripe carries no Supabase JWT. The Stripe
 * signature is this endpoint's auth.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { priceTableFromEnv, requireEnv, stripeSecretKey } from "../_shared/env.ts";
import { withObservability } from "../_shared/observability.ts";
import { createStripeGateway } from "../_shared/billing/stripe_gateway.ts";
import {
  createEventLog,
  createMembershipRepository,
} from "../_shared/billing/supabase_repository.ts";
import { createBillingService } from "../_shared/billing/service.ts";
import { createWebhookHandler } from "../_shared/billing/webhook_handler.ts";

type Handler = (req: Request) => Promise<Response>;
let handler: Handler | null = null;

/** Built on the first request so env is read lazily and checked once. */
function realHandler(): Handler {
  if (handler) return handler;
  const get = (k: string) => Deno.env.get(k);
  const gateway = createStripeGateway({
    secretKey: stripeSecretKey(get), // live/test key guard
    webhookSecret: requireEnv(get, "STRIPE_WEBHOOK_SECRET"),
  });
  const admin = createClient(
    requireEnv(get, "SUPABASE_URL"),
    requireEnv(get, "SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );
  const service = createBillingService({
    gateway,
    repo: createMembershipRepository(admin),
    events: createEventLog(admin),
    prices: priceTableFromEnv(get),
    clock: { now: () => new Date() },
    log: console,
  });
  handler = createWebhookHandler({
    verify: (body, sig) => gateway.verifyEvent(body, sig),
    service,
    log: console,
  });
  return handler;
}

Deno.serve(withObservability("stripe-webhook", (req) => realHandler()(req)));

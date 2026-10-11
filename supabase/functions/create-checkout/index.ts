/*
 * Start a Stripe Checkout session for the signed-in user. Wiring only:
 * resolveCaller -> membership reader -> checkout service -> JSON.
 *
 * The user comes from the Supabase JWT, never the body; the browser names a
 * plan, never a price. A member with a live subscription gets the billing
 * portal instead of a second subscription ({ url, portal: true }).
 *
 * Deploy: supabase functions deploy create-checkout   (JWT verification ON)
 */

import { resolveCaller } from "../_shared/auth.ts";
import { priceTableFromEnv, requireEnv, stripeSecretKey } from "../_shared/env.ts";
import { corsHeaders, json, preflight } from "../_shared/http.ts";
import { withObservability } from "../_shared/observability.ts";
import { createCheckoutService } from "../_shared/billing/checkout_service.ts";
import { createStripeGateway } from "../_shared/billing/stripe_gateway.ts";
import { createUserMembershipReader } from "../_shared/billing/supabase_repository.ts";

Deno.serve(withObservability("create-checkout", async (req) => {
  const get = (k: string) => Deno.env.get(k);
  const siteUrl = get("SITE_URL") ?? "http://localhost:5173";
  const cors = corsHeaders(siteUrl);
  const pre = preflight(req, cors);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405, cors);

  const caller = await resolveCaller(
    req,
    requireEnv(get, "SUPABASE_URL"),
    requireEnv(get, "SUPABASE_ANON_KEY"),
  );
  if (!caller) return json({ error: "sign in first" }, 401, cors);

  let plan = "";
  try {
    plan = String((await req.json())?.plan ?? "");
  } catch {
    return json({ error: "expected a JSON body" }, 400, cors);
  }

  const checkout = createCheckoutService({
    gateway: createStripeGateway({ secretKey: stripeSecretKey(get) }),
    prices: priceTableFromEnv(get),
    siteUrl,
  });

  try {
    const membership = await createUserMembershipReader(caller.client)
      .forUser(caller.user.id);
    const result = await checkout.start(caller.user, plan, membership);
    // Never echo the input back.
    if (result.kind === "unknown_plan") return json({ error: "unknown plan" }, 400, cors);
    return json({ url: result.url, portal: result.kind === "portal" }, 200, cors);
  } catch (err) {
    // Stripe's error text can name internal configuration; the log has it.
    console.error("checkout session failed:", (err as Error).message);
    return json({ error: "could not start checkout" }, 502, cors);
  }
}));

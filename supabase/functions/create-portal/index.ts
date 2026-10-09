/*
 * Open the Stripe billing portal so a member can change or cancel their plan.
 * Not optional: cancelling has to be as easy as subscribing.
 *
 * The customer is read for THIS caller under their own RLS, so nobody can open
 * somebody else's portal by naming a customer id.
 *
 * Deploy: supabase functions deploy create-portal
 */

import { resolveCaller } from "../_shared/auth.ts";
import { requireEnv, stripeSecretKey } from "../_shared/env.ts";
import { corsHeaders, json, preflight } from "../_shared/http.ts";
import { withObservability } from "../_shared/observability.ts";
import { createStripeGateway } from "../_shared/billing/stripe_gateway.ts";
import { createUserMembershipReader } from "../_shared/billing/supabase_repository.ts";

Deno.serve(withObservability("create-portal", async (req) => {
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

  const membership = await createUserMembershipReader(caller.client)
    .forUser(caller.user.id);
  if (!membership?.customerId) return json({ error: "no membership to manage" }, 404, cors);

  try {
    const gateway = createStripeGateway({ secretKey: stripeSecretKey(get) });
    const { url } = await gateway.createPortalSession({
      customerId: membership.customerId,
      returnUrl: `${siteUrl}/account.html`,
    });
    return json({ url }, 200, cors);
  } catch (err) {
    console.error("portal session failed:", (err as Error).message);
    return json({ error: "could not open billing portal" }, 502, cors);
  }
}));

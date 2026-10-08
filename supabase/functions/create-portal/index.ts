/*
 * Open the Stripe billing portal so a member can change or cancel their plan.
 *
 * Not optional. If somebody can subscribe in two clicks and cancelling means
 * emailing you, that is a dark pattern, and in several jurisdictions it is also
 * unlawful. The portal is Stripe's hosted page: card updates, invoices and
 * cancellation, none of which we have to build or store.
 *
 * Deploy:
 *   supabase functions deploy create-portal
 */

import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { withObservability } from "../_shared/observability.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-06-20",
  httpClient: Stripe.createFetchHttpClient(),
});

const SITE_URL = Deno.env.get("SITE_URL") ?? "http://localhost:5173";

const CORS = {
  "access-control-allow-origin": SITE_URL,
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

Deno.serve(withObservability("create-portal", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "sign in first" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );

  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return json({ error: "sign in first" }, 401);

  // The customer is looked up for THIS user under their own RLS. A caller
  // cannot open somebody else's billing portal by naming their customer id.
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("provider_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!sub?.provider_customer_id) {
    return json({ error: "no membership to manage" }, 404);
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.provider_customer_id,
      return_url: `${SITE_URL}/account.html`,
    });
    return json({ url: session.url });
  } catch (err) {
    console.error("portal session failed:", (err as Error).message);
    return json({ error: "could not open billing portal" }, 502);
  }
}));

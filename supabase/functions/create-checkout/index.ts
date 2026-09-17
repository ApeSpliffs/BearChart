/*
 * Start a Stripe Checkout session for the signed-in user.
 *
 * The user is taken from the Supabase JWT on the request, never from the body.
 * If the caller could name the user, they could buy a membership for somebody
 * else - or, worse, have somebody else's payment attach to their own account.
 *
 * The price is chosen server-side from a plan name. A caller who could pass a
 * price id could pass the $0 one and receive Power.
 *
 * Deploy:
 *   supabase functions deploy create-checkout
 * (JWT verification left ON - a real signed-in user is exactly what we need.)
 */

import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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

/** Plan name -> price id. The client may name a plan, never a price. */
function priceForPlan(plan: string): string | null {
  if (plan === "pro") return Deno.env.get("PRICE_PRO") ?? null;
  if (plan === "power") return Deno.env.get("PRICE_POWER") ?? null;
  return null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "sign in first" }, 401);

  // Resolve the caller from their token. This is the identity that gets billed
  // and the identity the webhook will later grant a tier to.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );

  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user;
  if (userError || !user) return json({ error: "sign in first" }, 401);

  let plan = "";
  try {
    plan = ((await req.json())?.plan ?? "").toString();
  } catch {
    return json({ error: "expected a JSON body" }, 400);
  }

  const price = priceForPlan(plan);
  if (!price) return json({ error: `unknown plan: ${plan}` }, 400);

  // Reuse the Stripe customer if this user has bought before, so one person does
  // not accumulate duplicate customers and duplicate subscriptions.
  const { data: existing } = await supabase
    .from("subscriptions")
    .select("provider_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price, quantity: 1 }],
      // The link the webhook trusts. Set here from the verified JWT.
      client_reference_id: user.id,
      customer: existing?.provider_customer_id ?? undefined,
      customer_email: existing?.provider_customer_id ? undefined : user.email,
      allow_promotion_codes: true,
      success_url: `${SITE_URL}/account.html?checkout=done`,
      cancel_url: `${SITE_URL}/plans.html?checkout=cancelled`,
      subscription_data: { metadata: { bearchart_user_id: user.id } },
    });

    return json({ url: session.url });
  } catch (err) {
    console.error("checkout session failed:", (err as Error).message);
    // Do not pass Stripe's error text to the browser; it can name internal
    // configuration. The server log has the detail.
    return json({ error: "could not start checkout" }, 502);
  }
});

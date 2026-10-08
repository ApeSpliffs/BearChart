/**
 * Environment access for edge functions. Pure: the caller passes `get`
 * (normally `(k) => Deno.env.get(k)`), so this file never touches `Deno` and
 * can be tested with no permissions.
 *
 * BEARCHART_ENV names the deployment: development | preview | production.
 * The Stripe key guard stops the two classic accidents - live keys on a
 * staging project, test keys in production - before any request is served.
 */

export type EnvGet = (key: string) => string | undefined;
export type BearchartEnv = "development" | "preview" | "production";

const ENVS: readonly BearchartEnv[] = ["development", "preview", "production"];

/** The deployment this function runs in. Unknown or unset means development. */
export function bearchartEnv(get: EnvGet): BearchartEnv {
  const v = (get("BEARCHART_ENV") ?? "").trim().toLowerCase();
  return (ENVS as readonly string[]).includes(v)
    ? (v as BearchartEnv)
    : "development";
}

/** A required setting, or a clear error naming the missing key (never its value). */
export function requireEnv(get: EnvGet, key: string): string {
  const v = get(key);
  if (v === undefined || v === "") {
    throw new Error(`missing required setting ${key}`);
  }
  return v;
}

/**
 * Refuse a Stripe secret key that does not belong in this environment:
 * sk_live_ / rk_live_ only in production, never a test key in production.
 */
export function assertStripeKeyMatchesEnv(
  key: string,
  env: BearchartEnv,
): void {
  const live = /^(sk|rk)_live_/.test(key);
  const test = /^(sk|rk)_test_/.test(key);
  if (live && env !== "production") {
    throw new Error(
      `refusing a live Stripe key outside production (BEARCHART_ENV=${env})`,
    );
  }
  if (env === "production" && !live) {
    throw new Error(
      test
        ? "refusing a test Stripe key in production"
        : "STRIPE_SECRET_KEY is not a recognised Stripe secret key",
    );
  }
}

/** STRIPE_SECRET_KEY, checked against BEARCHART_ENV. */
export function stripeSecretKey(get: EnvGet): string {
  const key = requireEnv(get, "STRIPE_SECRET_KEY");
  assertStripeKeyMatchesEnv(key, bearchartEnv(get));
  return key;
}

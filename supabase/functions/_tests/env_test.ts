import { assertEquals, assertThrows } from "@std/assert";
import {
  assertStripeKeyMatchesEnv,
  bearchartEnv,
  requireEnv,
  stripeSecretKey,
} from "../_shared/env.ts";

const envOf = (vars: Record<string, string>) => (k: string) => vars[k];

Deno.test("BEARCHART_ENV defaults to development and ignores unknown values", () => {
  assertEquals(bearchartEnv(envOf({})), "development");
  assertEquals(
    bearchartEnv(envOf({ BEARCHART_ENV: "Production" })),
    "production",
  );
  assertEquals(
    bearchartEnv(envOf({ BEARCHART_ENV: "staging" })),
    "development",
  );
});

Deno.test("requireEnv names the missing key, never a value", () => {
  assertThrows(() => requireEnv(envOf({}), "PRICE_PRO"), Error, "PRICE_PRO");
  assertThrows(
    () => requireEnv(envOf({ PRICE_PRO: "" }), "PRICE_PRO"),
    Error,
    "PRICE_PRO",
  );
  assertEquals(
    requireEnv(envOf({ PRICE_PRO: "price_1" }), "PRICE_PRO"),
    "price_1",
  );
});

Deno.test("a live Stripe key is refused outside production", () => {
  assertThrows(
    () => assertStripeKeyMatchesEnv("sk_live_x", "preview"),
    Error,
    "live",
  );
  assertThrows(
    () => assertStripeKeyMatchesEnv("rk_live_x", "development"),
    Error,
    "live",
  );
  assertStripeKeyMatchesEnv("sk_live_x", "production");
});

Deno.test("a test Stripe key is refused in production", () => {
  assertThrows(
    () => assertStripeKeyMatchesEnv("sk_test_x", "production"),
    Error,
    "test",
  );
  assertThrows(() => assertStripeKeyMatchesEnv("garbage", "production"), Error);
  assertStripeKeyMatchesEnv("sk_test_x", "preview");
  assertStripeKeyMatchesEnv("sk_test_x", "development");
});

Deno.test("stripeSecretKey combines presence and the environment guard", () => {
  assertThrows(() => stripeSecretKey(envOf({})), Error, "STRIPE_SECRET_KEY");
  assertThrows(
    () => stripeSecretKey(envOf({ STRIPE_SECRET_KEY: "sk_live_x" })),
    Error,
    "live",
  );
  assertEquals(
    stripeSecretKey(
      envOf({ STRIPE_SECRET_KEY: "sk_live_x", BEARCHART_ENV: "production" }),
    ),
    "sk_live_x",
  );
});

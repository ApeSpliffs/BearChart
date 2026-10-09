// Deno smoke tests for the billing modules. The full behaviour matrix lives
// in tools/test_billing.mjs (run by npm test under Node); this only proves the
// same pure modules load and wire up under Deno with no permissions.
import { assertEquals } from "@std/assert";
import { createBillingService } from "../_shared/billing/service.ts";
import { createCheckoutService } from "../_shared/billing/checkout_service.ts";
import { createWebhookHandler } from "../_shared/billing/webhook_handler.ts";
import type {
  EventLog,
  MembershipRepository,
  SubscriptionGateway,
} from "../_shared/billing/ports.ts";
import type {
  BillingEvent,
  MembershipRow,
  SubscriptionView,
} from "../_shared/billing/types.ts";

const prices = { pro: "price_pro", power: "price_power" };
const USER = "11111111-1111-4111-8111-111111111111";
const silent = { info() {}, warn() {}, error() {} };

function deps() {
  const subs: SubscriptionView[] = [{
    id: "sub_1",
    customerId: "cus_1",
    status: "active",
    priceId: "price_power",
    currentPeriodEnd: 2_000_000_000,
    created: 1,
    metadataUserId: null,
  }];
  const gateway: SubscriptionGateway = {
    listSubscriptions: () => Promise.resolve(subs),
    retrieveSubscription: () => Promise.resolve(subs[0]),
    retrieveCharge: () => Promise.reject(new Error("unused")),
    retrieveInvoice: () => Promise.reject(new Error("unused")),
    cancelSubscription: () => Promise.resolve(),
  };
  const rows: MembershipRow[] = [];
  const repo: MembershipRepository = {
    userIdForCustomer: (c) => Promise.resolve(c === "cus_1" ? USER : null),
    applyState: (r) => {
      rows.push(r);
      return Promise.resolve(true);
    },
  };
  const seen = new Set<string>();
  const events: EventLog = {
    claim: (id) => {
      if (seen.has(id)) return Promise.resolve("duplicate");
      seen.add(id);
      return Promise.resolve("claimed");
    },
    release: (id) => {
      seen.delete(id);
      return Promise.resolve();
    },
  };
  const service = createBillingService({
    gateway,
    repo,
    events,
    prices,
    clock: { now: () => new Date("2026-10-08T00:00:00Z") },
    log: silent,
  });
  const verify = (body: string, sig: string): Promise<BillingEvent> =>
    sig === "good"
      ? Promise.resolve(JSON.parse(body))
      : Promise.reject(new Error("bad signature"));
  return {
    rows,
    handler: createWebhookHandler({ verify, service, log: silent }),
  };
}

const post = (body: unknown, sig?: string) =>
  new Request("http://local/stripe-webhook", {
    method: "POST",
    body: JSON.stringify(body),
    headers: sig ? { "stripe-signature": sig } : {},
  });

const EVT = {
  id: "evt_1",
  type: "customer.subscription.updated",
  created: 1,
  object: { customer: "cus_1", metadata: { bearchart_user_id: "attacker" } },
};

Deno.test("unsigned and forged webhooks are rejected and write nothing", async () => {
  const d = deps();
  assertEquals((await d.handler(post(EVT))).status, 400);
  assertEquals((await d.handler(post(EVT, "forged"))).status, 400);
  assertEquals(d.rows.length, 0);
});

Deno.test("a signed event syncs the recorded user at the price's tier; a replay is a no-op", async () => {
  const d = deps();
  const first = await d.handler(post(EVT, "good"));
  assertEquals(await first.json(), { ok: true });
  const again = await d.handler(post(EVT, "good"));
  assertEquals(await again.json(), { ok: true, duplicate: true });
  assertEquals(d.rows.length, 1);
  assertEquals(d.rows[0].userId, USER);
  assertEquals(d.rows[0].tier, "power");
});

Deno.test("a live member is sent to the portal, not a second checkout", async () => {
  let checkouts = 0;
  const svc = createCheckoutService({
    gateway: {
      createCheckoutSession: () => {
        checkouts++;
        return Promise.resolve({ url: "https://checkout.stripe.com/c" });
      },
      createPortalSession: () =>
        Promise.resolve({ url: "https://billing.stripe.com/p" }),
    },
    prices,
    siteUrl: "https://bearchart.test",
  });
  const r = await svc.start({ id: USER, email: null }, "pro", {
    customerId: "cus_1",
    subscriptionId: "sub_1",
    status: "active",
  });
  assertEquals(r, { kind: "portal", url: "https://billing.stripe.com/p" });
  assertEquals(checkouts, 0);
});

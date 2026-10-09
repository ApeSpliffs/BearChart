// Billing behaviour tests: the pure edge-function modules under
// supabase/functions/_shared/billing, imported directly through Node's type
// stripping (Node >= 22.18). No Deno, no network, no Stripe.
//
//   node --test tools/test_billing.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

const base = '../supabase/functions/_shared/';
const policy = await import(base + 'billing/policy.ts');
const { createBillingService } = await import(base + 'billing/service.ts');
const { createCheckoutService } = await import(base + 'billing/checkout_service.ts');
const { createWebhookHandler } = await import(base + 'billing/webhook_handler.ts');
const { priceTableFromEnv } = await import(base + 'env.ts');

const PRICES = { pro: 'price_pro', power: 'price_power' };
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-10-08T12:00:00Z');

function sub(o) {
  return Object.assign({ id: 'sub_1', customerId: 'cus_1', status: 'active', priceId: 'price_pro',
    currentPeriodEnd: 2000000000, created: 100, metadataUserId: null }, o);
}

class FakeGateway {
  constructor() { this.subs = {}; this.charges = {}; this.invoices = {}; this.cancelled = []; this.calls = 0; }
  async listSubscriptions(c) { this.calls++; return (this.subs[c] || []).map((s) => Object.assign({}, s)); }
  async retrieveSubscription(id) {
    this.calls++;
    for (const list of Object.values(this.subs)) { const s = list.find((x) => x.id === id); if (s) return Object.assign({}, s); }
    throw new Error('no such subscription ' + id);
  }
  async retrieveCharge(id) { this.calls++; return this.charges[id]; }
  async retrieveInvoice(id) { this.calls++; return this.invoices[id]; }
  async cancelSubscription(id) {
    this.calls++; this.cancelled.push(id);
    for (const list of Object.values(this.subs)) for (const s of list) if (s.id === id) s.status = 'canceled';
  }
}
class FakeRepo {
  constructor(map) { this.map = Object.assign({}, map); this.rows = []; this.stale = false; }
  async userIdForCustomer(c) { return this.map[c] || null; }
  async applyState(row) { if (this.stale) return false; this.rows.push(row); return true; }
}
class FakeEvents {
  constructor() { this.seen = new Set(); this.claimed = []; this.released = []; }
  async claim(id) { if (this.seen.has(id)) return 'duplicate'; this.seen.add(id); this.claimed.push(id); return 'claimed'; }
  async release(id) { this.seen.delete(id); this.released.push(id); }
}
function fakeLog() {
  const msgs = [];
  return { msgs, info: (m, meta) => msgs.push(['info', m, meta]), warn: (m, meta) => msgs.push(['warn', m, meta]),
    error: (m, meta) => msgs.push(['error', m, meta]) };
}
function setup(map) {
  const gateway = new FakeGateway(), repo = new FakeRepo(map), events = new FakeEvents(), log = fakeLog();
  const service = createBillingService({ gateway, repo, events, prices: PRICES, clock: { now: () => NOW }, log });
  return { gateway, repo, events, log, service };
}
let n = 0;
const ev = (type, object) => ({ id: 'evt_' + (++n), type, created: 1, object });

// ---------------------------------------------------------------- policy
test('tierForPrice never matches null, empty or an unset env price', () => {
  assert.equal(policy.tierForPrice(null, PRICES), null);
  assert.equal(policy.tierForPrice('', PRICES), null);
  assert.equal(policy.tierForPrice('', { pro: '', power: null }), null);
  assert.equal(policy.tierForPrice(null, { pro: null, power: null }), null);
  assert.equal(policy.tierForPrice('price_pro', PRICES), 'pro');
  assert.equal(policy.tierForPrice('price_power', PRICES), 'power');
  assert.equal(policy.tierForPrice('price_other', PRICES), null);
});

test('priceTableFromEnv: unset or blank prices are null', () => {
  assert.deepEqual(priceTableFromEnv(() => undefined), { pro: null, power: null });
  assert.deepEqual(priceTableFromEnv((k) => ({ PRICE_PRO: ' ', PRICE_POWER: 'price_p' })[k]), { pro: null, power: 'price_p' });
});

test('priceForPlan names plans, never prices', () => {
  assert.equal(policy.priceForPlan('pro', PRICES), 'price_pro');
  assert.equal(policy.priceForPlan('power', PRICES), 'price_power');
  assert.equal(policy.priceForPlan('price_pro', PRICES), null);
  assert.equal(policy.priceForPlan('pro', { pro: null, power: null }), null);
});

test('mapStatus table', () => {
  const table = { active: 'active', trialing: 'trialing', past_due: 'past_due', unpaid: 'past_due',
    canceled: 'canceled', incomplete: 'canceled', incomplete_expired: 'canceled', paused: 'canceled', weird: 'canceled' };
  for (const [k, v] of Object.entries(table)) assert.equal(policy.mapStatus(k), v, k);
});

test('pickEffectiveSubscription ranks live, then tier, then newest; ignores foreign prices', () => {
  const pro = sub({ id: 'a', priceId: 'price_pro' });
  const power = sub({ id: 'b', priceId: 'price_power' });
  assert.equal(policy.pickEffectiveSubscription([pro, power], PRICES).id, 'b', 'active power beats active pro');
  const pd = sub({ id: 'c', priceId: 'price_power', status: 'past_due' });
  assert.equal(policy.pickEffectiveSubscription([pd, pro], PRICES).id, 'a', 'active beats past_due');
  const foreign = sub({ id: 'd', priceId: 'price_store', created: 999 });
  assert.equal(policy.pickEffectiveSubscription([foreign], PRICES), null, 'foreign prices ignored');
  const c1 = sub({ id: 'e', status: 'canceled', created: 1 });
  const c2 = sub({ id: 'f', status: 'canceled', created: 5 });
  assert.equal(policy.pickEffectiveSubscription([c1, c2], PRICES).id, 'f', 'latest wins among canceled');
  assert.equal(policy.pickEffectiveSubscription([], PRICES), null);
});

test('membershipRowFor: none is free/canceled; canceled is free; period end ISO', () => {
  assert.deepEqual(policy.membershipRowFor(U1, 'cus_1', null, PRICES, 'T'), {
    userId: U1, tier: 'free', status: 'canceled', customerId: 'cus_1', subscriptionId: null, currentPeriodEnd: null, syncedAt: 'T' });
  const r = policy.membershipRowFor(U1, 'cus_1', sub({ priceId: 'price_power', status: 'unpaid', currentPeriodEnd: 0 }), PRICES, 'T');
  assert.equal(r.tier, 'power'); assert.equal(r.status, 'past_due');
  assert.equal(r.currentPeriodEnd, '1970-01-01T00:00:00.000Z');
  const c = policy.membershipRowFor(U1, 'cus_1', sub({ status: 'canceled' }), PRICES, 'T');
  assert.equal(c.tier, 'free'); assert.equal(c.status, 'canceled'); assert.equal(c.subscriptionId, 'sub_1');
  assert.equal(policy.membershipRowFor(U1, 'c', sub({ currentPeriodEnd: null }), PRICES, 'T').currentPeriodEnd, null);
});

test('hasLiveMembership', () => {
  assert.equal(policy.hasLiveMembership(null), false);
  assert.equal(policy.hasLiveMembership({ customerId: 'c', subscriptionId: 's', status: 'active' }), true);
  assert.equal(policy.hasLiveMembership({ customerId: 'c', subscriptionId: 's', status: 'past_due' }), true);
  assert.equal(policy.hasLiveMembership({ customerId: 'c', subscriptionId: 's', status: 'canceled' }), false);
  assert.equal(policy.hasLiveMembership({ customerId: 'c', subscriptionId: null, status: 'active' }), false);
  assert.equal(policy.hasLiveMembership({ customerId: null, subscriptionId: 's', status: 'active' }), false);
});

test('isUuid and the owner-tunable revoke constants', () => {
  assert.equal(policy.isUuid(U1), true);
  assert.equal(policy.isUuid('attacker'), false);
  assert.equal(policy.isUuid(null), false);
  assert.equal(policy.REVOKE_ON_DISPUTE, true);
  assert.equal(policy.REVOKE_ON_FULL_REFUND, true);
});

// ---------------------------------------------------------------- service
test('1. a duplicate event makes no gateway calls', async () => {
  const t = setup({ cus_1: U1 });
  t.gateway.subs.cus_1 = [sub()];
  const e = ev('customer.subscription.updated', { customer: 'cus_1' });
  assert.equal((await t.service.handle(e)).status, 'processed');
  const calls = t.gateway.calls;
  assert.deepEqual(await t.service.handle(e), { status: 'duplicate' });
  assert.equal(t.gateway.calls, calls);
  assert.equal(t.repo.rows.length, 1);
});

test('2. a thrown error releases the event and rethrows', async () => {
  const t = setup({ cus_1: U1 });
  t.gateway.listSubscriptions = async () => { throw new Error('stripe down'); };
  const e = ev('customer.subscription.updated', { customer: 'cus_1' });
  await assert.rejects(t.service.handle(e), /stripe down/);
  assert.deepEqual(t.events.released, [e.id]);
});

test('3. checkout.session.completed writes the client_reference_id user and the price tier', async () => {
  const t = setup({});
  t.gateway.subs.cus_1 = [sub({ priceId: 'price_power' })];
  const r = await t.service.handle(ev('checkout.session.completed',
    { mode: 'subscription', customer: 'cus_1', client_reference_id: U1, metadata: { tier: 'power' } }));
  assert.equal(r.status, 'processed');
  assert.equal(t.repo.rows[0].userId, U1);
  assert.equal(t.repo.rows[0].tier, 'power');
  assert.equal(t.repo.rows[0].status, 'active');
  assert.equal(t.repo.rows[0].syncedAt, NOW.toISOString());
});

test('3b. a one-off payment checkout is ignored', async () => {
  const t = setup({});
  const r = await t.service.handle(ev('checkout.session.completed', { mode: 'payment', customer: 'cus_1', client_reference_id: U1 }));
  assert.equal(r.status, 'ignored');
  assert.equal(t.repo.rows.length, 0);
});

test('4. a non-uuid client_reference_id throws', async () => {
  const t = setup({});
  t.gateway.subs.cus_1 = [sub()];
  await assert.rejects(t.service.handle(ev('checkout.session.completed',
    { mode: 'subscription', customer: 'cus_1', client_reference_id: 'attacker' })));
  assert.equal(t.repo.rows.length, 0);
  assert.equal(t.events.released.length, 1);
});

test('5. subscription.updated for an unmapped customer uses metadata.bearchart_user_id', async () => {
  const t = setup({});
  t.gateway.subs.cus_9 = [sub({ customerId: 'cus_9' })];
  await t.service.handle(ev('customer.subscription.updated', { customer: 'cus_9', metadata: { bearchart_user_id: U2 } }));
  assert.equal(t.repo.rows[0].userId, U2);
  assert.equal(t.repo.rows[0].tier, 'pro');
});

test('6. an unmapped customer with only foreign prices is ignored without throwing', async () => {
  const t = setup({});
  t.gateway.subs.cus_s = [sub({ customerId: 'cus_s', priceId: 'price_store' })];
  const r = await t.service.handle(ev('customer.subscription.updated', { customer: 'cus_s' }));
  assert.equal(r.status, 'ignored');
  assert.match(r.reason, /not a BearChart customer/);
  assert.equal(t.repo.rows.length, 0);
});

test('7. an unmapped customer on our price with no metadata throws (Stripe retries)', async () => {
  const t = setup({});
  t.gateway.subs.cus_x = [sub({ customerId: 'cus_x' })];
  await assert.rejects(t.service.handle(ev('customer.subscription.updated', { customer: 'cus_x' })), /no user for stripe customer/);
});

test('8. out of order: deleted for sub A while B is active writes active/power', async () => {
  const t = setup({ cus_1: U1 });
  t.gateway.subs.cus_1 = [sub({ id: 'A', status: 'canceled', priceId: 'price_pro', created: 1 }),
    sub({ id: 'B', status: 'active', priceId: 'price_power', created: 2 })];
  await t.service.handle(ev('customer.subscription.deleted', { id: 'A', customer: 'cus_1', status: 'canceled' }));
  const row = t.repo.rows[0];
  assert.equal(row.status, 'active');
  assert.equal(row.tier, 'power');
  assert.equal(row.subscriptionId, 'B');
});

test('9. invoice.payment_failed with the list showing past_due writes past_due', async () => {
  const t = setup({ cus_1: U1 });
  t.gateway.subs.cus_1 = [sub({ status: 'past_due' })];
  await t.service.handle(ev('invoice.payment_failed', { customer: 'cus_1', subscription: 'sub_1' }));
  assert.equal(t.repo.rows[0].status, 'past_due');
  assert.equal(t.repo.rows[0].tier, 'pro');
});

test('9b. an invoice payload without `subscription` (API >= 2025-03-31.basil) still syncs the customer', async () => {
  const t = setup({ cus_1: U1 });
  t.gateway.subs.cus_1 = [sub({ status: 'past_due' })];
  const r = await t.service.handle(ev('invoice.payment_failed', { customer: 'cus_1' }));
  assert.equal(r.status, 'processed');
  assert.equal(t.repo.rows[0].status, 'past_due');
});

test('9c. an invoice for a customer with none of our prices is ignored', async () => {
  const t = setup({});
  t.gateway.subs.cus_store = [sub({ id: 'sub_store', customerId: 'cus_store', priceId: 'price_store' })];
  const r = await t.service.handle(ev('invoice.paid', { customer: 'cus_store' }));
  assert.equal(r.status, 'ignored');
  assert.equal(t.repo.rows.length, 0);
});

test('10. charge.dispute.created cancels the subscription found via charge -> invoice, then syncs', async () => {
  const t = setup({ cus_1: U1 });
  t.gateway.subs.cus_1 = [sub({ id: 'sub_d', priceId: 'price_power' })];
  t.gateway.charges.ch_1 = { id: 'ch_1', customerId: 'cus_1', invoiceId: 'in_1', refunded: false };
  t.gateway.invoices.in_1 = { id: 'in_1', customerId: 'cus_1', subscriptionId: 'sub_d' };
  const r = await t.service.handle(ev('charge.dispute.created', { charge: 'ch_1' }));
  assert.equal(r.status, 'processed');
  assert.deepEqual(t.gateway.cancelled, ['sub_d']);
  assert.equal(t.repo.rows[0].tier, 'free');
  assert.equal(t.repo.rows[0].status, 'canceled');
});

test('11. a partial refund is ignored; a full refund cancels', async () => {
  const t = setup({ cus_1: U1 });
  t.gateway.subs.cus_1 = [sub({ id: 'sub_r' })];
  t.gateway.invoices.in_r = { id: 'in_r', customerId: 'cus_1', subscriptionId: 'sub_r' };
  // The payload carries no `invoice` (removed in newer API versions): the
  // charge is re-read through the SDK, which is pinned to 2024-06-20.
  t.gateway.charges.ch_p = { id: 'ch_p', customerId: 'cus_1', invoiceId: 'in_r', refunded: false };
  const partial = await t.service.handle(ev('charge.refunded', { id: 'ch_p', customer: 'cus_1' }));
  assert.equal(partial.status, 'ignored');
  assert.match(partial.reason, /partial refund/);
  assert.deepEqual(t.gateway.cancelled, []);
  t.gateway.charges.ch_r = { id: 'ch_r', customerId: 'cus_1', invoiceId: 'in_r', refunded: true };
  const full = await t.service.handle(ev('charge.refunded', { id: 'ch_r', customer: 'cus_1' }));
  assert.equal(full.status, 'processed');
  assert.deepEqual(t.gateway.cancelled, ['sub_r']);
  assert.equal(t.repo.rows[0].tier, 'free');
});

test('12. a charge with no invoice (e.g. a store sale) is ignored', async () => {
  const t = setup({ cus_1: U1 });
  t.gateway.charges.ch_s = { id: 'ch_s', customerId: 'cus_1', invoiceId: null, refunded: true };
  const r = await t.service.handle(ev('charge.refunded', { id: 'ch_s', customer: 'cus_1' }));
  assert.equal(r.status, 'ignored');
  assert.match(r.reason, /not a membership charge/);
  assert.deepEqual(t.gateway.cancelled, []);
});

test('12b. a charge on a foreign-price subscription is ignored and not cancelled', async () => {
  const t = setup({ cus_1: U1 });
  t.gateway.subs.cus_1 = [sub({ id: 'sub_store', priceId: 'price_store' })];
  t.gateway.invoices.in_s = { id: 'in_s', customerId: 'cus_1', subscriptionId: 'sub_store' };
  t.gateway.charges.c = { id: 'c', customerId: 'cus_1', invoiceId: 'in_s', refunded: true };
  const r = await t.service.handle(ev('charge.refunded', { id: 'c', customer: 'cus_1' }));
  assert.equal(r.status, 'ignored');
  assert.deepEqual(t.gateway.cancelled, []);
});

test('13. two live subscriptions log a duplicate warning', async () => {
  const t = setup({ cus_1: U1 });
  t.gateway.subs.cus_1 = [sub({ id: 'x' }), sub({ id: 'y', priceId: 'price_power' })];
  await t.service.handle(ev('customer.subscription.created', { customer: 'cus_1' }));
  const w = t.log.msgs.find((m) => m[0] === 'warn' && /duplicate live subscriptions/.test(m[1]));
  assert.ok(w);
  assert.deepEqual(w[2].ids.sort(), ['x', 'y']);
  assert.equal(t.repo.rows[0].tier, 'power');
});

test('14. a stale applyState still returns processed and logs "stale"', async () => {
  const t = setup({ cus_1: U1 });
  t.gateway.subs.cus_1 = [sub()];
  t.repo.stale = true;
  const r = await t.service.handle(ev('customer.subscription.updated', { customer: 'cus_1' }));
  assert.equal(r.status, 'processed');
  assert.ok(t.log.msgs.some((m) => m[0] === 'info' && /stale/.test(m[1])));
});

test('15. unhandled types are ignored and stay claimed', async () => {
  const t = setup({});
  const e = ev('customer.created', {});
  assert.deepEqual(await t.service.handle(e), { status: 'ignored', reason: 'unhandled type' });
  assert.deepEqual(t.events.claimed, [e.id]);
  assert.deepEqual(t.events.released, []);
  assert.equal(t.gateway.calls, 0);
});

test('16. a customer/user mismatch keeps the recorded user and warns', async () => {
  const t = setup({ cus_1: U1 });
  t.gateway.subs.cus_1 = [sub()];
  await t.service.handle(ev('customer.subscription.updated', { customer: 'cus_1', metadata: { bearchart_user_id: U2 } }));
  assert.equal(t.repo.rows[0].userId, U1);
  assert.ok(t.log.msgs.some((m) => m[0] === 'warn' && /customer\/user mismatch/.test(m[1])));
});

test('paused/resumed and expanded customer objects are synced', async () => {
  const t = setup({ cus_1: U1 });
  t.gateway.subs.cus_1 = [sub({ status: 'paused' })];
  await t.service.handle(ev('customer.subscription.paused', { customer: { id: 'cus_1' } }));
  assert.equal(t.repo.rows[0].status, 'canceled');
  assert.equal(t.repo.rows[0].tier, 'free');
});

// ---------------------------------------------------------------- webhook handler
function handlerWith(opts) {
  const log = fakeLog();
  const calls = [];
  const service = { handle: async (e) => { calls.push(e); if (opts.throws) throw new Error('db down'); return opts.result || { status: 'processed' }; } };
  const verify = async (body, sig) => { if (sig !== 'good') throw new Error('bad sig'); return JSON.parse(body); };
  return { h: createWebhookHandler({ verify, service, log }), calls, log };
}
const post = (body, sig) => new Request('http://local/stripe-webhook', { method: 'POST', body,
  headers: sig ? { 'stripe-signature': sig } : {} });
const EVT = JSON.stringify({ id: 'evt_w', type: 'customer.subscription.updated', created: 1, object: { secret: 'payload' } });

test('webhook: non-POST is 405', async () => {
  const { h } = handlerWith({});
  assert.equal((await h(new Request('http://local/x', { method: 'GET' }))).status, 405);
});
test('webhook: missing signature is 400', async () => {
  const { h, calls } = handlerWith({});
  const res = await h(post(EVT));
  assert.equal(res.status, 400);
  assert.equal(await res.text(), 'missing signature');
  assert.equal(calls.length, 0);
});
test('webhook: invalid signature is 400, service not called, body not logged', async () => {
  const { h, calls, log } = handlerWith({});
  const res = await h(post(EVT, 'forged'));
  assert.equal(res.status, 400);
  assert.equal(await res.text(), 'invalid signature');
  assert.equal(calls.length, 0);
  assert.ok(!JSON.stringify(log.msgs).includes('payload'));
});
test('webhook: duplicate is 200 with duplicate:true', async () => {
  const { h } = handlerWith({ result: { status: 'duplicate' } });
  const res = await h(post(EVT, 'good'));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, duplicate: true });
});
test('webhook: processed is 200 {ok:true}', async () => {
  const { h } = handlerWith({});
  assert.deepEqual(await (await h(post(EVT, 'good'))).json(), { ok: true });
});
test('webhook: a service error is 500 and logs the type only', async () => {
  const { h, log } = handlerWith({ throws: true });
  const res = await h(post(EVT, 'good'));
  assert.equal(res.status, 500);
  assert.equal(await res.text(), 'handler error');
  assert.ok(log.msgs.some((m) => /handling customer\.subscription\.updated failed:/.test(m[1])));
  assert.ok(!JSON.stringify(log.msgs).includes('payload'));
});

// ---------------------------------------------------------------- checkout service
function checkoutWith(stripeSubs) {
  const calls = { checkout: [], portal: [], list: [] };
  const gateway = {
    listSubscriptions: async (c) => { calls.list.push(c); return (stripeSubs || {})[c] || []; },
    createCheckoutSession: async (i) => { calls.checkout.push(i); return { url: 'https://checkout.stripe.com/c/1' }; },
    createPortalSession: async (i) => { calls.portal.push(i); return { url: 'https://billing.stripe.com/p/1' }; },
  };
  return { svc: createCheckoutService({ gateway, prices: PRICES, siteUrl: 'https://bearchart.test' }), calls };
}
const caller = { id: U1, email: 'a@example.com' };

test('checkout: unknown plan (or a price id) is refused', async () => {
  const { svc, calls } = checkoutWith();
  assert.deepEqual(await svc.start(caller, 'gold', null), { kind: 'unknown_plan' });
  assert.deepEqual(await svc.start(caller, 'price_power', null), { kind: 'unknown_plan' });
  assert.equal(calls.checkout.length + calls.portal.length, 0);
});
test('checkout: a live membership goes to the portal, never a second checkout', async () => {
  const { svc, calls } = checkoutWith();
  const r = await svc.start(caller, 'power', { customerId: 'cus_1', subscriptionId: 'sub_1', status: 'past_due' });
  assert.deepEqual(r, { kind: 'portal', url: 'https://billing.stripe.com/p/1' });
  assert.equal(calls.checkout.length, 0);
  assert.deepEqual(calls.portal[0], { customerId: 'cus_1', returnUrl: 'https://bearchart.test/account.html' });
});
test('checkout: a canceled member reuses the customer, email null', async () => {
  const { svc, calls } = checkoutWith();
  const r = await svc.start(caller, 'pro', { customerId: 'cus_1', subscriptionId: 'sub_1', status: 'canceled' });
  assert.equal(r.kind, 'checkout');
  const i = calls.checkout[0];
  assert.equal(i.customerId, 'cus_1');
  assert.equal(i.email, null);
  assert.equal(i.priceId, 'price_pro');
  assert.equal(i.userId, U1);
  assert.equal(i.successUrl, 'https://bearchart.test/account.html?checkout=done');
  assert.equal(i.cancelUrl, 'https://bearchart.test/plans.html?checkout=cancelled');
});
test('checkout: our row lags Stripe -> a live Stripe subscription still sends the member to the portal', async () => {
  const { svc, calls } = checkoutWith({ cus_1: [sub({ status: 'active', priceId: 'price_pro' })] });
  const r = await svc.start(caller, 'power', { customerId: 'cus_1', subscriptionId: null, status: 'canceled' });
  assert.equal(r.kind, 'portal');
  assert.deepEqual(calls.list, ['cus_1']);
  assert.equal(calls.checkout.length, 0);
});
test('checkout: an unpaid Stripe subscription goes to the portal to fix the card', async () => {
  const { svc, calls } = checkoutWith({ cus_1: [sub({ status: 'unpaid', priceId: 'price_pro' })] });
  const r = await svc.start(caller, 'pro', { customerId: 'cus_1', subscriptionId: 'sub_1', status: 'canceled' });
  assert.equal(r.kind, 'portal');
  assert.equal(calls.checkout.length, 0);
});
test('checkout: a live subscription on a foreign (store) price does not block a membership', async () => {
  const { svc, calls } = checkoutWith({ cus_1: [sub({ status: 'active', priceId: 'price_store' })] });
  const r = await svc.start(caller, 'pro', { customerId: 'cus_1', subscriptionId: null, status: 'canceled' });
  assert.equal(r.kind, 'checkout');
  assert.equal(calls.portal.length, 0);
});
test('checkout: no membership sends the email; userId is always the caller', async () => {
  const { svc, calls } = checkoutWith();
  await svc.start(caller, 'power', null);
  assert.equal(calls.checkout[0].email, 'a@example.com');
  assert.equal(calls.checkout[0].customerId, null);
  assert.equal(calls.checkout[0].userId, caller.id);
  assert.equal(calls.checkout[0].priceId, 'price_power');
});

test('a failed release is logged and the ORIGINAL error is rethrown', async () => {
  const t = setup({ cus_1: U1 });
  t.gateway.listSubscriptions = async () => { throw new Error('stripe down'); };
  t.events.release = async () => { throw new Error('db down'); };
  await assert.rejects(t.service.handle(ev('customer.subscription.updated', { customer: 'cus_1' })), /stripe down/);
  assert.ok(t.log.msgs.some(([lvl, m]) => lvl === 'error' && /release failed/.test(m)));
});

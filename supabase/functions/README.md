# Payments

Three edge functions. The browser never sees the Stripe secret key, never names a
price, and never says who it is — all three are resolved server-side.

| Function | JWT | Does |
|---|---|---|
| `create-checkout` | required | Starts a Checkout session for the caller |
| `create-portal` | required | Opens Stripe's billing portal to change or cancel |
| `stripe-webhook` | **off** | Receives Stripe's events and writes `subscriptions` |

`stripe-webhook` is deployed `--no-verify-jwt` because Stripe is not a signed-in
user and carries no Supabase token. **Its auth is the Stripe signature**, checked
before the body is parsed. That check is the only thing between a stranger and a
free Power membership — an unverified webhook is an open endpoint that hands out
subscriptions to anyone who finds the URL.

## Setup

1. In Stripe, create two recurring prices — Pro and Power — and copy their ids.

2. Set the secrets:

   ```bash
   supabase secrets set STRIPE_SECRET_KEY=sk_live_...
   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
   supabase secrets set PRICE_PRO=price_...
   supabase secrets set PRICE_POWER=price_...
   supabase secrets set SITE_URL=https://your-domain
   supabase secrets set BEARCHART_ENV=production   # live keys are refused otherwise
   ```

   `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are
   injected automatically.

3. Deploy:

   ```bash
   supabase functions deploy create-checkout
   supabase functions deploy create-portal
   supabase functions deploy stripe-webhook --no-verify-jwt
   ```

4. In Stripe → Developers → Webhooks, add an endpoint pointing at
   `https://<project>.functions.supabase.co/stripe-webhook`, subscribed to:

   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `customer.subscription.paused`
   - `customer.subscription.resumed`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `charge.refunded`
   - `charge.dispute.created`

   Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

5. Turn membership on in `tools/build_data.py`:

   ```python
   ("enabled", True),
   ("provider", "stripe"),
   ```

   then `npm run build`.

## Test it before taking real money

Use Stripe test mode and the CLI, which replays real event shapes at your
deployed function:

```bash
stripe listen --forward-to https://<project>.functions.supabase.co/stripe-webhook
stripe trigger checkout.session.completed
```

Check `subscriptions` afterwards. Then confirm the parts that matter:

- **A forged webhook is rejected.** POST a plausible body with no signature; you
  should get 400 and no row written.
- **A replay is a no-op.** Send the same event id twice; the second returns
  `duplicate: true` and does not extend anybody's membership.
- **A cancellation lands.** Cancel in the portal (immediately) and watch the
  row go to `canceled`; `current_tier()` returns `free` at once for a
  cancellation. (A failed payment is different: see the grace period below.)
- **A failed payment keeps access for the grace period.** `stripe trigger
  invoice.payment_failed`: the row goes `past_due`, `past_due_since` is set, and
  `current_tier()` still returns the paid tier until 7 days have passed.
- **A dispute revokes.** `stripe trigger charge.dispute.created` against a
  membership charge cancels that subscription and the row goes `free`.
- **A lapsed member keeps their history.** `holding_snapshots` stays readable.

None of the above has been run against live Stripe from this repo. The code
follows Stripe's documented contract and the security-critical shape is covered
by tests in `tools/test_pages.js` and `tools/test_billing.mjs`, but the first real payment is still ahead of
it — do the test-mode pass before pointing anyone at a checkout page.

## How the webhook decides

Every handled event re-reads the customer's **full** subscription list from
Stripe and writes the effective state through `apply_subscription_state()`
(migration `20261008000104`). So the row converges on Stripe's current truth
whatever order events arrive in, and a slower handler that read older state is
refused by the `stripe_synced_at` guard. The effective subscription is the most
alive one on our prices (active/trialing, then past_due, then unpaid), then the
higher tier, then the newest; a second live subscription is logged as a warning.
`create-checkout` sends a member who already has a live subscription to the
billing portal (`{ url, portal: true }`) instead of selling a second one.

The user comes from the recorded customer -> user link; for a new customer, from
`client_reference_id` / `subscription_data.metadata.bearchart_user_id`, which
`create-checkout` set server-side from the caller's JWT. An unknown customer
with none of our prices is ignored (the Stripe account may be shared with the
store); one on our prices with no user link fails so Stripe retries.

**Grace period.** A failed renewal (`past_due`, or Stripe's `unpaid`) keeps the
paid tier for 7 days from when the subscription first went past_due
(`subscriptions.past_due_since`). The value lives in one place, the SQL function
`public.past_due_grace()`. Choose Stripe's retry schedule and final action
(cancel or mark unpaid) to fit it.

**Refunds and disputes.** By default a dispute (`charge.dispute.created`) or a
**full** refund (`charge.refunded` with `refunded: true`) of a membership charge
cancels that subscription immediately and the member reads free. Partial
refunds change nothing. Charges with no invoice, or on an invoice that is not
for one of our prices, are ignored. The switches are `REVOKE_ON_DISPUTE` and
`REVOKE_ON_FULL_REFUND` in `_shared/billing/policy.ts`.

## Layout

```
_shared/http.ts, env.ts, observability.ts   pure helpers (env read is injected)
_shared/billing/types.ts, ports.ts           domain vocabulary and interfaces
_shared/billing/policy.ts                    pure rules (tiers, statuses, effective subscription)
_shared/billing/service.ts                   webhook application service
_shared/billing/checkout_service.ts          checkout vs portal decision
_shared/billing/webhook_handler.ts           HTTP: method, signature, status codes
_shared/billing/stripe_gateway.ts            Stripe adapter (Deno only)
_shared/billing/supabase_repository.ts       Supabase adapters (Deno only)
_shared/auth.ts                              caller from the JWT (Deno only)
<function>/index.ts                          wiring only
```

The pure files never import from esm.sh and never touch `Deno`, so Node can
run them: `node --test tools/test_billing.mjs` (part of `npm test`) is the full
behaviour matrix; `_tests/billing_test.ts` is a small Deno smoke suite.
Every `index.ts` reads its settings on the request, checks `STRIPE_SECRET_KEY`
against `BEARCHART_ENV` (`_shared/env.ts`) and is wrapped in
`withObservability`.

## Local checks

```bash
cd supabase/functions && deno task ci   # deno check + deno lint + deno test
```

Tests run with no permissions (`--no-prompt`), so a module that reads
`Deno.env` at load time fails them: pass settings in, don't fetch them. The
lockfile is version 4 so the edge runtime's Deno (2.1.4, pinned as
`DENO_VERSION` in `.github/workflows/ci.yml`) can read it; regenerate it with
that version (`deno check --frozen=false ...`). `compilerOptions.types` names
`npm:@types/node@*` only so Deno 2.1 records it in the lockfile.

`_shared/package.json` (`{"type": "module"}`) lets Node's type stripping import the
pure `_shared/*.ts` modules as ES modules, so `npm test` can exercise them without
Deno (the security workstream's billing tests rely on it).

`_shared/observability.ts` wraps each handler: an unhandled error becomes a
bare 500, and is reported to Sentry only when `SENTRY_DSN` is set.
`_shared/env.ts` refuses a live Stripe key outside `BEARCHART_ENV=production`
and a test key inside it.

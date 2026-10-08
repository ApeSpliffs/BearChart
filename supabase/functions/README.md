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
   - `invoice.payment_failed`

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
- **A cancellation lands.** Cancel in the portal and watch the row go to
  `canceled`; `current_tier()` should return `free` immediately.
- **A lapsed member keeps their history.** `holding_snapshots` stays readable.

None of the above has been run against live Stripe from this repo. The code
follows Stripe's documented contract and the security-critical shape is covered
by tests in `tools/test_pages.js`, but the first real payment is still ahead of
it — do the test-mode pass before pointing anyone at a checkout page.

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

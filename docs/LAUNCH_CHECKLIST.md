# Launch checklist (owner actions)

Everything on the `audit-fixes` branch is built and tested locally. Nothing has
been pushed, deployed or applied to a live service. These are the steps only the
owner can take: dashboards, secrets, legal and business calls. Work top to bottom;
the first section blocks launch.

## 1. Before the first deploy (blocking)

### GitHub
- [ ] Protect `main` with the required check `CI / ci-ok` and Code Owners review
      (needs GitHub Pro/Team for private repos); the bot is the only bypass.
- [ ] Create the `bearchart-bot` App (`BOT_APP_ID`, `BOT_APP_PRIVATE_KEY`) in a
      `production-data` environment, used by the daily publish job.
- [ ] Actions settings: default token read-only; restrict which actions may run.
- [ ] Turn on Dependabot and secret push protection.

### Supabase
- [ ] Confirm production's Postgres major version (`supabase/config.toml` says 17).
- [ ] Export the live 7-argument `save_showcase` into
      `supabase/migrations/20261008000011_save_showcase_details.sql`; confirm it
      requires photo paths to start with `auth.uid()||'/'`; drop the 5-argument
      overload. (The only failing pgTAP item is this TODO.)
- [ ] Reconcile production before the first `db push` (`db pull` diff, then
      `migration repair`), then apply migrations in order:
      000001–000010 (base), 000100–000104 (security; review the cleanup UPDATE
      counts from 000100), 000200 (comps export, stays off), 000250–000251
      (data accuracy and merges), 000300 (waitlist). Then load `seed.sql`.
- [ ] Decide on dropping `collections`, `portfolio_flows`, `holding_snapshots`
      (if all are empty) — writes to them are already blocked.
- [ ] Auth → URL Configuration: Site URL, and `https://<domain>/account.html`
      plus the Vercel preview pattern in Redirect URLs.
- [ ] Auth → Email Templates (confirm signup, magic link, reset):
      `{{ .SiteURL }}/account.html?token_hash={{ .TokenHash }}&type=<email|recovery>`.
- [ ] Auth → Email provider: minimum password length ≥ 10 (then raise
      `MIN_PASSWORD_LENGTH` to match), character classes, leaked-password
      protection, secure password change, review email rate limits.
- [ ] Create a staging project (Stripe test keys, `BEARCHART_ENV=preview`); set
      `BEARCHART_ENV=production` as a function secret on production (the key
      guard refuses a live Stripe key otherwise).
- [ ] Pro plan for daily backups; session-pooler connection string for the backup job.

### Stripe
- [ ] Pin the webhook endpoint's API version to `2024-06-20` (newer versions drop
      fields the webhook reads; the handler re-fetches, but pinning is safer).
- [ ] Subscribe the webhook to `invoice.paid`, `customer.subscription.paused`,
      `customer.subscription.resumed`, `charge.refunded`, `charge.dispute.created`
      (in addition to the existing subscription events).
- [ ] Billing → failed payments: a retry schedule and final action consistent with
      the 7-day in-app grace.
- [ ] Confirm whether this Stripe account is shared with Jay's Retro Exchange (the
      webhook ignores non-membership charges, but will receive them).
- [ ] Decide the refund/dispute policy. Default: revoke on dispute and on full
      refund (`supabase/functions/_shared/billing/policy.ts`).
- [ ] Run the README's Stripe CLI test-mode pass after deploying.

### Vercel
- [ ] Set `BEARCHART_*` variables separately for Preview and Production.
- [ ] Set `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET` (production keyset),
      `EBAY_VERIFICATION_TOKEN`, `EBAY_DELETION_ENDPOINT` — Production too (the
      deletion endpoint verifies signatures with them).
- [ ] Deployment Protection for previews. Remove any Netlify site still connected.
- [ ] First deploy: check the build log shows python3 available and ~4,000 output
      files deployed.
- [ ] Previews against the staging Supabase project need its host added to the CSP
      `connect-src` in `vercel.json` (it names production only).

### Sentry (optional; the site runs fine without it)
- [ ] Create the org/project, set the DSNs (US region — the CSP allows only
      `*.ingest.us.sentry.io`). Turn off "store IP addresses".

### Backups
- [ ] An R2 or B2 bucket with a 30-day lifecycle rule, a bucket-scoped key, an
      `age` keypair kept offline, and the `backups` GitHub environment.

## 2. Content and business decisions

### Copy (please approve)
The plans and marketing copy was rewritten to claim only what works today (deal
alerts and eBay scanning are listed as "On the way"). A test blocks phrases such
as "get deal alerts" or "before anyone else" from coming back. Review the plans
page, the home hero, the item upsell and the sign-in prompt, and adjust the
wording in `tools/build_data.py` (plans) or the page scripts.

### Jay's Retro Exchange hand-off
- [ ] Confirm the store's real search and offer URL patterns (`shop_search_url`,
      `shop_offer_url` in `BUSINESS`, `tools/build_data.py`). Until set, links go to
      the shop home page with UTM tags.
- [ ] Fill in the store's eBay and Mercari usernames in
      `tools/operator_identities.json` so its own sales are labelled and capped.
- [ ] Optional: set `meta.suggest_url` (form link or mailto) to turn on
      "Missing a bear? Tell us".

### Legal
- [ ] Review the sold-comps CSV before switching it on. To enable: set
      `COMPS_EXPORT_ENABLED=true` on the `export-comps` function, flip
      `comps_export` in `tools/build_data.py`, deploy the function. Also decides
      whether the per-item CSV on item pages comes back.
- [ ] Review showing sale links/listing IDs on item pages.
- [ ] Review the privacy page's new waitlist section and decide how long the list
      is kept. `terms.html` was not changed; a test fails if its coupon amounts stop
      matching the plan perks.

### Waitlist
- [ ] Verify on the deployed stack that the rightmost `x-forwarded-for` entry is
      the client as Supabase sees it (not a CDN in front); the per-IP limit relies
      on it.
- [ ] Review rows marked `held` (sign-ups past 120 an hour) before the launch email.
- [ ] Add a captcha or double opt-in if abuse appears.

### Pricing data
- [ ] Verify fees (eBay 13.6% + $0.40/$0.30 per order, Mercari 10%) and the NWOT
      and Mint multipliers (both 1.15) in `tools/domain_vocab.py`.
- [ ] Rule B: approve or reject re-grading 925 bare "new" rows from NWT to NWOT
      (largest per-item change +8.7%; see the tool's report).
- [ ] Pending duplicate decisions in `tools/catalogue_identity.json`: cheetah /
      cheetah-busch-gardens; coqui-frog / coqui-frog-lil-furry-friends;
      rainbow-sloth / rainbow-sloth-heartables; koala / koala-2007;
      hello-kitty-tropical / tropical-hello-kitty-2007, -2008; toothless /
      how-to-train-your-dragon-toothless-2014, -2019, -2025;
      black-labrador-retriever-puppy (comps look like Promise Pets).
- [ ] Confirm merge details: Harry Potter house years (2020 or 2021), Kennel Pals
      Calico Cat year (2001 or 2002), the Mothman merge, the 3 Zombie Pompompurin
      reassignments, Kennel Pals Black Lab (2008) comps.
- [ ] Not blocking: review queue (Care Bears Funshine/Grumpy; My Little Pony
      Minty, Celestia, Rainbow Dash, Twilight Sparkle); re-home Halloween,
      Disney100 and Tie-Dye comps on the generic Stitch; `tools/accessory_review.md`;
      `tools/catalogue_gaps.md`.

## 3. Known gaps (accepted for now)
- Opening `index.html` from disk (`file://`) is unsupported; use `npm start`.
- Two near-simultaneous first checkouts by the same new buyer can create two
  Stripe customers (rare; reconcile in Stripe if it happens).
- The Sentry environment label can read "production" on a mis-scoped preview.
- The CSP is static; per-environment CSP is a possible later change.

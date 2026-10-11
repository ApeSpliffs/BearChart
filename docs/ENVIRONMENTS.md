# Environments

BearChart runs in three places. Each one gets its own database, payment keys and
error-reporting tag, so a preview build can never write to production data or
take real money.

| | Local | Preview (staging) | Production |
|---|---|---|---|
| Site | `npm start` / `supabase start` | Vercel Preview deployments | Vercel Production (`main`) |
| Supabase | local CLI stack | project `bearchart-staging` | project `stfkxfhffblajqbbyqze` |
| Stripe | test keys, `stripe listen` | test-mode keys and test prices | live keys and live prices |
| Sentry `environment` | (off) | `preview` | `production` |
| PostHog | off (localhost) | off unless opted in | on |
| eBay deletion endpoint | n/a | expected to answer 500 "not configured" | `EBAY_VERIFICATION_TOKEN`, `EBAY_DELETION_ENDPOINT`, `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET` |

## How the browser learns its environment

`config.js` is committed empty (`window.BEARCHART_RUNTIME = {}`). At deploy time
`tools/build_site.sh` replaces `dist/config.js` with the output of
`tools/build_runtime_config.py`, which reads the variables below. It loads before
every other script; `auth.js` merges its `auth` block over the one in `site-config.js`
(built from `data.json` `config.auth` by `tools/build_assets.js`; read only through
`BearChartAuth.config()`),
`observability.js` reads `sentry_dsn`, and the PostHog snippet in `common.js` reads
`posthog_key` / `posthog_enabled`.

- **Preview with no Supabase variables:** accounts are switched **off**. A preview
  never talks to the production database by accident.
- **Production with no Supabase variables:** nothing is emitted, so the site uses
  `site-config.js`'s `auth` (from `data.json` `config.auth`) until the variables are set.
- **Only one of the two Supabase variables set:** the build fails.

Check a deploy with `curl https://<deploy>/config.js`.

**Returning visitors see a config change one page load late.** The service worker
precaches `config.js` and serves it stale-while-revalidate: the first load after a
deploy uses the cached copy and refreshes it in the background, and the next load
uses the new one. (The paywall/data workstream's service-worker rewrite makes the
runtime config network-first.) A brand-new visitor always gets the current file.

## Vercel variables

Set separately for the **Preview** and **Production** scopes.

| Variable | Preview | Production | Notes |
|---|---|---|---|
| `BEARCHART_ENV` | `preview` | `production` | Falls back to `VERCEL_ENV` |
| `BEARCHART_SUPABASE_URL` | staging URL | production URL | https only |
| `BEARCHART_SUPABASE_ANON_KEY` | staging anon key | production anon key | Public by design; RLS is the boundary |
| `BEARCHART_SENTRY_DSN` | DSN | DSN | Omit to keep error reporting off |
| `BEARCHART_POSTHOG_KEY` | optional | optional | Defaults to the key in `common.js` |
| `BEARCHART_POSTHOG_ON_PREVIEW` | `1` to opt in | — | Analytics are off on previews otherwise |

**Content-Security-Policy.** `vercel.json` sends one CSP for every deployment, and its
`connect-src` names only the production Supabase host (`https://` and `wss://`). A
preview pointed at the staging project needs the staging host added there too
(`https://<staging-ref>.supabase.co wss://<staging-ref>.supabase.co`) or sign-in on the
preview is blocked by the browser. A Sentry DSN must be on `*.ingest.us.sentry.io`
(the US region) to be allowed.
| `EBAY_VERIFICATION_TOKEN` | — | required | `api/ebay-deletion.js` |
| `EBAY_DELETION_ENDPOINT` | — | required | The public URL registered with eBay |
| `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET` | — | required | Production keyset; `api/ebay-deletion.js` uses them to fetch eBay's signing keys and verify each notification (unsigned POSTs get 412) |

Vercel provides `VERCEL_ENV`, `VERCEL_URL`, `VERCEL_PROJECT_PRODUCTION_URL` and
`VERCEL_GIT_COMMIT_SHA` (used as the error-report `release`) itself. The Node version
comes from `engines.node` in `package.json`.

## Sentry project settings

In each Sentry project, turn on **Settings → Security & Privacy → Prevent Storing of
IP Addresses** (owner TODO). The browser SDK already sends no default PII, scrubs
query strings and hashes, and identifies a signed-in user by account ID only; the
privacy page promises exactly that.

## Supabase function secrets (per project)

```bash
supabase secrets set --project-ref <ref> \
  STRIPE_SECRET_KEY=sk_test_...   STRIPE_WEBHOOK_SECRET=whsec_... \
  PRICE_PRO=price_...             PRICE_POWER=price_... \
  SITE_URL=https://<site>         BEARCHART_ENV=preview \
  SENTRY_DSN=https://...
```

| Secret | Staging | Production |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_...` | `sk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | test endpoint secret | live endpoint secret |
| `PRICE_PRO`, `PRICE_POWER` | test prices | live prices |
| `SITE_URL` | preview / staging URL | production URL |
| `BEARCHART_ENV` | `preview` | `production` |
| `SENTRY_DSN` | optional | optional |

`supabase/functions/_shared/env.ts` refuses a live Stripe key unless
`BEARCHART_ENV=production`, and a test key when it is `production`.
`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected by
Supabase.

## GitHub secrets and variables

| Name | Kind | Used by |
|---|---|---|
| `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET` | secret | `daily.yml` (refresh job, one step, env only) |
| `BOT_APP_ID` | variable (`production-data` env) | `daily.yml` publish job |
| `BOT_APP_PRIVATE_KEY` | secret (`production-data` env) | `daily.yml` publish job |
| `VERCEL_DEPLOY_HOOK_URL` | secret | `daily.yml` publish job (optional) |
| `BACKUP_DATABASE_URL`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ENDPOINT`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` | secrets (`backups` env) | `backup.yml` |
| `BACKUP_AGE_RECIPIENT` | variable (`backups` env) | `backup.yml` (public key only) |

## Promotion flow

1. Open a PR. `CI / ci-ok` runs `npm test`, and — when the paths changed — the
   Supabase job (migrations, lint, pgTAP RLS suite, idempotent re-apply) and the
   edge-function job (`deno task ci`).
2. Vercel builds a preview against **staging**. Check it.
3. Merge to `main`; Vercel deploys production.
4. Database changes: `supabase db push` to **staging** first, then production
   (see README, "Database migrations" — production needs a one-time
   reconciliation before its first push).
5. Edge functions: `supabase functions deploy <name>` to staging, test with
   `stripe listen`, then production.

## Local

```bash
cp .env.example .env          # local tooling only
npm run build:dev             # site-config.js, data/, item pages, sw.js from data.json
npm start                     # static site on :5173 (site-config.js config)
supabase start                # local Postgres/Auth/Storage with every migration
npm run test:db               # pgTAP RLS suite against it
npm run test:functions        # deno check + lint + tests for supabase/functions
```

## Pinned versions (quarterly review)

Dependabot keeps the GitHub Action SHAs and npm devDependencies current. These are
manual — review them each quarter:

| Pin | Where | Current |
|---|---|---|
| Supabase CLI | `.github/workflows/ci.yml`, `backup.yml` | 2.120.0 |
| Deno (= the edge runtime's) | `ci.yml` `DENO_VERSION` | 2.1.4 (edge-runtime v1.77.4) |
| Deno dependencies | `supabase/functions/deno.json` + `deno.lock` | `@sentry/deno` 11.5.0, `@std/assert` 1 |
| Sentry browser bundle + SRI | `observability.js` | 11.5.0 |
| Postgres major | `supabase/config.toml` `[db] major_version` | 17 (must match production) |
| Node / Python | `.nvmrc`, `.python-version` | 22, 3.9 |

To find the edge runtime's Deno for a CLI version: read
`apps/cli-go/pkg/config/templates/Dockerfile` at that CLI tag for the
`supabase/edge-runtime` image, then `docker run --rm
public.ecr.aws/supabase/edge-runtime:<tag> --version`. Regenerate
`supabase/functions/deno.lock` with that Deno version (it must stay readable by it).
To re-pin the Sentry bundle: `curl -sfL
https://browser.sentry-cdn.com/<v>/bundle.min.js | openssl dgst -sha384 -binary |
openssl base64 -A`.

# BearChart

**Build-A-Bear Price Guide** — Collector • Buy • Sell • Trade

An independent collector/reseller research tool. **Not affiliated with Build-A-Bear
Workshop.** Market values fluctuate.

Built as a collector and reseller research tool for Jay's Retro Exchange.

---

## The rule this project is built around

> **Completed sold transactions outrank active asking prices — always.**

BearChart will not tell you an item is worth $200 because somebody listed it at $200.
An asking price is a hope; a sold price is evidence. The engine refuses to treat
`active_listing` or `retail_reference` rows as market evidence, and a test fails the
build if that ever changes.

Its corollary: **no evidence, no price.** Most catalogued items have no sold comps yet.
They say "No sold data yet" and stay that way until a sourced sale arrives.

---

## Run it

```bash
npm start          # http://localhost:5173
```

No build step and no dependencies at runtime. `index.html` also opens straight off the
filesystem — the data ships as both `data.json` and `data.js` so it loads either way.

```bash
npm test           # full suite + duplicate audit, which fails the build
                   # if any name identifies two items
npm run icons:sheet # render every illustration to one PNG and look at it
npm run daily      # refresh asking prices, rebuild, verify, publish
npm run build      # regenerate data.json / data.js from tools/build_data.py
npm run sql        # regenerate seed.sql from data.json
```

`npm install` is only needed for the tests (jsdom).

---

## What's here

| File | What it is |
|---|---|
| `index.html` / `app.js` | Price guide: search, 7 filter groups, 8 sort orders, stats, calculator, CSV export |
| `deals.html` / `deals.js` | Deal finder: live asks below sold value, after fees |
| `checklists.html` / `checklists.js` | Collector checklists by line, era, exclusive and franchise |
| `item.html` / `item.js` | Item pages: valuation, reasoning, per-condition medians, every sold comp with provenance, price history |
| `collection.html` / `collection.js` | Collection tracker with conservative / median / high-end totals |
| `admin.html` / `admin.js` | Dashboard, data-quality gaps, entry forms, JSON + SQL export |
| `about.html` | The pricing method, stated plainly |
| `roadmap.html` / `roadmap.js` | What is built, planned, and not possible |
| `plans.html` / `plans.js` | Membership tiers and where each is enforced |
| `entitlements.js` | Tier logic — a UX hint, never the security boundary |
| `supabase/functions/` | Stripe checkout, billing portal, and webhook |
| `account.html` / `account.js` | Sign up, sign in, sign out, collection sync |
| `auth.js` | Supabase Auth wrapper — inert until configured |
| `engine.js` | The valuation engine. Pure functions, no DOM — ports unchanged to a backend |
| `common.js` | Shared formatting, search, CSV, page chrome |
| `icons.js` | 28 species illustrations, drawn as inline SVG |
| `data.json` / `data.js` | The database: every catalogued item and its sold observations |
| `item/*.html` | One generated page per item — what a search engine reads (`npm run pages`) |
| `supabase/migrations/` | Postgres schema with RLS, as ordered migrations (see "Database migrations") |
| `supabase/tests/database/` | pgTAP row-level-security tests (`npm run test:db`) |
| `config.js` / `observability.js` | Per-deploy runtime settings (inert as committed) and error reporting (inert without a DSN) |
| `seed.sql` | The research, as idempotent SQL inserts |
| `tools/build_data.py` | **The source of truth for the data.** Edit here, not in data.json |
| `tools/import_sales.py` | Bulk CSV importer for sold comps (Terapeak, hand-kept sheets) |
| `tools/import_my_sales.py` | Import your own completed sales — the strongest evidence |
| `tools/audit_duplicates.py` | Duplicate and ambiguous-name audit (`npm run audit`) |
| `tools/attach_images.py` | Bulk photo attachment |
| `tools/ebay_active.py` | eBay Browse API adapter — current asking prices |
| `tools/poll_engine.py` | Scheduled polling: shared query pool, heat tiers, quota budget |
| `tools/test_poll.py` | Scheduler tests (no network) |
| `tools/daily_update.sh` | Daily refresh: fetch, rebuild, verify, publish or roll back |
| `tools/README-automation.md` | cron / systemd / GitHub Actions setup |
| `tools/test_engine.js` | Engine + data-integrity tests |
| `tools/test_pages.js` | Page tests, rendered in jsdom |
| `tools/test_import.py` | Importer tests |
| `tools/test_ebay.py` | eBay adapter tests (fixtures, no network) |

---

## How a price is produced

1. Collect every sold observation for the **exact** item. Versions, variants and Vault
   reissues are separate items and are never averaged together.
2. Normalise each sale to a common baseline — Good condition, no extras — using the
   configured condition and completeness multipliers.
3. Drop outliers beyond 1.5× the IQR, but only once there are ≥5 sales. With three
   comps, the odd one out is often the real market.
4. Take the **median**. Never the mean, never a single sale.
5. Publish the 25th–75th percentile as the range; under four comps, show the full
   observed spread instead, because quartiles of three points are noise.
6. Derive buy (55–70%), trade (75–90%) and high-end ask (110–130%) from that value.
7. Assign confidence from the comp count: **10+ HIGH · 4–9 MEDIUM · 1–3 LOW · 0 VERY LOW**.

Every valuation carries a `why` array explaining itself, which is what the item page
renders under "Why this value".

### Deliberately not done

**No automatic rarity multiplier.** The handoff asks for a rarity adjustment but also
says "do not blindly multiply every item" — a $250 vintage employee exclusive and a $12
Mini Bean do not obey one formula. Rarity drives sorting and ranking; it does not
silently scale a price. When enough comps exist to measure a rarity premium empirically,
that belongs in the engine as measurement, not as a guessed constant.

**Multipliers are configuration, not code.** They live in `config` in `data.json` and in
the `valuation_config` table. Retune them without touching the engine.

---

## The data

The original seed was transcribed from the research in `BuildaBear1.md` §9–§12; the
figures below describe it at the time of that research. Nothing was invented and
nothing was thrown away.

- **5 sales are `completed_sale`** — full provenance: date, marketplace and eBay listing
  id. These are the five CollectionHero finds (Kennel Pals Calico Cat $250, Employee
  Exclusive Holiday Moose $100, McBearish $42.47, Polar Bear II $40, Vanilla Fudge Bunny
  $189.99).
- **The rest are `collector_report` or `historical_archive`** — real sold prices recorded
  during research, but without a date or listing id to stand behind them. They count as
  evidence; they don't count as *verified*. Items resting only on these are flagged.
- **Three observations were ranges**, not single transactions (Polar Bear V2 $19–30,
  Elmo $20–25, Hello Kitty Hawaiian $45–55). They're stored as ranges, contribute their
  midpoint, and say so.
- **Undated sales stay undated.** That's why most items have no price-history chart —
  a chart needs dated comps, and inventing dates to draw a prettier line is exactly the
  kind of thing this project exists to avoid.

The 2025 and 2026 Mini Beans collector-guide lists are catalogued as identification
entries with no comps — they populate the checklist and show up under "Needs comps".

## Showing the evidence, not just asserting it

A price here comes with its footing, and that footing used to be a grey pill
reading "LOW". Every priced item now draws it: the published range as a band,
the median as a line, and each recorded sale as a dot where it actually sits.

It is built for one or two observations, because that is what the database has
— **no item in it has three.** A single dot inside a wide band reads as *"we
know exactly one thing, and here is how much that leaves open"*, which is both
the truth and a better argument than apologising for it. A line chart fails at
that data volume; this does not.

Two rules it follows, each with a test:

- **Dots are the normalised price** — what entered the median after adjusting
  for condition and completeness — because plotting what a seller received
  against an adjusted median compares two different things. A $26 NWT sale
  appears at $20.80, and the caption says so.
- **The labels are the range ends, never the axis ends.** The axis is padded to
  give the drawing air; printing that padding would put a precise-looking figure
  under a price at which nothing happened.

`engine.js` exposes `valuation.points` for this — the comps that survived outlier
rejection. A comp the median ignored is never drawn as if it counted.

## The page with no price

Most items have no sold data, which makes this the most-viewed panel on
the site and the one a search result most often lands on. It used to be a warning
box and an apology.

It now leads with what *is* known — year, line, animal, franchise — and ends with
the one thing that would change it, linked to the submission form. It still
refuses to publish a price, and a test asserts there is no `$` anywhere on it.

## Collector submissions and problem reports

```
supabase db push   # applies every pending migration in supabase/migrations/,
                   # including 20261008000002_submissions.sql
```

Two ways for a reader to put something back: a sold price they know about, and a
problem they have spotted. Both appear on every item page; the review queue is on
the admin page.

**A submission is not a comp, and nothing in it can move a valuation.** Submitted
sales land in their own table with status `pending` and stay there. They reach the
price guide only when a reviewer accepts one and exports it as CSV into
`tools/import_sales.py` — the same importer every other observation goes through.
There is no path from *a stranger typed a number* to *the site publishes that
number*.

That matters more here than on most sites, because the operator buys and sells
the items being valued. A queue that fed straight into prices would be an open
invitation to talk a bear up before selling it, or down before buying one — and
the disclosure on every page would be worth nothing.

Supporting rules, each with a test in `tools/test_submissions.py`:

| Rule | Why |
|---|---|
| `completed_sale` cannot be self-claimed | It is the class the engine weighs most heavily; only a reviewer can apply it |
| The submitter is stamped from `auth.uid()` | Never read from the payload, so nobody can submit as someone else |
| A sale needs an account | A reviewer has to be able to ask; an anonymous price is a rumour |
| A report does not | Requiring one would cut reports to near zero, and a report costs nothing to check |
| Neither queue is publicly readable | Unreviewed prices on display are the thing this design avoids |
| One pending submission per person per item | Repeating a claim is not more evidence, it is more reviewing |

**Known gap, stated rather than papered over:** `report_item()` is callable
anonymously, so the reports table can be flooded. The damage is bounded — reports
are admin-read-only, the reason is a fixed enum and the note is capped at 500
characters, so a flood is a `delete` rather than a leak. If it is ever abused the
fix is a captcha, not an account requirement, which would cost more reports than
the spam does.

## Installable, and works with no signal

```
npm run pwa      # manifest.webmanifest + sw.js
npm run icons    # regenerate the app icons (rarely needed)
npm run test:offline
```

The job this site exists for happens in a thrift store, holding a bear, with one
bar of signal: *is this worth the four dollars they want for it?* A price guide
that needs a connection is no use at the moment you need it. The whole catalogue
is 82KB gzipped and the site is static files, so it all fits in a cache.

Installed from the browser ("Add to Home Screen"), BearChart opens, searches and
prices any bear in the catalogue in aeroplane mode.

**How the offline item pages work.** Precaching every generated page would be
megabytes, so they are cached as they are visited — but the thrift-shop case is
precisely a bear you have *never* visited. So the service worker serves
`item/_offline.html` for any uncached `/item/<slug>.html`. The address bar still
says which bear, `item.js` reads the slug from the path, and it renders from the
cached catalogue. One extra file covers every item.

**`npm run test:offline` is not part of `npm test`.** It drives a real Chrome over
the DevTools Protocol, cuts the network with `Network.emulateNetworkConditions`,
and then tries to price a bear — none of which jsdom can do, and all of which
needs a browser and a running server. It caught two bugs that looked like
nothing: a `Vary` mismatch, and a service worker registered with
`scope: "/index.html"` — a scope of one single file, so every page except the
home page silently had no offline support while a full cache sat there.

The cache name is a hash of what it precaches, so it changes when the content
changes and not when it doesn't. `tools/daily_update.sh` regenerates it after
every rebuild; skip that and installed visitors keep yesterday's catalogue
forever, which is how offline support quietly becomes stale support.

## Seeing it before shipping it

The test suite runs on jsdom, which has no layout engine. It will tell you the
markup is correct while the hero overlaps the search box, the card images are
clipped and an item page's illustration is a third of its frame — all three of
which actually happened, and none of which any test could see.

```
npm run shot -- http://localhost:5173/index.html shot.png
npm run shot -- http://localhost:5173/index.html phone.png --phone
```

It reports horizontal overflow as well as writing the image. Note that
`chrome --screenshot --window-size=390,844` does **not** give you a 390px layout
viewport — it renders at whatever width the platform hands the window and crops
the picture, which looks exactly like an overflow bug that is not there. The
tool sets device metrics over the DevTools Protocol instead. No dependencies:
Chrome comes from the puppeteer cache (`npx puppeteer browsers install chrome`)
and node has had a global `WebSocket` since v22.

## One page per bear

Every item used to live at `item.html?id=<slug>` and be drawn by JavaScript after
the page loaded. To a search engine that is **one** page — a whole catalogue of
bears that Google saw as a single empty document. People searching *"1997 build a
bear brown teddy value"* were typing the exact question this site answers and
could not find it.

`npm run pages` writes `item/<slug>.html` for every item, with the facts already
in the HTML: title, meta description, headings, the valuation and the comps
behind it. `item.js` still takes over once it runs — this is what is there
before it does.

**The honesty rule extends to the metadata.** A meta description is a published
claim, read by more people than the page itself: anyone who only ever sees the
search result. So an item with no sold comps says so in its title, its
description, its body and its structured data, and quotes no figure anywhere.
The structured data carries no `offers` either, on priced items included —
schema.org offers assert something is for sale at that price, BearChart sells
nothing, and a rich snippet is not worth a false statement. `tools/test_pages_seo.py`
holds all of that in place.

Both URL shapes work. `item/<slug>.html` is canonical; `item.html?id=<slug>` still
resolves, so older links do not rot. Internal links carry a `../` prefix worked
out at runtime rather than being root-relative, because the site also has to open
straight off disk and from a subdirectory.

**Before deploying:** set `site_url` in `tools/build_data.py` (or pass
`--base-url`). Without a site address no `sitemap.xml` is written and no
canonical link is emitted, deliberately — a sitemap full of wrong URLs is worse
than no sitemap.

**Catalogue expansion.** Built in two passes. First, 529 item identities
from the CollectionHero index, which §12 of the handoff names as a secondary reference.
Then 1400 more from [The Build-A-Bear Wiki](https://buildabearwiki.info/) (CC BY-SA 4.0),
read through its MediaWiki API in ~45 bulk requests rather than crawled page by page —
see `tools/fetch_wiki.py` and `tools/build_wiki_catalogue.py`.

Build-A-Bear's own claim is 2,000–2,500 distinct Furry Friends since 1997, so the
catalogue is now the whole known line rather than a sample of it.

**What crosses from the wiki, and what never does.** Identification only: name, year,
species, product line, franchise, exclusivity — all of it read off the wiki's own
category tags, none of it free text. No price, value or rarity rating is imported, ever.
A hobbyist wiki is not a price guide, and treating one as evidence would poison every
valuation on the site. Imported items therefore arrive with zero sales and report as
**VERY LOW** confidence, which is the honest answer: we know the bear exists and we do
not know what it is worth. Each one is a row a real comp can attach to later.

Hand-written entries always win. A wiki page whose name matches a curated item — by id,
canonical name, or alias, allowing for the "Teddy"/"Bear" filler collectors add and drop
at will — is skipped rather than merged.

The catalogue covers **every year from 1997 to 2026** and 98 franchises:

| Line | Count |
|---|---|
| Sanrio | 116 |
| MLB | 61 |
| My Little Pony | 45 |
| Harry Potter | 36 |
| Pokemon | 28 |
| Disney | 24 |
| WWF / Wildlife | 18 |
| How to Train Your Dragon | 18 |
| Star Wars | 17 |
| Girl Scouts | 16 |

Every one is **identification only** — the index confirms the item exists and sold, but
its gallery pages carry no per-item price, so **no price was recorded for any of them**.
A test asserts that a published value exists *if and only if* a sale does. Edition sizes
the index did show were captured (Chococat 56,000; Keroppi 66,000; Disney Princesses
1,500 each).

buildabear.com itself returns HTTP 403 to automated requests, so the official collector
guides could not be read. That is the site declining, and it was not worked around.

**Seven identification conflicts were found and deliberately left open**, each recorded
on its item page for a human to settle rather than guessed at:

- **Lucky Kitty** — the index lists one under *both* 1997 and 1999. Its listing titles are
  seller-written and disagree with each other, so the index does not settle the year.
- **Candy Corn Kitty** — the handoff says 2011, the index shows a 2010 limited edition.
- **Centennial Series** — a "first in series" 1999 release exists alongside the 2002
  Centennial Teddy; the series spans years.
- **Vulpix** — the 2017 employee exclusive is kept separate from the Alolan Vulpix retail
  release.
- Three zoo exclusives (Otter, Black Jaguar, Red Fox) that may or may not be the same
  products as WWF-series animals already catalogued.

There is a test asserting these stay documented.

**To add data in bulk**, use the CSV importer — this is the realistic route to volume:

```bash
npm run import -- comps.csv --dry              # preview, change nothing
npm run import -- comps.csv --marketplace eBay # import
python3 tools/import_sales.py --columns        # which headers are understood
```

It reads Terapeak exports, eBay Seller Hub downloads and hand-kept sheets, mapping
headers loosely (`Sold Price`, `Date Sold`, `Item Number` … all understood; anything odd
can be mapped with `--map sold_price='Avg Sold Price'`). What it enforces:

- A row becomes `completed_sale` **only** with a date, marketplace and listing id.
  Anything thinner is imported as `collector_report` — still sold data, never dressed
  up as verified.
- A title that doesn't confidently resolve goes to `<input>.unmatched.csv` rather than
  being attached to the wrong bear. Add `--fuzzy` to allow token matching, but it still
  declines when two items are close.
- Duplicates are rejected against both the database and the rest of the file.
- Negative and parenthesised figures (refunds, credits) are rejected, not turned into
  positive comps.

Imports land in `tools/imported_sales.json` and are merged on every `npm run build`, so
rebuilding never loses them and the researched seed data stays intact.

**To add data by hand:** edit the `ITEMS` / `SALES` tables in `tools/build_data.py`, then
`npm run build && npm test`. The admin page can also draft entries in the browser and
export them as JSON or SQL.

---

## Upcoming and current releases

Items can carry a release status, so the guide covers things before a secondary market
exists:

- **`upcoming`** — announced, not yet on sale. No value is published, and if a sale does
  appear against it the engine flags it: a pre-release sale is a pre-order or a scalped
  early copy, which is hype rather than a settled market.
- **`current`** — on sale at retail now. The engine warns that retail is a ceiling on
  what the secondary market will bear.
- Every tracked release cites the announcement it came from, and a test enforces that.

Seeded with the 2026 "Spooky Stuff You Love" Halloween collection (Jumping Spider,
Mystical Werewolf, Batty Kitty, Pumpkin Pal Teddy, Owloween Cauldron Mashimal and the
Halloween Mini Beans), the Frosted Animal Cookie collection, and the announced
**Werebears Take Tokyo** blind-box range — flagged with a warning that blind boxes create
per-character scarcity and must not be priced as one item.

Filter to them with **Upcoming release** / **At retail now** in the sidebar, or set the
status on any new item from the admin page.

## Making money from it

Two hooks are built and both are **off until you fill in `BUSINESS` in
`tools/build_data.py`**. Neither paywalls anything.

**1. Sell-to-us on every item page.** Every visitor looking up a bear is someone who owns
that bear and is wondering what to do with it. With the config on, item pages show what
Jay's Retro Exchange would pay — the same buy range the engine publishes to everyone,
from the same sold data — and a contact button. Free traffic becomes inventory at a known
margin.

**2. eBay affiliate links.** Set `ebay_campaign_id` and outbound listing links carry it.
Nothing else changes.

**The disclosure is not optional.** A guide that tells you what your bear is worth *and*
offers to buy it has an obvious conflict of interest. Both hooks carry a plain-English
disclosure, the method page grows a "Where our money comes from" section as soon as
either is live, and there are tests asserting that **turning them on does not move a
single valuation** and that an affiliate id cannot reorder or filter which listings are
shown. The trust is the only thing here a competitor cannot copy; protecting it is worth
more than any commission.

Not built, in rough order of what I would do next: paid collection-valuation reports
(the collection tracker already does the work — a PDF with comps and provenance is a
cheap impulse buy), then paid appraisals, which monetise your judgement rather than the
data and scale with reputation. A subscription tier is last, and the core lookup should
never go behind it — that is the traffic engine and the differentiator.

## How complete is the catalogue, really

**It is not complete, and it cannot be made complete from here.** Build-A-Bear has
produced somewhere in the region of 2,000-2,500 distinct Furry Friends since 1997. The
catalogue now holds the whole known line — every year from 1997 on — rather than a
sample of it. It is
Build-A-Bear has produced thousands of SKUs across 28 years and there is no source that
lists them all.

What stands in the way, concretely:

- **buildabear.com returns HTTP 403** to automated requests. The official collector
  guides and product pages cannot be read. That is the site declining, and it was not
  worked around.
- **CollectionHero indexes 53,096 eBay listings, not products.** Each keyword search
  returns 20 of them, and listing titles are written by sellers — which is precisely why
  this catalogue carries 22 documented year conflicts. Exhausting it would take thousands
  of requests, which is bulk scraping: forbidden by §34 of the handoff and not something
  worth doing to a small fan-run site.
- **No public Build-A-Bear product API exists**, official or third-party.

So the catalogue grows the way a real price guide grows: a keyword sweep at a time, plus
your own knowledge as somebody who handles this stock. Each new search term yields
roughly 10–20 identities and the yield falls as coverage rises — the later sweeps here
were already returning items that were mostly catalogued.

**The most valuable additions from here are yours, not a scraper's.** Anything you have
in hand, or have sold, is worth more to this database than another keyword page: it comes
with a year you can read off a tush tag, and a price that actually happened.

## Live data — what is and isn't possible

**Nothing in BearChart is live.** It is a database you feed, not a feed you watch.

That is not an implementation gap, it is the state of the market:

- eBay's `findCompletedItems` (Finding API) is **retired**.
- Sold data now lives behind the **Marketplace Insights API**, which eBay's own docs
  describe as *"restricted and not open to new users"* — a Limited Release, application
  only, in practice granted to major partners. It also only reaches back 90 days.
- eBay put sold listings behind a **login wall**, so scraping is both a terms violation
  (§34 of the handoff) and technically blocked.
- Mercari has no public API.

So the honest routes to volume are, in order of practicality:

1. **Terapeak, typed in by hand.** Terapeak (rebranded "Product Research" in Seller Hub)
   is free and shows up to 3 years of genuine sold data — but **it has no CSV export**.
   eBay's downloadable reports cover your own orders and listings, not market data. What
   Terapeak gives you on screen is an *average sold price across N sales*, and BearChart
   records exactly that: see "Research averages" below.
2. **eBay Browse API** for *active* listings — **built**, see below.
3. **Marketplace Insights**, if you ever get approved. The importer's normalisation and
   dedupe logic is where an adapter would plug in.

## Asking prices — the eBay Browse adapter

```bash
export EBAY_CLIENT_ID=...  EBAY_CLIENT_SECRET=...   # free, no approval needed
npm run ebay -- --limit 10 --dry                    # preview
npm run ebay -- --priced-only --limit 25            # fetch
npm run build
```

Get a key at [developer.ebay.com](https://developer.ebay.com) — create an application
and use the Production App ID and Cert ID. Browse is general release, unlike Marketplace
Insights.

**These are asking prices, and BearChart treats them as such.** They are stored with
`evidence_type: "active_listing"`, which the engine refuses as market evidence. Three
independent guards enforce that:

1. `active_listing` is absent from `market_evidence_types` in the config.
2. They are written to a **separate `active_listings` array**, not into `sales` at all.
3. The field is called `ask_price`, not `sold_price`, so the two cannot be confused
   even by a careless reader.

There are tests for each, including one that renders an item page with a $6,000 asking
price injected and asserts the published valuation does not move.

What they buy you is the **spread**. Item pages show median ask against the sold-data
value, and read it out: sellers asking well above market means they're dreaming; asking
below usually means the sold comps have gone stale and the market has moved.

`--priced-only` restricts the walk to items that already have sold comps, which is where
the comparison is meaningful.

## Pro-tier valuation depth

**Per-copy modifiers.** Two kinds, modelled differently on purpose:

- **Multiplicative** — scale with the item. Birth certificate ×1.15, hang tag ×1.10,
  tush tag missing ×0.70, unstuffed ×0.85, customised ×0.80.
- **Additive** — separately traded parts at their own price. A sound module is ~$7 and a
  scent chip ~$6 *whether they are in a $12 Mini Bean or a $250 exclusive*. Priced as a
  percentage, the same chip would be worth $25 in one and $1.50 in the other.

Stacked bonuses are capped at ×1.45, because multipliers compound silently
(1.15 × 1.10 × 1.25 × 1.15 = 1.82, a figure no comp supports). Losses are **not** capped —
a battered copy is allowed all the way down, since the floor is what the market says
rather than what a rule allows. The chain is itemised so any figure can be taken apart.

**Conservative floor.** Every valuation now carries a bootstrapped lower bound beside its
median. Under 5 comps it falls back to the observed floor; at n=1 to a documented haircut,
because a single sale carries no dispersion information at all. Deals are judged against
this, never the median — see below.

**Outlier rejection uses MAD**, not Tukey fences. Quartiles of six skewed prices are
mostly noise; median absolute deviation with a modified z-score (|z| > 3.5) is robust at
these sample sizes, and it refuses to filter at all below 5 comps or when dispersion is
zero.

## Portfolio history

The collection page records a snapshot each day it is opened, and reports two different
numbers because they answer different questions:

- **Raw change** — what the total did.
- **Market only** — time-weighted return, netting out what you bought and sold.

Buying a $100 bear in a flat market shows **+100% raw** and **0% market**. Showing only
the first would call going shopping "appreciation"; showing only the second hides that
the collection is genuinely worth more. Both, always.

Snapshots are immutable. When a 2019 comp turns up tomorrow it changes what we now think
that item was worth in 2019 — rewriting history to match would give a chart that changes
shape nightly and can never be reconciled with an export already filed.

**A static site can only snapshot on a visit**, so days you do not open the page leave
gaps. The panel says so rather than drawing a confident line through absent days.

## Insurance schedule

`Insurance schedule` and `Cover statement` on the collection page.

An adjuster is not buying the number, they are assessing whether it is **substantiated**.
So confidence, comp count, comparable date range and source URLs are columns, not
footnotes. **Replacement cost** is the median-derived value; **actual cash value** is the
conservative floor — the figure the evidence supports even read pessimistically.

Items with no comps are left **blank**, never zero. Zero is a claim.

The cover statement states plainly that this is not an appraisal and was not prepared by
a licensed appraiser — a regulated term in several jurisdictions, and one that buys
nothing.

## Polling engine

```bash
npm run poll -- --plan                      # the schedule and what it costs
npm run poll -- --watch add lucky-kitty     # 60-second polling for one item
npm run poll -- --once                      # run a cycle (needs eBay credentials)
```

**It polls the catalogue, not the users.** A production Browse key allows roughly 5,000
calls a day; one query polled every 60 seconds costs 1,440 of them, so the whole platform
affords about **three continuously-polled queries — in total, not per user**. Polling each
user's saved search dies at the fourth subscriber.

So alerts are canonicalised into a shared pool. Watched items get their own precise query;
everything else is grouped by franchise and matched back to individual items locally. On
the current catalogue that is **642 items → 70 queries covering all 642, at 28% of the
daily budget.** One person watching an item and a thousand people watching it cost the
same.

| Heat | Interval | Applies to |
|---|---|---|
| `hot` | 60s | Explicitly watched — you asked to be told |
| `warm` | 15m | Has sold comps, so an underpriced listing is computable |
| `cold` | daily | Catalogued but unpriceable — nothing could be said about a hit |

Cold is not neglect. An item with no comps cannot be judged underpriced, so polling it
hourly spends budget to produce listings nothing can be said about.

**Spend is metered by a token bucket, not a daily counter.** A counter lets the scheduler
burn the whole allowance by six in the evening — exactly when listings from other
timezones start landing. The bucket refills continuously, so the small hours are never
starved, and work that will not fit is reported as deferred rather than silently dropped.

Watching costs are stated when you add one: each hot query is ~1,440 calls/day, so
`--plan` will tell you when you are over budget rather than failing quietly at 3am.

A relist is not a discovery — `seen_listings` tracks first sighting and price changes, so
the same bear is not announced as a new find every time a seller re-posts it.

## Deal finder

```bash
npm run ebay -- --priced-only --limit 40   # refresh asking prices
npm run build
# then open the Deals page
```

Live eBay asks compared against what the sold data says the item is worth — **after
your fees and shipping**. A gross discount is not profit: an item worth $200 nets about
$164 once the marketplace takes its cut and you pay to ship it, and the margin column
shows that number, not the headline gap. Fee, shipping and threshold assumptions are
editable on the page and saved per browser.

Asks are judged against the **conservative floor, not the median**. That is the
structural fix for false positives on rare items: thin data widens the gap between floor
and median, so a sparse item must be a much better bargain before it appears. No
special-casing of "rare" is needed, because rarity expresses itself as variance.

Kennel Pals Calico Cat has one comp — median $200, floor $150. A $120 ask reads as a 40%
bargain against the median and is correctly rejected against the floor.

Two more rules, both tested:

- **No sold data, no deal.** An item nobody has a comp for cannot be underpriced, because
  nobody knows what it is worth.
- **The listing is priced as the condition it is in.** $90 for a NWT copy worth $250 is a
  deal; the same $90 for a played-with copy worth $100 is not, and is not flagged as one.

Every candidate carries its risks — thin evidence, no stated condition, a variant that
prices differently, still available at retail.

## Your own sales

```bash
npm run import:mine -- orders.csv --dry
npm run import:mine -- orders.csv --condition Good
```

eBay Seller Hub → Reports → Downloads → Orders. **This is the best data the database can
hold.** A comp read off a listing title is a guess about what was in the box; your own
sale is not — you knew the condition, what came with it, and what it cleared. Those rows
are marked `first_party` and the engine counts them as the strongest evidence there is,
above a third-party completed sale, because nothing had to be inferred. It is also data
no competitor can copy.

**Privacy:** an order report contains buyer names, addresses and email. The importer reads
a strict **allowlist** of columns — title, price, date, item number, quantity, condition —
and prints every column it ignored so you can see for yourself. There are tests asserting
that no buyer detail reaches the database.

Provenance still applies: knowing you sold it is not the same as recording how it can be
checked, so a row without a date and order number is imported as a collector report, not
a verified sale.

## Membership

Three tiers, **off until a payment provider is connected**. While off, everything that
can run in the browser is simply on, for everyone, with no account.

| | | |
|---|---|---|
| **Free** | $0 | Catalogue, valuations, checklists, local collection, deal finder, CSV |
| **Pro** | $7/mo | Collection sync, server-side portfolio history, archived insurance schedules |
| **Power** | $14/mo | Deal alerts, polling priority, outfit assembly, API access |

### Why the free tier is this generous

**You cannot paywall a static site.** `data.js` — the whole catalogue and every comp —
downloads to every visitor on page load. Anything computed from it happens on their
machine with data they already have, so a gate around the valuation engine is a lock on a
door with no wall attached; a devtools console steps round it in seconds.

So the split is not *basic versus good*. It is **what a browser can do alone** against
**what needs a server**: keeping a collection somewhere other than one browser, holding a
schedule re-servable years later, sending a notification, spending API quota. Those cost
real money to run, they can genuinely be enforced, and that is exactly the set worth
charging for. Tier by marginal cost, not by feature niceness.

`entitlements.js` decides what to **show**. It never decides what is **safe** — the file
says so at the top. Enforcement lives in `supabase/migrations/`: `current_tier()`,
`has_entitlement()`, and policies that refuse the request however it arrives. Collection
sync raises `collection sync requires a Pro membership` inside the function itself.

### Honest limits, stated before anyone pays

**Polling priority is shared, not personal.** The quota affords about **3 continuously
polled searches for the whole site** — not three each. So Power cannot promise 60-second
polling on anything you like; that breaks at the fourth customer. What it buys is priority
in a shared queue: a hundred members watching one bear share one fast query and all get
told at once. This is on the membership page, above the pricing, not in a footnote after.

A lapsed subscription reads as free immediately, but **a lapsed member keeps reading their
own history** — losing data you already created is a different decision from losing the
ability to add more, and it should be deliberate.

A client can only `select` its own subscription row. There is no client write policy,
because a client that could write that table could grant itself the top tier.

### Payments

Three Supabase edge functions in `supabase/functions/` — setup and a test-mode checklist
are in the README there.

The browser never sees the Stripe secret key, never names a price, and never says who it
is. All three are resolved server-side:

- **Checkout** takes a *plan name*. A caller who could pass a price id could pass the
  cheapest one and receive Power.
- **The buyer** comes from the Supabase JWT, not the request body, and is stamped onto
  the session as `client_reference_id`. That is the only link the webhook trusts.
- **The webhook verifies Stripe's signature before parsing the body.** An unverified
  webhook is an open endpoint that hands out memberships to anyone who finds the URL.
  It writes with the service role, which no client holds.
- **Replays are no-ops.** Stripe delivers at least once and retries anything non-2xx, so
  event ids are recorded first; a duplicate returns `duplicate: true` rather than
  granting a second month.
- **Cancelling is one click** via Stripe's billing portal. A product you can join in two
  clicks and must email to leave is a dark pattern, and unlawful in several places.

The security-critical shape of all of this is covered by tests, because the functions
themselves are Deno and cannot run here. **Nothing has been run against live Stripe** —
do the test-mode pass in `supabase/functions/README.md` before pointing anyone at a
checkout page.

## Accounts

**Live.** Project `stfkxfhffblajqbbyqze` in `us-east-1`; URL and publishable key are in
`AUTH` in `tools/build_data.py`. The site is still fully usable signed out.

Verified against the live database rather than assumed:

- Anonymous **write** to `items` is refused — `42501 new row violates row-level security`.
- A weak password is rejected **server-side** (`422 weak_password`), not just by the page.
- `add_collection_items` refuses an anonymous caller with `not signed in`.
- `is_admin()` returns `false` and `current_tier()` returns `'free'` for anon.

The database linter is clean of errors. Two warnings remain on purpose:
`current_tier()` and `is_admin()` are `SECURITY DEFINER` and callable by anon. Neither
can be changed — `is_admin()` is named in the `admins` table's own policy, so
`SECURITY INVOKER` would recurse for ever, and a role must hold `EXECUTE` on a function a
policy references or the policy stops evaluating. Both return nothing useful to a
stranger. `stripe_events` shows "RLS enabled, no policy", which is the deny-all intent.

**The catalogue is not seeded into Postgres.** `data.js` remains the source of truth for
the site, and the items only need to exist in the database for `collections` to
reference them. To load them, run `seed.sql` (1.3 MB) with the CLI:

```bash
psql "$DATABASE_URL" -f seed.sql
```

**Originally off by default.** Signed out, collections and
checklists live in the browser exactly as they do today.

```python
# tools/build_data.py
("auth", OrderedDict([
    ("enabled", True),
    ("supabase_url", "https://xxxx.supabase.co"),
    ("supabase_anon_key", "eyJhbGci..."),
])),
```

Then `npm run build`, and add yourself to the `admins` table with role `owner`.

**Real auth or none.** There is deliberately no client-side password check and no
"signed in" flag in `localStorage` — on a static site those are decoration anyone can set
from the console, and they are worse than nothing because they imply a protection that
does not exist. A test asserts no such flag is ever written.

Instead this wraps **Supabase Auth**, which runs from the browser against Supabase's
servers, so the site stays static while sessions are real JWTs. Email + password, magic
link, and password reset are all supported.

**The page is not the security.** Admin status is asked of the server (`admins` table),
never assumed, and every read and write is enforced by the row-level security policies in
`supabase/migrations/`. If someone skips the UI and calls the API directly, RLS still stops
them. The admin page says as much to a signed-in non-admin: *"the database will refuse
writes from this account, whatever this page shows."*

Uploading your browser collection to your account goes through an
`add_collection_items` function that stamps `auth.uid()` **server-side**, so a caller
cannot write rows into someone else's collection by passing a different user id.

**On the anon key:** it is public by design, ships in client code, and grants only what
RLS allows. The `service_role` key is the secret one and must never appear in anything a
browser can see — there is a test for that too.

## Duplicate audit

```bash
npm run audit          # full report
npm run audit -- --strict   # exit 1 if anything needs a decision (runs in npm test)
```

A duplicate is not cosmetic in a price guide: it **splits an item's comps across two
records, so both look thinner than the evidence really is.** Two records with three sales
each report LOW confidence; one record with six reports MEDIUM. The catalogue was largely
built from keyword sweeps over seller-written listing titles, which is exactly the process
that manufactures near-duplicates.

The audit sorts pairs into four buckets, and only the first two are work:

| Bucket | Meaning |
|---|---|
| **Ambiguous names** | One name matches two items — a functional bug, see below |
| **Needs a decision** | Undocumented and closely matching |
| **Flagged but unresolved** | Someone noticed the overlap and could not settle it from a listing title. These need eyes on the actual bear; a tush tag usually decides it |
| **Decided** | A note already explains why they stay apart — original vs Vault reissue, 2016 game vs 2024 film, Mini Bean vs full size |

It found a real bug. The importer's matcher used `setdefault`, so when two items shared a
name **the first one defined silently won** and every comp for that name landed on it,
possibly the wrong record, with nothing to notice. Three names were ambiguous: `Bubbles`
(a Heartables unicorn and a Powerpuff Girl), `Rainbow Sloth`, and `Unicorn of the Sea`
(shared by three narwhals). The matcher now prefers a canonical name over an alias and
**refuses to resolve a genuinely ambiguous one** rather than guessing; the aliases were
removed; and `npm test` fails if an ambiguous name ever reappears.

The 29 unresolved questions are listed on the admin page as a work queue.

## Checklists

Sets are derived from the catalogue itself, so they grow as the database does: Mini Beans,
Vault reissues, each era, employee/zoo/international/online/store exclusives, limited
editions, every franchise with four or more items, accessories, and what is out at retail
now. Tick what you own and it lands in your collection, so the totals there stay in step.

## Research averages

Terapeak does not hand you a list of transactions. It hands you "average sold price
$54.00, 12 sold". That is real evidence of twelve sales, and BearChart records it as
such rather than pretending it is one sale or throwing it away.

Set **sales averaged** to 12 in the admin form (or include a `Quantity Sold` column in a
CSV import). The row then:

- counts as **12 comparable sales** toward confidence, because twelve transactions
  really did happen;
- contributes **one number** to the median, because one average is all it tells us — the
  spread inside it is unknown and is not invented;
- can **never** be `completed_sale`, whatever else the row carries. An average is not a
  verified transaction. The admin form refuses it, the importer downgrades it, and a
  CHECK constraint in the schema rejects it.

Any valuation resting on an average says so, and warns that the published range is
narrower than reality.

## Updating daily

```bash
npm run daily
```

`tools/daily_update.sh` fetches current asking prices, rebuilds, runs the full suite,
and **only publishes if everything passes** — otherwise it restores the previous state
and exits non-zero. That rollback is tested: a deliberately failing suite was run against
a live tree and `data.json` came out byte-identical to where it started.

Set it up as a cron job, a systemd timer, or the included GitHub Actions workflow —
`tools/README-automation.md` has all three. On Actions (`.github/workflows/daily.yml`) a
read-only job fetches, builds (`npm run build:daily`) and runs `npm test`; only if that
passes does a separate job — which runs no repo code — commit the files listed in
`tools/daily_outputs.txt` to `main`, fast-forward only, so a Vercel deployment
redeploys itself daily. If `main` moved during the run, nothing is published.

**What refreshes daily: asking prices. What does not: sold prices, and therefore
valuations.** There is no API that will give us sold comps. A price guide that quietly
refreshed its valuations from asking prices would be worse than one that doesn't move —
it would be confidently wrong every morning. Sold data enters when you enter it.

## Photographs

No item ships with a photo, and none was invented. Each renders a deterministic monogram
tile reading "NO PHOTO YET", so a missing image looks intentional rather than broken.

Official Build-A-Bear product photography is copyrighted — both the admin form and
`tools/attach_images.py` refuse `buildabear.com` URLs.

**Generic stock photos were considered and rejected.** A stock teddy bear on the 2001
Kennel Pals Calico Cat would be a picture of a different object. Identification is a core
function of this database (§19, §20), and a wrong photo is worse than no photo: it makes
a collector confident about the wrong thing.

**What every item does have is an illustration.** `icons.js` holds 28 hand-built SVG
drawings — bear, cat, dog, bunny, dino, dragon, unicorn, axolotl, spider, penguin, shirt,
shoe, hat and so on — picked from the item's recorded species or category, tinted by a
hue derived from its id so each item looks consistent. Every tile is captioned
**ILLUSTRATION · NO PHOTO YET**, because a drawing of a bear on a bear record is honest
in a way a stranger's photograph would not be.

They were reviewed by eye, not just by test: `npm run icons:sheet` renders all 28 to a
single PNG. The first pass had a dragon that looked like a pig and a spider whose legs
read as whiskers; both were redrawn. Run it after touching `icons.js`.

To add real photographs:

```bash
python3 tools/attach_images.py --list > images.csv   # every item lacking a photo
# fill in the image_url column, then:
npm run images -- images.csv --dry
npm run images -- images.csv
npm run build
```

Credit and source are stored per image, so photo provenance survives like sale
provenance.

If you have eBay credentials, `npm run ebay -- --images` will attach listing photos to
items that have none, recording "eBay listing photo" as the credit and the listing as the
source. It never overwrites a photo you added. Treat it as a stopgap: eBay image URLs die
when the listing ends, so your own inventory photographs remain the durable answer.

---

## Deploying

**Vercel** (the only host). The project builds with `npm run build:site` into `dist/`
(vercel.json); `api/ebay-deletion.js` is deployed as a serverless function. Item pages,
sitemap and service worker are generated at build time, so deploying the repo without
the build command serves a site with no item pages. Environment variables:
`docs/ENVIRONMENTS.md`.

**Supabase:**

1. Apply `supabase/migrations/` with `supabase db push` (tables, indexes, RLS policies,
   `valuation_config` seed) — read "Database migrations" below first.
2. Run `seed.sql` to load the researched data. Re-running is safe — items upsert on
   `slug`, sales are guarded against duplicates.
3. Add yourself to `admins` with role `owner`.

Security posture: RLS is on for every table. Public gets `select` on items, sales and
config. Writes are admin-only, one policy per verb so nothing is granted by accident.
Collections are readable and writable only by their owner. A `completed_sale` row is
rejected by a CHECK constraint unless it carries date, marketplace and listing id — the
same rule the admin form enforces, so it holds even if a bad client gets through.

### Database migrations

All SQL lives in `supabase/migrations/`, applied in filename order by the Supabase CLI
(`supabase db push`; locally `supabase start` applies them). Re-running the
whole set in filename order is idempotent — it leaves the same end state, and CI
re-applies them all and re-runs the tests to prove it. Re-running a single older file on
its own is not guaranteed safe (a later migration may have altered what it creates). `supabase/tests/database/` holds the pgTAP
row-level-security suite (`npm run test:db` against a local `supabase start`).

| Range | Owner |
|---|---|
| `20261008000001`–`000010` | The original schema and migrations 02–10, moved here unchanged in effect |
| `20261008000011`–`000099` | Operations (`000011_save_showcase_details.sql` is reserved for the owner-exported function) |
| `20261008000100`+ | Security |
| `20261008000200`+ | Paywall / data |
| `20261008000300`+ | UX / waitlist |

**Before the first `supabase db push` to production:** production was built by pasting
these files, so it has no migration history. `supabase link --project-ref
stfkxfhffblajqbbyqze`; `supabase db pull` into a throwaway branch and diff it against
`supabase/migrations/` (known drift: the 7-argument `save_showcase` from migration 07);
commit any missing definitions as a new migration in the 000011–000099 range; then
`supabase migration repair --status applied 20261008000001 … 20261008000010` so only
newer migrations are pushed. Push to staging first.

### Moving to Next.js

The stack in the handoff is Next.js + Supabase + Vercel. This build is deliberately
static because the environment had no Node when it started — and because a static
version works *today*. The port is not a rewrite:

- `engine.js` moves across untouched (it's already dependency-free and DOM-free).
- `tools/test_engine.js` moves with it and keeps passing.
- Pages become routes; `data.js` becomes a Supabase query in a server component.
- The admin forms already validate exactly what the database constrains.

---

## Verified

Everything below was run, not assumed:

- **The full suite passes** (`npm test`) — the engine, the data's integrity, every page
  rendered in a real DOM with console errors treated as failures, the CSV importer, and
  the eBay adapter against fixtures.
- Every item renders well-formed, non-empty SVG, and all
  28 illustrations were rendered to a PNG and reviewed by eye.
- The daily refresh script was run end to end, and its rollback was verified by
  deliberately failing the suite: it exited non-zero and left `data.json` untouched.
- The importer was run end-to-end against a realistic Terapeak-shaped file: it matched
  noisy listing titles, downgraded rows lacking provenance, rejected a refund line,
  skipped a duplicate of an existing comp, and quarantined an unknown title. The demo
  rows were then deleted — they were invented prices and had no business in the data.
- Search, alias lookup, filters, all sort orders, both calculators, the collection
  tracker, the admin validation and both CSV exports are each covered by a test that
  drives the actual DOM.
- Every internal link and asset reference resolves; every card links to a real item.
- The dev server returns 200 for every page.

**Postgres is now exercised in CI:** every migration is applied to a local Supabase
stack, re-applied to prove it is idempotent, and checked by the pgTAP RLS suite in
`supabase/tests/database/` (known gaps are recorded there as `todo` tests). `seed.sql`
is still not loaded in CI.

**Not verified, and worth saying:** The eBay adapter has never run
against the live API — there are no credentials here — so its request shapes are written
to eBay's documented contract and tested against fixtures, but the first real call is
still ahead of it. The mobile breakpoints and the vintage palette are written with care
but unproven — check them in a browser before treating them as done. The migrations have
not been reconciled with production yet (see "Database migrations").

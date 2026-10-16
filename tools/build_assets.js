#!/usr/bin/env node
/*
 * Split data.json into what the browser actually loads.
 *
 *   node tools/build_assets.js [--out <dir>]      (npm run build:assets)
 *
 * data.json is the dataset of record (committed). Pages never load it. They
 * load, through bc-data.js:
 *
 *   site-config.js              the manifest: config, membership, business,
 *                               redirects, headline stats, and the URLs below.
 *                               Small, revalidated on every visit.
 *   data/h/index.<sha12>.json   every item (nulls stripped) with its valuation
 *                               SUMMARY (v) and sold conditions (sc). List pages
 *                               need nothing else, so none of them valuates.
 *   data/h/listings.<sha12>.json  active asking prices (the deal finder).
 *   data/h/plans.<sha12>.json   the plans page's copy: the feature catalogue,
 *                               who each tier is for, the coupon terms. Only
 *                               plans.html needs it, so it stays out of
 *                               site-config.js (which every page downloads).
 *   data/items/<id>.json        one item, its sales and listings, and up to 8
 *                               related items. Stable URL, revalidated (ETag).
 *   data/manifest.json          what was written, for build_pages/build_pwa and
 *                               tests. Not deployed.
 *
 * Valuations come from engine.js (E.summary(E.valuate(...))): the build and the
 * browser share one definition, and tools/test_assets.js pins them equal.
 * Output is deterministic for a given data.json (no clock, sorted keys where
 * order is not meaningful), so an unchanged catalogue keeps its hashes.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');
const SCHEMA = 2;
const RELATED_MAX = 8;
const RECENT_SALES = 10;
// Fail the build if the catalogue index stops being a quick download.
const INDEX_GZ_BUDGET = 200 * 1024;
// eBay user data. Never published (tools/build_data.py strips it first; this
// is defence in depth).
const USER_DATA_FIELDS = ['seller', 'seller_username', 'username', 'eiasToken', 'userId'];

function sha12(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);
}

function stripUserData(row) {
  const out = Object.assign({}, row);
  for (const f of USER_DATA_FIELDS) delete out[f];
  return out;
}

/** An item without its null, false and empty-array fields (index records). */
function compactItem(item) {
  const out = {};
  for (const k of Object.keys(item)) {
    const v = item[k];
    if (v === null || v === undefined || v === false) continue;
    if (Array.isArray(v) && !v.length) continue;
    out[k] = v;
  }
  return out;
}

function groupBy(rows, key) {
  const out = new Map();
  for (const r of rows || []) {
    const k = r[key];
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(r);
  }
  return out;
}

/** Everything the per-item views need, computed once per build. */
function context(data, E) {
  const sales = groupBy(data.sales, 'item_id');
  const listings = groupBy(data.active_listings, 'item_id');
  const vals = new Map();
  for (const i of data.items) vals.set(i.id, E.valuate(i, sales.get(i.id) || [], data.config));
  return { data, E, sales, listings, vals };
}

/** The distinct conditions an item has sold in (the index's condition filter). */
function soldConditions(sales) {
  return Array.from(new Set((sales || []).map((s) => s.condition).filter(Boolean))).sort();
}

/** The 10 most recently dated sale rows (the admin page's "recent" table). */
function recentSales(data) {
  return (data.sales || []).filter((s) => s.sale_date)
    .sort((a, b) => b.sale_date.localeCompare(a.sale_date) || String(a.id).localeCompare(String(b.id)))
    .slice(0, RECENT_SALES)
    .map((s) => ({ id: s.id, item_id: s.item_id, sale_date: s.sale_date, sold_price: s.sold_price,
                   marketplace: s.marketplace || null, listing_id: s.listing_id || null }));
}

function buildIndex(data, E, ctx) {
  ctx = ctx || context(data, E);
  return {
    schema: SCHEMA,
    generated_at: data.meta.built_at || null,
    // Admin-only, but the admin page loads the index anyway; kept out of
    // site-config.js, which every page downloads.
    recent_sales: recentSales(data),
    items: data.items.map((i) => Object.assign(compactItem(i), {
      v: E.summary(ctx.vals.get(i.id)),
      sc: soldConditions(ctx.sales.get(i.id))
    }))
  };
}

function buildListings(data) {
  return {
    fetched_at: data.active_listings_fetched_at || null,
    listings: (data.active_listings || []).map(stripUserData)
  };
}

/** Same rule the item page always used: same franchise or species, max 8. */
function relatedFor(item, items) {
  const out = [];
  for (const i of items) {
    if (out.length >= RELATED_MAX) break;
    if (i.id === item.id) continue;
    if ((item.franchise && i.franchise === item.franchise) ||
        (item.species && i.species === item.species)) {
      out.push({ id: i.id, canonical_name: i.canonical_name });
    }
  }
  return out;
}

/**
 * When an item's listings were fetched: the oldest of its rows. A row that
 * tools/ebay_active.py carried forward for a failed query keeps its own
 * fetched_at; every other row was fetched with the run.
 */
function listingsFetchedAt(rows, runAt) {
  let oldest = null;
  for (const r of rows) {
    const at = r.fetched_at || runAt || null;
    if (at && (oldest === null || at < oldest)) oldest = at;
  }
  return oldest || runAt || null;
}

function buildShard(data, id, ctx) {
  const item = data.items.find((i) => i.id === id);
  if (!item) return null;
  const rows = ctx.listings.get(id) || [];
  return {
    schema: SCHEMA,
    item: item,
    sales: (ctx.sales.get(id) || []).map(stripUserData),
    listings: (ctx.listings.get(id) || []).map(stripUserData),
    listings_fetched_at: rows.length ? listingsFetchedAt(rows, data.active_listings_fetched_at)
                                     : (data.active_listings_fetched_at || null),
    related: relatedFor(item, data.items),
    // Only the item page shows it, so it rides here, not in site-config.js.
    retail_reference: data.retail_reference || null
  };
}

function buildShards(data, E, ctx) {
  ctx = ctx || context(data, E);
  const out = {};
  for (const i of data.items) out[i.id] = buildShard(data, i.id, ctx);
  return out;
}

/** The headline numbers, from engine.catalogueStats plus what admin/roadmap show. */
function buildStats(data, E, ctx) {
  ctx = ctx || context(data, E);
  const st = E.catalogueStats(data.items, (id) => ctx.sales.get(id) || [],
    (id) => ctx.vals.get(id), data.config);
  const years = data.items.map((i) => i.release_year).filter((y) => !!y);
  return Object.assign(st, {
    sale_count: (data.sales || []).length,
    completed_sale_count: (data.sales || []).filter((s) => s.evidence_type === 'completed_sale').length,
    active_listing_count: (data.active_listings || []).length,
    has_first_party: (data.sales || []).some((s) => !!s.first_party),
    year_min: years.length ? Math.min.apply(null, years) : null,
    year_max: years.length ? Math.max.apply(null, years) : null
  });
}

// Membership keys only the plans page reads (see buildPlans).
const PLANS_ONLY = ['features', 'coupon_terms'];

/**
 * The plans page's copy, split out of the membership config: the feature
 * catalogue (cards, comparison, "On the way"), each tier's who-it's-for line
 * and the coupon terms. Perks, prices and entitlements stay in site-config.js,
 * because the nudge, the upsell and the gates need them on every page.
 */
function buildPlans(data) {
  const m = data.membership || {};
  const whoFor = {};
  for (const [id, p] of Object.entries(m.plans || {})) {
    if (p.who_for) whoFor[id] = p.who_for;
  }
  const out = { schema: SCHEMA, who_for: whoFor };
  for (const k of PLANS_ONLY) out[k] = m[k] === undefined ? null : m[k];
  return out;
}

/** The membership block for site-config.js: everything but the plans page's copy. */
function membershipConfig(m) {
  const out = Object.assign({}, m || {});
  for (const k of PLANS_ONLY) delete out[k];
  if (out.plans) {
    const plans = {};
    for (const [id, p] of Object.entries(out.plans)) {
      plans[id] = Object.assign({}, p);
      delete plans[id].who_for;
    }
    out.plans = plans;
  }
  return out;
}

/**
 * site-config.js's payload. `engine` is data.config without auth and features
 * (each has its own key); `data` points at the hashed files. Pages read all of
 * it through BearChartData.config().
 */
function buildSiteConfig(data, manifest, stats) {
  const engine = Object.assign({}, data.config);
  delete engine.auth;
  delete engine.features;
  // The fee schedule's "verify" notes are for the owner (README, build_data.py);
  // no page shows them, and every page downloads this file.
  if (engine.fees && engine.fees.platforms) {
    const platforms = {};
    for (const [k, p] of Object.entries(engine.fees.platforms)) {
      platforms[k] = Object.assign({}, p);
      delete platforms[k].verify;
    }
    engine.fees = Object.assign({}, engine.fees, { platforms });
  }
  return {
    schema: SCHEMA,
    meta: {
      name: data.meta.name, subtitle: data.meta.subtitle,
      schema_version: data.meta.schema_version, built_at: data.meta.built_at,
      site_url: data.meta.site_url, disclaimer: data.meta.disclaimer,
      disclaimer_short: data.meta.disclaimer_short || null,
      trademark_notice: data.meta.trademark_notice || null,
      suggest_url: data.meta.suggest_url || null,
      item_count: data.items.length, sale_count: (data.sales || []).length
    },
    engine: engine,
    auth: data.config.auth || {},
    features: data.config.features || {},
    membership: membershipConfig(data.membership),
    business: data.business || {},
    sources: data.sources || [],
    redirects: data.redirects || {},
    stats: stats,
    data: {
      index: manifest.index,
      listings: manifest.listings,
      plans: manifest.plans || null,
      items_base: 'data/items/'
    }
  };
}

function siteConfigJs(cfg) {
  return '/* Generated by tools/build_assets.js; read through bc-data.js. */\n' +
    'globalThis.BEARCHART_CONFIG = ' + JSON.stringify(cfg) + ';\n';
}

function rmrf(dir) { fs.rmSync(dir, { recursive: true, force: true }); }

/** Write every artefact under `out` (default: the repo root). Returns the manifest. */
function writeAll(data, E, out) {
  out = out || ROOT;
  const ctx = context(data, E);
  const hDir = path.join(out, 'data', 'h');
  const iDir = path.join(out, 'data', 'items');
  rmrf(hDir); rmrf(iDir);
  fs.mkdirSync(hDir, { recursive: true });
  fs.mkdirSync(iDir, { recursive: true });

  const indexText = JSON.stringify(buildIndex(data, E, ctx));
  const listingsText = JSON.stringify(buildListings(data));
  const plansText = JSON.stringify(buildPlans(data));
  const manifest = {
    index: 'data/h/index.' + sha12(indexText) + '.json',
    listings: 'data/h/listings.' + sha12(listingsText) + '.json',
    plans: 'data/h/plans.' + sha12(plansText) + '.json',
    items: {}
  };
  fs.writeFileSync(path.join(out, manifest.index), indexText);
  fs.writeFileSync(path.join(out, manifest.listings), listingsText);
  fs.writeFileSync(path.join(out, manifest.plans), plansText);

  for (const i of data.items) {
    const text = JSON.stringify(buildShard(data, i.id, ctx));
    manifest.items[i.id] = sha12(text);
    fs.writeFileSync(path.join(iDir, i.id + '.json'), text);
  }

  const cfgText = siteConfigJs(buildSiteConfig(data, manifest, buildStats(data, E, ctx)));
  fs.writeFileSync(path.join(out, 'site-config.js'), cfgText);
  manifest.config_sha = sha12(cfgText);
  manifest.index_gz = zlib.gzipSync(indexText, { level: 9 }).length;
  fs.writeFileSync(path.join(out, 'data', 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  return manifest;
}

function main(argv) {
  const at = argv.indexOf('--out');
  const out = at !== -1 ? path.resolve(argv[at + 1]) : ROOT;
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data.json'), 'utf8'));
  const E = require('../engine.js');
  const m = writeAll(data, E, out);
  const kb = (n) => (n / 1024).toFixed(1) + ' KB';
  console.log('wrote site-config.js, %s (%s gz), %s and %d item files',
    m.index, kb(m.index_gz), m.listings, Object.keys(m.items).length);
  if (m.index_gz > INDEX_GZ_BUDGET) {
    console.error('the catalogue index is %s gzipped, over the %s budget', kb(m.index_gz),
      kb(INDEX_GZ_BUDGET));
    process.exit(1);
  }
}

module.exports = {
  SCHEMA, USER_DATA_FIELDS, INDEX_GZ_BUDGET, compactItem, soldConditions, context,
  buildIndex, recentSales, buildListings, buildPlans, membershipConfig, PLANS_ONLY, listingsFetchedAt, buildShard, buildShards, buildStats, buildSiteConfig,
  siteConfigJs, relatedFor, writeAll, sha12
};

if (require.main === module) main(process.argv.slice(2));

/*
 * The browser's data files (tools/build_assets.js): complete, consistent with
 * the engine, small, and free of anything that must not be published.
 *
 *   node --test tools/test_assets.js
 *
 * Builds into a temporary directory from the committed data.json, so it needs
 * no prior build and never touches the working tree.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');
const A = require('./build_assets.js');
const E = require('../engine.js');

const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'data.json'), 'utf8'));
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'bearchart-assets-'));
const MANIFEST = A.writeAll(DATA, E, OUT);
process.on('exit', () => fs.rmSync(OUT, { recursive: true, force: true }));

const read = (p) => fs.readFileSync(path.join(OUT, p), 'utf8');
const INDEX = JSON.parse(read(MANIFEST.index));
const LISTINGS = JSON.parse(read(MANIFEST.listings));
const shard = (id) => JSON.parse(read('data/items/' + id + '.json'));
const salesOf = (id) => DATA.sales.filter((s) => s.item_id === id);

function siteConfig() {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(read('site-config.js'), sandbox);
  return JSON.parse(JSON.stringify(sandbox.BEARCHART_CONFIG));
}
const CFG = siteConfig();

test('every item has an index record and a shard', () => {
  assert.strictEqual(INDEX.items.length, DATA.items.length);
  assert.deepStrictEqual(INDEX.items.map((i) => i.id), DATA.items.map((i) => i.id));
  for (const i of DATA.items) {
    assert.ok(fs.existsSync(path.join(OUT, 'data', 'items', i.id + '.json')), i.id);
    assert.ok(MANIFEST.items[i.id], i.id + ' in the manifest');
  }
  assert.strictEqual(Object.keys(MANIFEST.items).length, DATA.items.length);
});

test('the index summary equals the engine run in the browser, for every item', () => {
  // Parity: the build and a browser valuating the same sales cannot disagree.
  const byId = new Map(INDEX.items.map((r) => [r.id, r]));
  for (const i of DATA.items) {
    const want = E.summary(E.valuate(i, salesOf(i.id), DATA.config));
    assert.deepStrictEqual(byId.get(i.id).v, JSON.parse(JSON.stringify(want)), i.id);
  }
});

test('index records keep every field a page reads, minus empty ones', () => {
  const byId = new Map(INDEX.items.map((r) => [r.id, r]));
  for (const i of DATA.items) {
    const rec = byId.get(i.id);
    for (const [k, v] of Object.entries(i)) {
      const empty = v === null || v === false || (Array.isArray(v) && !v.length);
      if (empty) assert.ok(!(k in rec), i.id + '.' + k + ' should be stripped');
      else assert.deepStrictEqual(rec[k], v, i.id + '.' + k);
    }
    assert.deepStrictEqual(rec.sc, Array.from(new Set(salesOf(i.id).map((s) => s.condition)
      .filter(Boolean))).sort(), i.id + ' sold conditions');
  }
});

test('the index carries no sales, and shards carry exactly their own', () => {
  assert.ok(!('sales' in INDEX));
  for (const r of INDEX.items) assert.ok(!('sales' in r), r.id);
  for (const i of DATA.items) {
    const s = shard(i.id);
    assert.deepStrictEqual(s.item, i, i.id);
    assert.deepStrictEqual(s.sales, salesOf(i.id), i.id + ' sales');
    for (const l of s.listings) assert.strictEqual(l.item_id, i.id);
    assert.strictEqual(s.listings.length,
      (DATA.active_listings || []).filter((l) => l.item_id === i.id).length, i.id + ' listings');
  }
  assert.strictEqual(LISTINGS.listings.length, (DATA.active_listings || []).length);
  assert.strictEqual(LISTINGS.fetched_at, DATA.active_listings_fetched_at || null);
});

test('related lists hold at most 8 items and never the item itself', () => {
  for (const i of DATA.items) {
    const rel = shard(i.id).related;
    assert.ok(rel.length <= 8, i.id);
    assert.ok(!rel.some((r) => r.id === i.id), i.id);
    for (const r of rel) assert.deepStrictEqual(Object.keys(r).sort(), ['canonical_name', 'id']);
  }
});

test('no eBay user data anywhere in the output', () => {
  const pattern = new RegExp('"(' + A.USER_DATA_FIELDS.join('|') + ')"');
  const files = [MANIFEST.index, MANIFEST.listings, 'site-config.js']
    .concat(DATA.items.map((i) => 'data/items/' + i.id + '.json'));
  for (const f of files) assert.doesNotMatch(read(f), pattern, f);
  // Defence in depth: a row that somehow still carries one is stripped.
  const dirty = JSON.parse(JSON.stringify(DATA));
  dirty.active_listings = [{ id: 'l1', item_id: DATA.items[0].id, seller: 'someone',
                             userId: 'u', evidence_type: 'active_listing', ask_price: 5 }];
  assert.doesNotMatch(JSON.stringify(A.buildListings(dirty)), pattern);
  assert.doesNotMatch(JSON.stringify(A.buildShard(dirty, DATA.items[0].id, A.context(dirty, E))), pattern);
});

test('hashed names match their content', () => {
  assert.match(MANIFEST.index, /^data\/h\/index\.[0-9a-f]{12}\.json$/);
  assert.match(MANIFEST.listings, /^data\/h\/listings\.[0-9a-f]{12}\.json$/);
  assert.ok(MANIFEST.index.includes(A.sha12(read(MANIFEST.index))));
  assert.ok(MANIFEST.listings.includes(A.sha12(read(MANIFEST.listings))));
  for (const i of DATA.items.slice(0, 50)) {
    assert.strictEqual(MANIFEST.items[i.id], A.sha12(read('data/items/' + i.id + '.json')));
  }
  assert.strictEqual(MANIFEST.config_sha, A.sha12(read('site-config.js')));
});

test('a rebuild from the same data.json is byte-identical', () => {
  const again = fs.mkdtempSync(path.join(os.tmpdir(), 'bearchart-assets-'));
  try {
    const m2 = A.writeAll(DATA, E, again);
    assert.deepStrictEqual(m2, MANIFEST);
    assert.strictEqual(fs.readFileSync(path.join(again, 'site-config.js'), 'utf8'), read('site-config.js'));
  } finally { fs.rmSync(again, { recursive: true, force: true }); }
});

test('site-config.js evaluates and points at files that exist', () => {
  assert.ok(CFG.auth && 'supabase_url' in CFG.auth, 'auth settings');
  assert.strictEqual(CFG.features.comps_export, false);
  assert.ok(!('auth' in CFG.engine) && !('features' in CFG.engine), 'engine config is the engine\'s only');
  assert.ok(CFG.engine.condition_multipliers && CFG.engine.recency.as_of);
  for (const [k, p] of Object.entries(CFG.engine.fees.platforms)) {
    assert.strictEqual(typeof p.pct, 'number', k);
    assert.ok(!('verify' in p), k + ': owner notes stay in data.json');
  }
  assert.strictEqual(CFG.data.index, MANIFEST.index);
  assert.strictEqual(CFG.data.listings, MANIFEST.listings);
  assert.ok(fs.existsSync(path.join(OUT, CFG.data.index)));
  assert.ok(fs.existsSync(path.join(OUT, CFG.data.listings)));
  assert.strictEqual(CFG.data.items_base, 'data/items/');
  assert.deepStrictEqual(CFG.redirects, DATA.redirects);
  assert.deepStrictEqual(CFG.membership, DATA.membership);
  assert.strictEqual(CFG.meta.item_count, DATA.items.length);
});

test('the headline stats are engine.catalogueStats, the same numbers data.json states', () => {
  const st = CFG.stats;
  for (const k of ['items', 'priced_items', 'sold_transactions', 'stale_items']) {
    assert.strictEqual(st[k], DATA.meta.stats[k], k);
  }
  // The browser sums index summaries for a filtered view; unfiltered, it must agree.
  const sum = E.catalogueStats(INDEX.items, null, (id) => INDEX.items.find((r) => r.id === id).v);
  assert.strictEqual(sum.sold_transactions, st.sold_transactions);
  assert.strictEqual(sum.priced_items, st.priced_items);
  assert.strictEqual(st.sale_count, DATA.sales.length);
  assert.strictEqual(st.sold_records, DATA.sales.length);
  assert.strictEqual(st.completed_sale_count,
    DATA.sales.filter((s) => s.evidence_type === 'completed_sale').length);
  assert.strictEqual(st.active_listing_count, (DATA.active_listings || []).length);
  assert.ok(!('recent_sales' in st), 'admin-only rows stay out of site-config.js');
  assert.ok(!('retail_reference' in CFG), 'item-page-only data stays out of site-config.js');
  const recent = INDEX.recent_sales;
  assert.ok(recent.length > 0 && recent.length <= 10);
  for (let k = 1; k < recent.length; k++) assert.ok(recent[k - 1].sale_date >= recent[k].sale_date);
  assert.deepStrictEqual(shard(DATA.items[0].id).retail_reference, DATA.retail_reference);
});

test('the downloads stay small', () => {
  const gz = (t) => zlib.gzipSync(t, { level: 9 }).length;
  const indexGz = gz(read(MANIFEST.index));
  const cfgGz = gz(read('site-config.js'));
  assert.ok(indexGz < 160 * 1024, 'index ' + indexGz + ' bytes gzipped');
  // 1 KB of headroom under the 6 KB budget is kept for the UX workstream.
  assert.ok(cfgGz < 5 * 1024, 'site-config ' + cfgGz + ' bytes gzipped');
  const biggest = Math.max(...DATA.items.map((i) =>
    fs.statSync(path.join(OUT, 'data', 'items', i.id + '.json')).size));
  assert.ok(biggest < 40 * 1024, 'largest shard ' + biggest + ' bytes');
});

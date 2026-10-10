/*
 * Engine tests. Run with:  node tools/test_engine.js
 * No dependencies - uses node:test and node:assert from the standard library.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const E = require('../engine.js');
const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data.json'), 'utf8'));
const CFG = DATA.config;

const salesFor = (id) => DATA.sales.filter((s) => s.item_id === id);
const itemById = (id) => DATA.items.find((i) => i.id === id);
const valueOf = (id) => E.valuate(itemById(id), salesFor(id), CFG);

// ---- statistics ------------------------------------------------------------

test('median of an odd-length set is the middle value', () => {
  assert.strictEqual(E.median([5, 1, 3]), 3);
});

test('median of an even-length set interpolates the middle pair', () => {
  assert.strictEqual(E.median([1, 2, 3, 4]), 2.5);
});

test('median ignores input order', () => {
  assert.strictEqual(E.median([64, 48, 55, 52, 59]), 55);
});

test('percentile interpolates between neighbours', () => {
  assert.strictEqual(E.percentile([10, 20, 30, 40], 0.25), 17.5);
});

test('outlier rejection stays off small samples', () => {
  // With three points there is no distribution; filtering here would just delete
  // whichever comp is least like the other two.
  const r = E.madOutliers([10, 12, 400], 5);
  assert.strictEqual(r.rejected.length, 0);
  assert.strictEqual(r.note, 'too_few_to_filter');
});

test('MAD rejection engages once there are enough points', () => {
  const r = E.madOutliers([10, 11, 12, 13, 400], 5);
  assert.strictEqual(r.rejected.length, 1);
  assert.strictEqual(r.rejected[0].value, 400);
  assert.ok(Math.abs(r.rejected[0].z) > 3.5);
});

test('identical prices are never treated as outliers', () => {
  // MAD of a flat sample is 0, which would make every deviation infinite.
  const r = E.madOutliers([50, 50, 50, 50, 50], 5);
  assert.strictEqual(r.rejected.length, 0);
  assert.strictEqual(r.note, 'zero_dispersion');
});

test('the filter is abandoned rather than gutting the sample', () => {
  const r = E.madOutliers([1, 2, 100, 200, 300], 5);
  assert.ok(r.kept.length >= 3, 'never reduce a sample below three comps');
});

// ---- normalisation ---------------------------------------------------------

test('a NWT sale normalises down to the Good baseline', () => {
  const s = { sold_price: 125, condition: 'NWT', completeness: 'bare' };
  assert.strictEqual(E.normalisedPrice(s, CFG), 100);
});

test('a complete-with-extras sale normalises down by the completeness multiplier', () => {
  const s = { sold_price: 115, condition: 'Good', completeness: 'complete' };
  assert.ok(Math.abs(E.normalisedPrice(s, CFG) - 100) < 1e-9);
});

test('an unrecorded condition does not move the price', () => {
  const s = { sold_price: 42, condition: 'Unknown', completeness: 'unknown' };
  assert.strictEqual(E.normalisedPrice(s, CFG), 42);
});

test('a ranged research note contributes its midpoint', () => {
  assert.strictEqual(E.effectivePrice({ sold_price: 19, price_high: 30, ranged: true }), 24.5);
});

// ---- confidence ------------------------------------------------------------

test('confidence tiers follow the handoff thresholds', () => {
  assert.strictEqual(E.confidenceFor(12, CFG), 'HIGH');
  assert.strictEqual(E.confidenceFor(10, CFG), 'HIGH');
  assert.strictEqual(E.confidenceFor(9, CFG), 'MEDIUM');
  assert.strictEqual(E.confidenceFor(4, CFG), 'MEDIUM');
  assert.strictEqual(E.confidenceFor(3, CFG), 'LOW');
  assert.strictEqual(E.confidenceFor(1, CFG), 'LOW');
  assert.strictEqual(E.confidenceFor(0, CFG), 'VERY LOW');
});

// ---- the core rule: no evidence, no price ----------------------------------

test('an item with no sales publishes no value', () => {
  const v = valueOf('floppy-kitty');
  assert.strictEqual(v.has_value, false);
  assert.strictEqual(v.fair_market, null);
  assert.ok(v.caveats.includes('no-data'));
});

test('active listings are never treated as market evidence', () => {
  const item = { id: 'x' };
  const sales = [
    { id: 'a', sold_price: 500, evidence_type: 'active_listing', condition: 'Good', completeness: 'bare' },
    { id: 'b', sold_price: 500, evidence_type: 'retail_reference', condition: 'Good', completeness: 'bare' }
  ];
  const v = E.valuate(item, sales, CFG);
  assert.strictEqual(v.has_value, false, 'asking prices must not produce a value');
  assert.strictEqual(v.total_observations, 2);
  assert.strictEqual(v.comparable_count, 0);
});

test('a completed sale does produce a value', () => {
  const v = E.valuate({ id: 'x' }, [
    { id: 'a', sold_price: 50, evidence_type: 'completed_sale', condition: 'Good', completeness: 'bare' }
  ], CFG);
  assert.strictEqual(v.has_value, true);
  assert.strictEqual(v.fair_market, 50);
  assert.strictEqual(v.strong_evidence_count, 1);
});

// ---- valuation behaviour ---------------------------------------------------

test('the median resists a single high outlier', () => {
  const sales = [30, 32, 31, 33, 900].map((p, i) => ({
    id: 'c' + i, sold_price: p, evidence_type: 'completed_sale',
    condition: 'Good', completeness: 'bare'
  }));
  const v = E.valuate({ id: 'x' }, sales, CFG);
  assert.strictEqual(v.excluded_outliers.length, 1);
  assert.ok(v.fair_market < 40, 'a $900 fluke must not drag the value up');
});

test('condition grades are reported separately, not blended away', () => {
  const v = valueOf('loveable-lamb');
  assert.strictEqual(v.by_condition.NWT.count, 1);
  assert.strictEqual(v.by_condition.NWT.median, 204.49);
  assert.strictEqual(v.by_condition.Good.median, 45);
});

test('buy sits below fair market and high ask sits above it', () => {
  const v = valueOf('original-pumpkin-kitty');
  assert.ok(v.buy_high < v.fair_market, 'buy price must be under FMV');
  assert.ok(v.trade_high < v.ask_low, 'trade must sit under the high-end ask');
  assert.ok(v.ask_low > v.fair_market, 'high-end ask must exceed FMV');
});

test('band arithmetic matches the configured percentages', () => {
  const v = valueOf('original-pumpkin-kitty');
  assert.ok(Math.abs(v.buy_low - v.fair_market * CFG.bands.buy[0]) < 1e-9);
  assert.ok(Math.abs(v.ask_high - v.fair_market * CFG.bands.high_ask[1]) < 1e-9);
});

test('an item with two comps reports LOW confidence and the full spread', () => {
  const v = valueOf('grey-panda-mini-beans');
  assert.strictEqual(v.comparable_count, 2);
  assert.strictEqual(v.confidence, 'LOW');
  assert.ok(v.range_low < v.range_high, 'the $11/$26 split must remain visible');
});

test('a valuation always explains itself', () => {
  const v = valueOf('lucky-kitty');
  assert.ok(v.why.length > 0);
  assert.ok(v.why[0].includes('median'));
});

test('comps lacking provenance are flagged as weaker evidence', () => {
     const v = valueOf('loveable-lamb');
  assert.strictEqual(v.strong_evidence_count, 0);
  assert.ok(v.caveats.includes('no-strong-evidence'));
});

test('a lot is flagged as an invalid single-item comparable', () => {
  const v = valueOf('hello-kitty-my-melody-pink-wink-lot-of-3');
  assert.ok(v.caveats.includes('lot'));
});

test('a product line is not a variant; a version or a variant parent is', () => {
  const sales = [{ id: 'a', sold_price: 20, evidence_type: 'completed_sale', condition: 'Good' }];
  assert.ok(!E.valuate({ id: 'x', line: 'Promise Pets' }, sales, CFG).caveats.includes('variant'));
  assert.ok(E.valuate({ id: 'x', version: 'II' }, sales, CFG).caveats.includes('variant'));
  assert.ok(E.valuate({ id: 'x', variant_of: 'p' }, sales, CFG).caveats.includes('variant'));
  assert.ok(E.valuate({ id: 'x', has_variants: true }, sales, CFG).caveats.includes('variant'));
  assert.ok(DATA.items.every((i) => !('variant' in i)), 'variant was renamed to line');
});

test('a versioned item warns against averaging versions', () => {
  const v = valueOf('vanilla-fudge-bunny');
  assert.ok(v.caveats.includes('variant'));
});

// ---- calculator ------------------------------------------------------------

test('the calculator scales a valuation by condition and completeness', () => {
  const v = valueOf('original-pumpkin-kitty');
  const a = E.adjust(v, 'NWT', 'complete', CFG);
  assert.ok(Math.abs(a.multiplier - 1.25 * 1.15) < 1e-9);
  assert.ok(a.fair_market > v.fair_market);
});

test('a poor-condition copy is worth less than the baseline', () => {
  const v = valueOf('original-pumpkin-kitty');
  assert.ok(E.adjust(v, 'Poor', 'bare', CFG).fair_market < v.fair_market);
});

test('the calculator declines to price an item with no comps', () => {
  assert.strictEqual(E.adjust(valueOf('floppy-kitty'), 'Mint', 'complete', CFG), null);
});

// ---- history and collections ----------------------------------------------

test('price history only uses dated sales', () => {
  // Expect one point per year that has a dated sale - and none for undated ones.
  const sales = salesFor('vanilla-fudge-bunny');
  const years = [...new Set(sales.filter((s) => s.sale_date)
    .map((s) => Number(String(s.sale_date).slice(0, 4))))].sort();
  const h = E.priceHistory(sales, CFG);
  assert.ok(years.length > 0);
  assert.deepStrictEqual(h.map((p) => p.year), years);
});

test('undated research yields no chartable history', () => {
     assert.strictEqual(E.priceHistory(salesFor('loveable-lamb'), CFG).length, 0);
});

test('collection totals separate priced from unpriced items', () => {
  const total = E.collectionValue([
    { valuation: valueOf('original-pumpkin-kitty'), qty: 2 },
    { valuation: valueOf('floppy-kitty'), qty: 1 }
  ]);
  assert.strictEqual(total.priced, 2);
  assert.strictEqual(total.unpriced, 1);
  assert.ok(total.conservative <= total.median && total.median <= total.high);
});

// ---- data integrity --------------------------------------------------------

test('every sale points at a real item', () => {
  const ids = new Set(DATA.items.map((i) => i.id));
  for (const s of DATA.sales) assert.ok(ids.has(s.item_id), 'orphan sale: ' + s.id);
});

test('item ids are unique', () => {
  assert.strictEqual(new Set(DATA.items.map((i) => i.id)).size, DATA.items.length);
});

test('sale ids are unique', () => {
  assert.strictEqual(new Set(DATA.sales.map((s) => s.id)).size, DATA.sales.length);
});

test('every sale carries a positive price and a known condition', () => {
  for (const s of DATA.sales) {
    assert.ok(s.sold_price > 0, 'bad price on ' + s.id);
    assert.ok(CFG.condition_order.includes(s.condition), 'unknown condition on ' + s.id);
    assert.ok(CFG.completeness_multipliers[s.completeness] != null,
      'unknown completeness on ' + s.id);
  }
});

test('every sale is sold evidence, never an asking price', () => {
  for (const s of DATA.sales) {
    assert.notStrictEqual(s.evidence_type, 'active_listing');
    assert.ok(CFG.market_evidence_types.includes(s.evidence_type), 'bad evidence on ' + s.id);
  }
});

test('sales claiming completed_sale carry full provenance', () => {
  for (const s of DATA.sales.filter((x) => x.evidence_type === 'completed_sale')) {
    assert.ok(s.sale_date, 'completed_sale without a date: ' + s.id);
    assert.ok(s.marketplace, 'completed_sale without a marketplace: ' + s.id);
    assert.ok(s.listing_id, 'completed_sale without a listing id: ' + s.id);
  }
});

test('the five researched eBay sales survived into the data', () => {
  const byListing = Object.fromEntries(DATA.sales.filter((s) => s.listing_id)
    .map((s) => [s.listing_id, s]));
  assert.strictEqual(byListing['364353106238'].sold_price, 250);
  assert.strictEqual(byListing['174799040558'].sold_price, 100);
  assert.strictEqual(byListing['303276414389'].sold_price, 42.47);
  assert.strictEqual(byListing['164576943954'].sold_price, 40);
  assert.strictEqual(byListing['276842550193'].sold_price, 189.99);
});

test('every item can be valued without throwing', () => {
  for (const item of DATA.items) {
    const v = E.valuate(item, salesFor(item.id), CFG);
    assert.ok(v.confidence);
    if (v.has_value) assert.ok(v.fair_market > 0, 'non-positive value for ' + item.id);
  }
});

// ---- ask vs sold spread ----------------------------------------------------

const activeListing = (price) => ({ evidence_type: 'active_listing', ask_price: price });

test('the ask spread compares asking prices without ever pricing from them', () => {
  const v = valueOf('original-pumpkin-kitty');
  const s = E.askSpread(v, [activeListing(90), activeListing(110), activeListing(100)]);
  assert.strictEqual(s.count, 3);
  assert.strictEqual(s.median_ask, 100);
  assert.strictEqual(s.fair_market, v.fair_market);
  // The valuation itself is untouched by the listings.
  assert.strictEqual(valueOf('original-pumpkin-kitty').fair_market, v.fair_market);
});

test('a large premium is reported as sellers asking above market', () => {
  const v = valueOf('original-pumpkin-kitty');
  const s = E.askSpread(v, [activeListing(v.fair_market * 2)]);
  assert.strictEqual(s.reading, 'asking-above-market');
  assert.ok(s.premium_pct > 90);
});

test('asks below the sold data are flagged as a stale-comps signal', () => {
  const v = valueOf('original-pumpkin-kitty');
  const s = E.askSpread(v, [activeListing(v.fair_market * 0.5)]);
  assert.strictEqual(s.reading, 'asking-below-market');
  assert.ok(s.premium_pct < 0);
});

test('asks close to the sold data read as in line', () => {
  const v = valueOf('original-pumpkin-kitty');
  assert.strictEqual(E.askSpread(v, [activeListing(v.fair_market)]).reading, 'in-line');
});

test('the ask spread ignores anything that is not an active listing', () => {
  const v = valueOf('original-pumpkin-kitty');
  assert.strictEqual(E.askSpread(v, [{ evidence_type: 'completed_sale', ask_price: 500 }]), null);
});

test('no spread is reported for an item with no published value', () => {
  assert.strictEqual(E.askSpread(valueOf('floppy-kitty'), [activeListing(50)]), null);
});

test('active listings live outside the sales array entirely', () => {
  for (const s of DATA.sales) assert.notStrictEqual(s.evidence_type, 'active_listing');
  for (const l of DATA.active_listings || []) {
    assert.strictEqual(l.evidence_type, 'active_listing');
    assert.strictEqual(l.sold_price, undefined);
  }
});

test('feeding active listings to valuate() still produces no value', () => {
  const v = E.valuate({ id: 'x' }, [
    { id: 'a', evidence_type: 'active_listing', sold_price: 999,
      condition: 'Good', completeness: 'bare' }
  ], CFG);
  assert.strictEqual(v.has_value, false);
});

// ---- catalogue integrity ---------------------------------------------------

test('catalogued items without comps publish no price', () => {
  const noComps = DATA.items.filter((i) => salesFor(i.id).length === 0);
  assert.ok(noComps.length > 0);
  for (const item of noComps) {
    const v = E.valuate(item, [], CFG);
    assert.strictEqual(v.has_value, false, item.id + ' should have no value');
    assert.strictEqual(v.confidence, 'VERY LOW');
  }
});

test('every item has a unique, url-safe id', () => {
  for (const i of DATA.items) {
    assert.match(i.id, /^[a-z0-9-]+$/, 'unsafe id: ' + i.id);
  }
});

test('licensed items name their franchise', () => {
  for (const i of DATA.items.filter((x) => x.licensed)) {
    assert.ok(i.franchise, 'licensed item without a franchise: ' + i.id);
  }
});

// ---- aggregate observations (Terapeak-style averages) ----------------------

const agg = (price, n) => ({
  id: 'agg', sold_price: price, sample_size: n, evidence_type: 'collector_report',
  condition: 'Good', completeness: 'bare'
});

test('an average across N sales counts as N comps for confidence', () => {
  const v = E.valuate({ id: 'x' }, [agg(54, 12)], CFG);
  assert.strictEqual(v.comparable_count, 12);
  assert.strictEqual(v.confidence, 'HIGH');
  assert.strictEqual(v.observation_count, 1);
  assert.strictEqual(v.aggregate_count, 1);
});

test('an average still contributes only one number to the median', () => {
  // The spread inside an average is unknown, so it is not invented.
  const v = E.valuate({ id: 'x' }, [agg(54, 12)], CFG);
  assert.strictEqual(v.fair_market, 54);
  assert.strictEqual(v.range_low, 54);
  assert.strictEqual(v.range_high, 54);
});

test('a valuation resting on an average says so', () => {
  const v = E.valuate({ id: 'x' }, [agg(54, 12)], CFG);
  assert.ok(v.caveats.includes('aggregate'));
  assert.ok(v.why.some((w) => /average/i.test(w) && /12 transactions/.test(w)));
});

test('aggregates and single sales combine correctly', () => {
  const v = E.valuate({ id: 'x' }, [
    agg(50, 8),
    { id: 'b', sold_price: 60, evidence_type: 'completed_sale',
      condition: 'Good', completeness: 'bare' }
  ], CFG);
  assert.strictEqual(v.comparable_count, 9);   // 8 + 1
  assert.strictEqual(v.observation_count, 2);  // two price points
  assert.strictEqual(v.fair_market, 55);       // median of 50 and 60
});

test('sample_size defaults to one and ignores nonsense', () => {
  assert.strictEqual(E.sampleSize({}), 1);
  assert.strictEqual(E.sampleSize({ sample_size: 0 }), 1);
  assert.strictEqual(E.sampleSize({ sample_size: -3 }), 1);
  assert.strictEqual(E.sampleSize({ sample_size: 'twelve' }), 1);
  assert.strictEqual(E.sampleSize({ sample_size: 7.9 }), 7);
});

test('no seeded sale claims to be an aggregate completed sale', () => {
  for (const s of DATA.sales) {
    if (s.sample_size && s.sample_size > 1) {
      assert.notStrictEqual(s.evidence_type, 'completed_sale',
        'an average cannot be one verified sale: ' + s.id);
    }
  }
});

// ---- catalogue growth ------------------------------------------------------

test('the catalogue covers the franchise checklists the handoff asks for', () => {
  const franchises = new Set(DATA.items.map((i) => i.franchise).filter(Boolean));
  for (const f of ['Pokemon', 'Disney', 'Sanrio', 'Star Wars', 'Marvel',
                   'Harry Potter', 'WWF / Wildlife']) {
    assert.ok(franchises.has(f), 'missing franchise checklist: ' + f);
  }
});

test('exclusive lines are catalogued and flagged', () => {
  const count = (f) => DATA.items.filter((i) => i[f]).length;
  assert.ok(count('employee_exclusive') >= 10);
  assert.ok(count('event_exclusive') >= 9);
  assert.ok(count('limited_edition') >= 20);
});

test('accessories are catalogued as their own category', () => {
  const acc = DATA.items.filter((i) => i.category === 'Clothing & Accessories');
  assert.ok(acc.length >= 40, 'expected an accessories catalogue, got ' + acc.length);
});

test('no catalogued item carries a price without a sale behind it', () => {
  const priced = new Set(DATA.sales.map((s) => s.item_id));
  for (const item of DATA.items) {
    const v = E.valuate(item, salesFor(item.id), CFG);
    assert.strictEqual(v.has_value, priced.has(item.id),
      item.id + ': published value must exist if and only if a sale does');
  }
});

test('identification conflicts are recorded rather than silently resolved', () => {
  const flagged = DATA.items.filter(
    (i) => i.notes && /needs confirmation|before merging/i.test(i.notes));
  assert.ok(flagged.length >= 5,
    'expected unresolved conflicts to be documented, found ' + flagged.length);
  const lucky = DATA.items.find((i) => i.id === 'lucky-kitty');
  assert.match(lucky.notes, /1997/);
  assert.match(lucky.notes, /1999/);
});

// ---- Vault reissues (handoff section 25) -----------------------------------

test('Vault reissues are separate items from the original release', () => {
  const original = itemById('original-pumpkin-kitty');
  const vault = itemById('pumpkin-kitty-vault-2023');
  assert.ok(original && vault, 'both the original and the Vault reissue must exist');
  assert.strictEqual(original.original_release, true);
  assert.strictEqual(original.vault_release, false);
  assert.strictEqual(vault.original_release, false);
  assert.strictEqual(vault.vault_release, true);
  assert.notStrictEqual(original.id, vault.id);
});

test('a Vault release warns that a reissue is not an original', () => {
  const vault = itemById('pumpkin-kitty-vault-2023');
  const v = E.valuate(vault, [
    { id: 'x', sold_price: 40, evidence_type: 'completed_sale',
      condition: 'Good', completeness: 'bare' }
  ], CFG);
  assert.ok(v.caveats.includes('vault'));
  assert.ok(v.why.some((w) => /reissue/i.test(w)));
});

test('no sale is shared between an original and its reissue', () => {
  const pumpkinIds = DATA.items
    .filter((i) => /pumpkin.kitty/i.test(i.canonical_name)).map((i) => i.id);
  assert.ok(pumpkinIds.length >= 4, 'expected the Pumpkin Kitty family');
  const owners = DATA.sales.filter((s) => pumpkinIds.includes(s.item_id))
    .map((s) => s.item_id);
  assert.deepStrictEqual([...new Set(owners)], ['original-pumpkin-kitty'],
    'only the original has comps; reissues must not inherit them');
});

// ---- catalogue breadth -----------------------------------------------------

test('the catalogue spans every year from 1997 to 2026', () => {
  const years = new Set(DATA.items.map((i) => i.release_year).filter(Boolean));
  for (let y = 1997; y <= 2026; y++) {
    assert.ok(years.has(y), 'no catalogued item for ' + y);
  }
});

test('accessories are a substantial category in their own right', () => {
  const acc = DATA.items.filter((i) => i.category === 'Clothing & Accessories');
  assert.ok(acc.length >= 100, 'expected 100+ accessories, got ' + acc.length);
  const subs = new Set(acc.map((i) => i.species));
  for (const s of ['Shoes', 'Pajamas', 'Costumes', 'Clothing', 'Props']) {
    assert.ok(subs.has(s), 'missing accessory type: ' + s);
  }
});

test('multi-item lots are flagged so they never price a single item', () => {
  const lots = DATA.items.filter((i) => i.is_lot);
  assert.ok(lots.length >= 5);
  for (const lot of lots) {
    const v = E.valuate(lot, salesFor(lot.id), CFG);
    if (v.has_value) assert.ok(v.caveats.includes('lot'), lot.id + ' should be flagged');
  }
});

// ---- release status --------------------------------------------------------

test('an unreleased item has no sold comps and no value', () => {
  const upcoming = DATA.items.filter((i) => i.release_status === 'upcoming');
  assert.ok(upcoming.length >= 1, 'expected upcoming releases to be tracked');
  for (const item of upcoming) {
    assert.strictEqual(salesFor(item.id).length, 0,
      item.id + ' has not been released, so it cannot have sold');
    assert.strictEqual(E.valuate(item, [], CFG).has_value, false);
  }
});

test('a pre-release sale is flagged as hype rather than market evidence', () => {
  const item = { id: 'x', release_status: 'upcoming' };
  const v = E.valuate(item, [
    { id: 'a', sold_price: 200, evidence_type: 'completed_sale',
      condition: 'NWT', completeness: 'bare' }
  ], CFG);
  assert.ok(v.caveats.includes('upcoming'));
  assert.ok(v.why.some((w) => /pre-order|hype/i.test(w)));
});

test('a current retail release warns that retail caps the resale price', () => {
  const v = E.valuate({ id: 'x', release_status: 'current' }, [
    { id: 'a', sold_price: 40, evidence_type: 'completed_sale',
      condition: 'Good', completeness: 'bare' }
  ], CFG);
  assert.ok(v.caveats.includes('current-retail'));
  assert.ok(v.why.some((w) => /retail/i.test(w)));
});

test('release status is only ever one of the known values', () => {
  for (const i of DATA.items) {
    assert.ok([null, undefined, 'upcoming', 'current'].includes(i.release_status),
      'bad release_status on ' + i.id + ': ' + i.release_status);
  }
});

test('every tracked release cites where the announcement came from', () => {
  for (const i of DATA.items.filter((x) => x.release_status)) {
    assert.ok(i.announcement_source, i.id + ' should cite its announcement source');
    assert.match(i.announcement_source, /^https?:\/\//);
  }
});

test('the 2026 Halloween collection is catalogued', () => {
  const names = DATA.items.map((i) => i.canonical_name).join(' | ');
  for (const nm of ['Jumping Spider', 'Mystical Werewolf', 'Batty Kitty',
                    'Pumpkin Pal Teddy', 'Owloween Cauldron Mashimal']) {
    assert.ok(names.includes(nm), 'missing 2026 Halloween item: ' + nm);
  }
});

test('an announced retail price is never treated as a resale value', () => {
  for (const i of DATA.items) {
    if (i.announced_msrp != null) {
      const v = E.valuate(i, salesFor(i.id), CFG);
      // MSRP lives on the item, never in the sales array, so it cannot reach a valuation.
      assert.ok(!salesFor(i.id).some((s) => s.sold_price === i.announced_msrp &&
        s.evidence_type === 'completed_sale' && !s.listing_id),
        i.id + ': MSRP must not be entered as a sale');
    }
  }
});

// ---- headline numbers ----------------------------------------------------------

test('catalogueStats is the one definition, and the build agrees with it', () => {
  const cache = {};
  const st = E.catalogueStats(DATA.items, salesFor,
    (id) => cache[id] || (cache[id] = valueOf(id)), CFG);
  assert.strictEqual(st.items, DATA.meta.stats.items);
  assert.strictEqual(st.priced_items, DATA.meta.stats.priced_items);
  assert.strictEqual(st.sold_transactions, DATA.meta.stats.sold_transactions);
  assert.strictEqual(st.stale_items, DATA.meta.stats.stale_items);
  assert.strictEqual(st.sold_records, DATA.sales.length);
});

test('no hand-typed catalogue counts or fee figures survive in the docs', () => {
  const root = path.join(__dirname, '..');
  const files = ['README.md'];
  for (const f of fs.readdirSync(root)) {
    if (/\.(js|css)$/.test(f) && !['data.js', 'site-config.js', 'sw.js'].includes(f)) files.push(f);
  }
  for (const f of fs.readdirSync(path.join(root, 'tools'))) {
    if (/\.py$/.test(f)) files.push(path.join('tools', f));
  }
  for (const f of files) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    assert.doesNotMatch(src, /\b1,?974\b|\b2,?042\b|79 sold/, f);
  }
  // The fee literal: only deals.js may name it, to migrate settings saved
  // before fees became a schedule.
  for (const f of files.filter((x) => x !== 'deals.js')) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, f), 'utf8'), /0\.1325/, f);
  }
});

// ---- recency and staleness ---------------------------------------------------

const dated = (id, price, date, extra) => Object.assign({
  id: id, sold_price: price, sale_date: date, evidence_type: 'completed_sale',
  marketplace: 'eBay', listing_id: id, condition: 'Good', completeness: 'bare'
}, extra || {});
const asOf = (d) => Object.assign({}, CFG, {
  recency: { window_days: 365, min_recent: 10, as_of: d }
});

test('the window is anchored on the build date, not the latest sale', () => {
  const sales = [];
  for (let i = 0; i < 10; i++) sales.push(dated('r' + i, 50, '2026-0' + (1 + (i % 9)) + '-01'));
  sales.push(dated('old', 500, '2024-01-01'));
  const v = E.valuate({ id: 'x' }, sales, asOf('2026-10-01'));
  assert.strictEqual(v.observation_count, 10, 'the 2024 sale is left out');
  assert.strictEqual(v.window.basis, 'recent');
  assert.strictEqual(v.window.as_of, '2026-10-01');
  assert.strictEqual(v.window.since, '2025-10-01');
  assert.strictEqual(v.stale, false);
});

test('a thin recent window uses every sale and is not stale', () => {
  const sales = [dated('a', 50, '2026-05-01'), dated('b', 60, '2023-01-01')];
  const v = E.valuate({ id: 'x' }, sales, asOf('2026-10-01'));
  assert.strictEqual(v.observation_count, 2);
  assert.strictEqual(v.window.basis, 'all_time');
  assert.strictEqual(v.stale, false);
  assert.strictEqual(v.stale_reason, null);
  assert.strictEqual(v.last_sale_date, '2026-05-01');
});

test('no sale in the window publishes the all-time value, marked stale', () => {
  const sales = [dated('a', 50, '2024-03-02'), dated('b', 60, '2023-01-01')];
  const v = E.valuate({ id: 'x' }, sales, asOf('2026-10-01'));
  assert.strictEqual(v.has_value, true);
  assert.strictEqual(v.observation_count, 2);
  assert.strictEqual(v.stale, true);
  assert.strictEqual(v.stale_reason, 'no_sales_in_window');
  assert.strictEqual(v.last_sale_date, '2024-03-02');
  assert.strictEqual(v.window.basis, 'all_time');
  assert.ok(v.caveats.includes('stale'));
  assert.ok(v.why.some((w) => /No sale recorded in the 12 months to 2026-10-01; last sale 2024-03-02/.test(w)));
});

test('undated sales alone are stale for want of a date', () => {
  const v = E.valuate({ id: 'x' }, [
    { id: 'a', sold_price: 50, evidence_type: 'collector_report', condition: 'Good' }
  ], asOf('2026-10-01'));
  assert.strictEqual(v.stale, true);
  assert.strictEqual(v.stale_reason, 'undated_only');
  assert.strictEqual(v.last_sale_date, null);
});

test('a config without as_of behaves as before and never reports stale', () => {
  const legacy = Object.assign({}, CFG, { recency: { window_days: 365, min_recent: 10 } });
  const sales = [dated('a', 50, '2019-03-02'), dated('b', 60, '2018-01-01')];
  const v = E.valuate({ id: 'x' }, sales, legacy);
  assert.strictEqual(v.stale, false);
  assert.strictEqual(v.observation_count, 2);
});

test('the shipped data states its as_of date', () => {
  assert.match(CFG.recency.as_of, /^\d{4}-\d{2}-\d{2}$/);
  assert.strictEqual(CFG.recency.as_of, DATA.meta.built_at);
});

test('a stale value is never offered as a deal, unless asked for, with a risk', () => {
  const sales = [];
  for (let i = 0; i < 12; i++) sales.push(dated('s' + i, 100 + i, '2023-0' + (1 + (i % 9)) + '-01'));
  const item = { id: 'stale-bear', canonical_name: 'Stale Bear' };
  const cfg = asOf('2026-10-01');
  const v = E.valuate(item, sales, cfg);
  assert.strictEqual(v.stale, true);
  const ctx = (c) => ({ config: c, itemById: () => item, valuationFor: () => v,
    listings: [{ evidence_type: 'active_listing', item_id: 'stale-bear', ask_price: 20,
                 ship_price: 0, condition: 'Good' }] });
  assert.strictEqual(E.findDeals(ctx(cfg)).length, 0);
  const lax = Object.assign({}, cfg, { reseller: Object.assign({}, cfg.reseller, { exclude_stale: false }) });
  const d = E.findDeals(ctx(lax));
  assert.strictEqual(d.length, 1);
  assert.ok(d[0].risks.some((r) => /Value is stale \(last sale 2023-/.test(r)));
});

test('sold_transactions counts every recorded transaction, averages expanded', () => {
  const v = E.valuate({ id: 'x' }, [
    dated('a', 50, '2026-01-01'),
    dated('b', 55, '2026-02-01', { sample_size: 12, evidence_type: 'collector_report' }),
    dated('c', 60, '2026-03-01', { excluded: { reason: 'x' } }),
    dated('d', 60, '2026-03-01', { evidence_type: 'active_listing' })
  ], asOf('2026-10-01'));
  assert.strictEqual(v.sold_transactions, 13);
});

// ---- deal finder -----------------------------------------------------------

const listingFor = (itemId, ask, condition) => ({
  evidence_type: 'active_listing', item_id: itemId, ask_price: ask,
  condition: condition || 'Good', title: 'test listing',
  source_url: 'https://www.ebay.com/itm/1'
});

// The deal mechanics below are exercised on long-established curated items,
// several of which have no sale in the last twelve months. Staleness has its
// own tests; here it is switched off so each test isolates one rule.
const DEAL_CFG = Object.assign({}, CFG, {
  reseller: Object.assign({}, CFG.reseller, { exclude_stale: false })
});
const dealCtx = (listings, cfg) => ({
  config: cfg || DEAL_CFG, listings: listings, itemById: itemById, valuationFor: valueOf
});

test('net proceeds subtract fees and shipping from the gross value', () => {
  const r = CFG.reseller;
  const sched = CFG.fees.platforms[r.platform];
  const net = E.netProceeds(100, CFG);
  const shipIn = r.shipping_charged || 0;
  const base = sched.applies_to === 'item' ? 100 : 100 + shipIn;
  const fixed = base > sched.fixed_threshold ? sched.fixed_over : sched.fixed_under;
  const expected = 100 + shipIn - (base * sched.pct + fixed) - r.shipping_cost;
  assert.ok(Math.abs(net - expected) < 1e-9);
  assert.ok(net < 100, 'a gross discount is not profit');
});

// ---- fee schedule ------------------------------------------------------------

const feeCfg = (reseller) => Object.assign({}, CFG, {
  reseller: Object.assign({}, CFG.reseller, reseller || {})
});

test('the eBay per-order fee is the higher one above the threshold', () => {
  const s = CFG.fees.platforms.ebay;
  assert.ok(Math.abs(E.sellingFee(20, s) - (20 * s.pct + s.fixed_over)) < 1e-9);
  assert.ok(Math.abs(E.sellingFee(10, s) - (10 * s.pct + s.fixed_under)) < 1e-9);
  assert.ok(Math.abs(E.sellingFee(5, s) - (5 * s.pct + s.fixed_under)) < 1e-9);
  assert.ok(s.fixed_over > s.fixed_under);
});

test('eBay fees are charged on item plus shipping', () => {
  const s = CFG.fees.platforms.ebay;
  const cfg = feeCfg({ platform: 'ebay', shipping_charged: 10, shipping_cost: 0 });
  const net = E.netProceeds(100, cfg);
  assert.ok(Math.abs(net - (110 - E.sellingFee(110, s))) < 1e-9);
});

test('Mercari has no fixed per-order fee', () => {
  const s = CFG.fees.platforms.mercari;
  assert.ok(Math.abs(E.sellingFee(100, s) - 100 * s.pct) < 1e-9);
  const cfg = feeCfg({ platform: 'mercari', shipping_charged: 0, shipping_cost: 0 });
  assert.ok(Math.abs(E.netProceeds(100, cfg) - (100 - 100 * s.pct)) < 1e-9);
});

test('a platform can be chosen per call', () => {
  const cfg = feeCfg({ shipping_charged: 0, shipping_cost: 0 });
  assert.notStrictEqual(E.netProceeds(100, cfg, { platform: 'mercari' }),
                        E.netProceeds(100, cfg, { platform: 'ebay' }));
});

test('no fee figure is written into the engine', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');
  assert.doesNotMatch(src, /0\.13\d*/);
  assert.doesNotMatch(src, /marketplace_fee_pct|payment_fee_fixed/);
});

test('a listing well below value is flagged with a real margin', () => {
  const deals = E.findDeals(dealCtx([listingFor('kennel-pals-calico-cat', 50)]));
  assert.strictEqual(deals.length, 1);
  assert.ok(deals[0].margin > 0);
  assert.strictEqual(deals[0].item_name, 'Kennel Pals Calico Cat');
  assert.ok(deals[0].discount_pct > 20);
});

test('a deal is judged on the ask plus its shipping', () => {
  const l = Object.assign(listingFor('kennel-pals-calico-cat', 40), { ship_price: 12 });
  assert.strictEqual(E.buyerTotal(l, CFG), 52);
  const d = E.findDeals(dealCtx([l]))[0];
  assert.ok(d, 'still a deal');
  assert.strictEqual(d.buyer_total, 52);
  assert.strictEqual(d.ship_price, 12);
  assert.strictEqual(d.ship_assumed, false);
  assert.ok(Math.abs(d.margin - (d.net_proceeds - 52)) < 1e-9);
  assert.ok(!d.risks.some((r) => /Shipping not stated/.test(r)));
});

test('free shipping costs nothing extra', () => {
  const l = Object.assign(listingFor('kennel-pals-calico-cat', 40), { ship_price: 0 });
  assert.strictEqual(E.buyerTotal(l, CFG), 40);
});

test('unstated shipping is assumed, and the deal says so', () => {
  const l = listingFor('kennel-pals-calico-cat', 40);
  assert.strictEqual(E.buyerTotal(l, CFG), 40 + CFG.reseller.assumed_inbound_shipping);
  const d = E.findDeals(dealCtx([l]))[0];
  assert.strictEqual(d.ship_assumed, true);
  assert.ok(d.risks.some((r) => /Shipping not stated; assumed \$/.test(r)));
});

test('a listing at or above value is not a deal', () => {
  assert.strictEqual(E.findDeals(dealCtx([listingFor('kennel-pals-calico-cat', 250)])).length, 0);
});

test('an item with no sold data can never be a deal at any price', () => {
  // Nobody knows what it is worth, so nothing can be "below" that.
  const deals = E.findDeals(dealCtx([listingFor('floppy-kitty', 1)]));
  assert.strictEqual(deals.length, 0);
});

test('the same asking price is a deal on a mint copy and not on a battered one', () => {
  // $90 against a NWT copy worth $250 is a bargain. The same $90 against a
  // played-with copy worth $100 is not, and must not be flagged as one just
  // because mint examples fetch more.
  const nwt = E.findDeals(dealCtx([listingFor('kennel-pals-calico-cat', 90, 'NWT')]));
  const poor = E.findDeals(dealCtx([listingFor('kennel-pals-calico-cat', 90, 'Poor')]));

  assert.strictEqual(nwt.length, 1);
  assert.strictEqual(poor.length, 0, 'a cheap ask on a poor copy is not a deal');

  const good = E.findDeals(dealCtx([listingFor('kennel-pals-calico-cat', 90, 'Good')]));
  assert.ok(nwt[0].gross_value > good[0].gross_value,
    'a NWT copy must be valued above an average one');
});

test('asking prices never leak into the valuation behind a deal', () => {
  const before = valueOf('kennel-pals-calico-cat').fair_market;
  E.findDeals(dealCtx([listingFor('kennel-pals-calico-cat', 5)]));
  assert.strictEqual(valueOf('kennel-pals-calico-cat').fair_market, before);
});

test('thresholds are honoured', () => {
  const strict = JSON.parse(JSON.stringify(CFG));
  strict.reseller.min_net_margin = 1000;
  assert.strictEqual(
    E.findDeals(dealCtx([listingFor('kennel-pals-calico-cat', 50)], strict)).length, 0);

  const conf = JSON.parse(JSON.stringify(CFG));
  conf.reseller.min_confidence = 'HIGH';
  assert.strictEqual(
    E.findDeals(dealCtx([listingFor('kennel-pals-calico-cat', 50)], conf)).length, 0,
    'a LOW-confidence item must not pass a HIGH-only filter');
});

test('a thin-evidence deal carries a warning about the evidence', () => {
  const d = E.findDeals(dealCtx([listingFor('kennel-pals-calico-cat', 50)]))[0];
  assert.ok(d.risks.length > 0);
  assert.ok(d.risks.some((r) => /comparable sale/.test(r)));
});

test('a listing with no stated condition says so', () => {
  const d = E.findDeals(dealCtx([listingFor('kennel-pals-calico-cat', 50, 'Unknown')]))[0];
  assert.ok(d.risks.some((r) => /does not state a condition/.test(r)));
});

test('deals are ranked by margin, best first', () => {
  // All three clear the conservative floor; only the ordering is under test.
  const free = (l) => Object.assign(l, { ship_price: 0 });
  const deals = E.findDeals(dealCtx([
    free(listingFor('kennel-pals-calico-cat', 100)),
    free(listingFor('kennel-pals-calico-cat', 30)),
    free(listingFor('kennel-pals-calico-cat', 60))
  ]));
  assert.strictEqual(deals.length, 3);
  assert.ok(deals[0].margin > deals[1].margin);
  assert.ok(deals[1].margin > deals[2].margin);
  assert.strictEqual(deals[0].ask, 30, 'cheapest ask yields the biggest margin');
});

test('anything that is not an active listing is ignored', () => {
  assert.strictEqual(E.findDeals(dealCtx([
    { evidence_type: 'completed_sale', item_id: 'kennel-pals-calico-cat', ask_price: 5 }
  ])).length, 0);
});

// ---- first-party sales -----------------------------------------------------

const opSale = (id, price, date, extra) => Object.assign({
  id: id, sold_price: price, sale_date: date, evidence_type: 'completed_sale',
  marketplace: 'eBay', listing_id: id, condition: 'Good', completeness: 'bare'
}, extra || {});

test('an operator sale is not strong evidence without provenance', () => {
  const v = E.valuate({ id: 'x' }, [
    { id: 'a', sold_price: 60, evidence_type: 'collector_report', condition: 'Good',
      completeness: 'bare' },
    { id: 'b', sold_price: 62, evidence_type: 'collector_report', first_party: true,
      condition: 'Good', completeness: 'bare' }
  ], CFG);
  assert.strictEqual(v.strong_evidence_count, 0,
    'provenance rules apply to the operator exactly as to anyone else');
  assert.strictEqual(v.operator_count, 0, 'one third-party comp supports no operator comp');
  assert.ok(v.why.some((w) => /Jay's Retro Exchange/.test(w)));
  assert.ok(!v.why.some((w) => /yourself/.test(w)));
});

test('operator comps are capped at a quarter of the comps behind a value', () => {
  const sales = [
    opSale('t1', 50, '2026-01-01'), opSale('t2', 52, '2026-01-02'), opSale('t3', 54, '2026-01-03'),
    opSale('o1', 90, '2026-02-01', { first_party: true }),
    opSale('o2', 91, '2026-03-01', { seller_is_operator: true }),
    opSale('o3', 92, '2026-04-01', { first_party: true })
  ];
  const v = E.valuate({ id: 'x' }, sales, CFG);
  assert.strictEqual(v.operator_count, 1);
  assert.deepStrictEqual(v.operator_excluded.map((e) => e.sale_id).sort(), ['o1', 'o2']);
  assert.ok(v.operator_excluded.every((e) => e.reason === 'operator_cap'));
  assert.deepStrictEqual(v.points.filter((p) => p.operator).map((p) => p.sale_id), ['o3'],
    'the most recent operator comp is the one kept');
  assert.strictEqual(v.comparable_count, 4);
});

test('operator points never exceed the cap, whatever the mix', () => {
  for (let third = 1; third <= 40; third++) {
    const sales = [];
    for (let i = 0; i < third; i++) sales.push(opSale('t' + i, 50 + (i % 7), '2026-01-01'));
    for (let i = 0; i < 40; i++) {
      sales.push(opSale('o' + i, 50 + (i % 5), '2026-02-01', { seller_is_operator: true }));
    }
    const v = E.valuate({ id: 'x' }, sales, CFG);
    const op = v.points.filter((p) => p.operator).length;
    assert.ok(op <= CFG.operator_cap * v.points.length + 1e-9,
      third + ' third-party: ' + op + ' of ' + v.points.length);
  }
});

test('an item with only operator sales publishes no value', () => {
  const v = E.valuate({ id: 'x' }, [
    opSale('o1', 90, '2026-02-01', { first_party: true }),
    opSale('o2', 95, '2026-03-01', { seller_is_operator: true })
  ], CFG);
  assert.strictEqual(v.has_value, false);
  assert.strictEqual(v.fair_market, null);
  assert.ok(v.caveats.includes('operator-only'));
  assert.ok(v.why.some((w) => /Jay's Retro Exchange, which runs this site/.test(w)));
});

test('operator offers, asks and listings never count as sales', () => {
  for (const t of ['operator_offer', 'operator_ask', 'active_listing', 'retail_reference']) {
    const v = E.valuate({ id: 'x' }, [opSale('a', 60, '2026-01-01', { evidence_type: t })], CFG);
    assert.strictEqual(v.has_value, false, t);
  }
});

test('the business offer bands never feed a valuation', () => {
  const sales = salesFor('kennel-pals-calico-cat');
  const item = itemById('kennel-pals-calico-cat');
  const a = E.valuate(item, sales, CFG);
  const b = E.valuate(item, sales, Object.assign({}, CFG, {
    business: { buy_pct: [0.01, 0.02], offer: 1, enabled: true }
  }));
  assert.deepStrictEqual(b, a);
});

test('operator listings are never offered as deals or counted in the ask spread', () => {
  const own = Object.assign(listingFor('kennel-pals-calico-cat', 40),
    { ship_price: 0, seller_is_operator: true });
  assert.strictEqual(E.findDeals(dealCtx([own])).length, 0);
  const v = valueOf('kennel-pals-calico-cat');
  assert.strictEqual(E.askSpread(v, [own]), null);
});

test('excluded sales are kept for the record but never priced', () => {
  const v = E.valuate({ id: 'x' }, [
    opSale('a', 60, '2026-01-01', { excluded: { reason: 'not this item' } })
  ], CFG);
  assert.strictEqual(v.has_value, false);
});

test('an operator sale does not suppress the usual caveats', () => {
  const v = E.valuate({ id: 'x', release_status: 'current' }, [
    { id: 'a', sold_price: 60, evidence_type: 'completed_sale', first_party: true,
      condition: 'Good', completeness: 'bare' },
    { id: 'b', sold_price: 61, evidence_type: 'completed_sale',
      condition: 'Good', completeness: 'bare' }
  ], CFG);
  assert.strictEqual(v.has_value, true);
  assert.ok(v.caveats.includes('current-retail'));
});

test('seeded research is not marked as first-party', () => {
  for (const s of DATA.sales) {
    assert.notStrictEqual(s.first_party, true,
      'transcribed research is not your own sale: ' + s.id);
  }
});

// ---- catalogue hygiene -----------------------------------------------------

test('no name or alias identifies more than one item', () => {
  // A name that matches two items matches neither: the importer would have to
  // pick, and whichever it picked would silently take the other's comps.
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const byName = new Map();
  for (const item of DATA.items) {
    for (const n of [item.canonical_name, ...(item.aliases || [])]) {
      const key = norm(n);
      if (!key) continue;
      if (!byName.has(key)) byName.set(key, new Set());
      byName.get(key).add(item.id);
    }
  }
  const clashes = [...byName.entries()].filter(([, ids]) => ids.size > 1);
  assert.deepStrictEqual(clashes.map(([k, ids]) => k + ' -> ' + [...ids].join(', ')), [],
    'ambiguous names found');
});

test('an item never lists its own name as an alias', () => {
  for (const i of DATA.items) {
    const name = i.canonical_name.toLowerCase();
    for (const a of i.aliases || []) {
      assert.notStrictEqual(a.toLowerCase(), name, 'redundant alias on ' + i.id);
    }
  }
});

test('every alias is distinct within its own item', () => {
  for (const i of DATA.items) {
    const seen = (i.aliases || []).map((a) => a.toLowerCase());
    assert.strictEqual(new Set(seen).size, seen.length, 'duplicate alias on ' + i.id);
  }
});

// ---- conservative lower bound ----------------------------------------------

test('a single comp gets a haircut, because it carries no dispersion info', () => {
  const lb = E.lowerBound([100], CFG, 'seed');
  assert.strictEqual(lb.basis, 'single_comp_haircut');
  assert.ok(lb.value < 100);
});

test('two to four comps fall back to the observed floor', () => {
  const lb = E.lowerBound([80, 100, 120], CFG, 'seed');
  assert.strictEqual(lb.basis, 'observed_floor');
  assert.strictEqual(lb.value, 80, 'the real floor the data supports');
});

test('five or more comps use the bootstrap', () => {
  const lb = E.lowerBound([90, 95, 100, 105, 110, 100], CFG, 'seed');
  assert.match(lb.basis, /^bootstrap_p/);
  assert.ok(lb.value < E.median([90, 95, 100, 105, 110, 100]));
});

test('the same evidence always produces the same bound', () => {
  // A valuation that wobbles between page loads is not a valuation.
  const vals = [40, 60, 100, 140, 180, 90, 110, 70];
  assert.strictEqual(E.lowerBound(vals, CFG, 'abc').value,
                     E.lowerBound(vals, CFG, 'abc').value);
});

test('wide evidence produces a lower floor than tight evidence', () => {
  // The whole point: uncertainty, not rarity, is what makes the bar stricter.
  const tight = E.lowerBound([98, 99, 100, 101, 102, 100, 99, 101], CFG, 's');
  const wide = E.lowerBound([40, 60, 100, 140, 180, 90, 110, 70], CFG, 's');
  assert.ok(tight.value > wide.value,
    'the same sample size with more spread must yield a more cautious floor');
});

test('a valuation carries its floor alongside its median', () => {
  const v = valueOf('kennel-pals-calico-cat');
  assert.ok(v.lower_bound > 0);
  assert.ok(v.lower_bound < v.fair_market, 'the floor sits under the median');
  assert.ok(v.lower_bound_basis);
});

test('the calculator scales the floor with the median', () => {
  const v = valueOf('original-pumpkin-kitty');
  const a = E.adjust(v, 'NWT', 'complete', CFG);
  assert.ok(Math.abs(a.lower_bound / v.lower_bound - a.multiplier) < 1e-9);
});

// ---- deals are judged against the floor -------------------------------------

test('a thin-evidence item must be a better bargain to qualify', () => {
  // The Holiday Moose has one comp. Against the median it looks like a 40% discount;
  // against the floor it is not cheap enough, which is the correct answer.
  const listing = (ask) => ({ evidence_type: 'active_listing',
    item_id: 'employee-exclusive-holiday-moose', ask_price: ask, ship_price: 0,
    condition: 'Good', title: 't' });
  const ctx = (ask) => ({ config: DEAL_CFG, listings: [listing(ask)],
    itemById: itemById, valuationFor: valueOf });

  const v = valueOf('employee-exclusive-holiday-moose');
  assert.ok(v.lower_bound < v.fair_market * 0.8, 'one comp should widen the gap');
  assert.strictEqual(E.findDeals(ctx(v.fair_market * 0.6)).length, 0,
    '40% off the median is not enough when there is one comp behind it');
  assert.strictEqual(E.findDeals(ctx(v.fair_market * 0.2)).length, 1,
    'a genuine bargain still gets through');
});

test('a deal reports both the median and the floor it was judged against', () => {
  const d = E.findDeals({ config: DEAL_CFG, itemById: itemById, valuationFor: valueOf,
    listings: [{ evidence_type: 'active_listing', item_id: 'kennel-pals-calico-cat',
      ask_price: 40, condition: 'Good', title: 't' }] })[0];
  assert.ok(d.floor_value > 0);
  assert.ok(d.floor_value <= d.gross_value);
  assert.ok(d.floor_basis);
  // Margin is computed off the conservative figure, not the optimistic one.
  assert.ok(d.margin < E.netProceeds(d.gross_value, CFG) - d.ask);
});

// ---- portfolio history ------------------------------------------------------

const ctxFor = () => ({ config: CFG, valuationFor: valueOf });

test('a snapshot keeps priced and unpriced holdings apart', () => {
  const snap = E.collectionSnapshot([
    { item_id: 'original-pumpkin-kitty', condition: 'Good', completeness: 'bare', qty: 2 },
    { item_id: 'floppy-kitty', condition: 'Good', completeness: 'bare', qty: 1 }
  ], Object.assign({ date: '2026-09-10' }, ctxFor()));

  assert.strictEqual(snap.d, '2026-09-10');
  assert.strictEqual(snap.n, 3, 'three items held');
  assert.strictEqual(snap.uc, 1, 'one has no comps');
  assert.ok(snap.pv > 0, 'and is counted as zero, not guessed at');
});

test('buying in a flat market is not appreciation', () => {
  // The whole reason time-weighted return exists here.
  const snaps = [
    { d: '2026-01-01', pv: 100, cv: 100, uc: 0, n: 1 },
    { d: '2026-01-02', pv: 200, cv: 200, uc: 0, n: 2 },
    { d: '2026-01-03', pv: 200, cv: 200, uc: 0, n: 2 }
  ];
  const flows = [{ d: '2026-01-02', dir: 'acquire', v: 100 }];
  const w = E.windowStats(snaps, flows, 30);

  assert.ok(Math.abs(w.raw_change_pct - 100) < 0.01, 'the raw total doubled');
  assert.ok(Math.abs(w.twr_pct) < 0.01, 'but nothing appreciated');
  assert.strictEqual(w.net_flow, 100);
});

test('selling is not a loss', () => {
  const snaps = [
    { d: '2026-01-01', pv: 200, cv: 200, uc: 0, n: 2 },
    { d: '2026-01-02', pv: 100, cv: 100, uc: 0, n: 1 }
  ];
  const w = E.windowStats(snaps, [{ d: '2026-01-02', dir: 'dispose', v: 100 }], 30);
  assert.ok(w.raw_change_pct < -49);
  assert.ok(Math.abs(w.twr_pct) < 0.01);
});

test('real appreciation shows in both readings', () => {
  const snaps = [
    { d: '2026-01-01', pv: 100, cv: 100, uc: 0, n: 1 },
    { d: '2026-01-02', pv: 120, cv: 120, uc: 0, n: 1 }
  ];
  const w = E.windowStats(snaps, [], 30);
  assert.ok(Math.abs(w.raw_change_pct - 20) < 0.01);
  assert.ok(Math.abs(w.twr_pct - 20) < 0.01);
});

test('a single day of history reports honestly rather than guessing', () => {
  const w = E.windowStats([{ d: '2026-01-01', pv: 100, cv: 100, uc: 0, n: 1 }], [], 30);
  assert.strictEqual(w.enough, false);
  assert.strictEqual(w.note, 'not_enough_history');
});

test('holdings changes are derived as external flows', () => {
  const before = E.holdingsMap([{ item_id: 'a', qty: 1 }]);
  const after = E.holdingsMap([{ item_id: 'a', qty: 1 }, { item_id: 'b', qty: 2 }]);
  const flows = E.diffHoldings(before, after, () => 50);

  assert.strictEqual(flows.length, 1);
  assert.strictEqual(flows[0].dir, 'acquire');
  assert.strictEqual(flows[0].qty, 2);
  assert.strictEqual(flows[0].v, 100);

  const back = E.diffHoldings(after, before, () => 50);
  assert.strictEqual(back[0].dir, 'dispose');
});

test('a window with no snapshots does not throw', () => {
  assert.strictEqual(E.windowStats([], [], 30), null);
  assert.strictEqual(E.timeWeightedReturn([], []), null);
});

// ---- per-copy modifiers ----------------------------------------------------

test('a birth certificate scales with the item, a sound chip does not', () => {
  // The distinction that stops a $7 part being priced at $25 on a pricey bear.
  const big = valueOf('kennel-pals-calico-cat');   // ~$200
  const small = valueOf('mothman-mini-beans');     // ~$26

  const bigChip = E.adjust(big, 'Good', 'bare', CFG, { sound_module: true });
  const smallChip = E.adjust(small, 'Good', 'bare', CFG, { sound_module: true });
  assert.ok(Math.abs((bigChip.fair_market - big.fair_market) -
                     (smallChip.fair_market - small.fair_market)) < 1e-6,
    'an additive component adds the same cash on both');

  const bigCert = E.adjust(big, 'Good', 'bare', CFG, { birth_certificate: true });
  const smallCert = E.adjust(small, 'Good', 'bare', CFG, { birth_certificate: true });
  assert.ok((bigCert.fair_market - big.fair_market) >
            (smallCert.fair_market - small.fair_market),
    'a multiplicative modifier scales with the item');
});

test('the configured percentages are honoured', () => {
  const v = valueOf('kennel-pals-calico-cat');
  const cert = E.adjust(v, 'Good', 'bare', CFG, { birth_certificate: true });
  assert.ok(Math.abs(cert.fair_market / v.fair_market - 1.15) < 1e-9, '+15%');

  const noTag = E.adjust(v, 'Good', 'bare', CFG, { tush_tag_missing: true });
  assert.ok(Math.abs(noTag.fair_market / v.fair_market - 0.70) < 1e-9, '-30%');
});

test('stacked bonuses are capped, losses are not', () => {
  const v = valueOf('kennel-pals-calico-cat');
  const everything = E.adjust(v, 'Good', 'bare', CFG,
    { birth_certificate: true, hang_tag: true });
  assert.ok(everything.modifiers.factor <= CFG.modifiers.max_combined_multiplier);

  // A battered copy is allowed all the way down: the floor is what the market
  // says, not a rule.
  const wrecked = E.adjust(v, 'Good', 'bare', CFG,
    { tush_tag_missing: true, customised: true });
  assert.ok(wrecked.modifiers.factor < 0.6);
  assert.strictEqual(wrecked.modifiers.capped, false);
});

test('a hang tag is not counted twice on a copy already graded NWT', () => {
  const v = valueOf('kennel-pals-calico-cat');
  const nwt = E.adjust(v, 'NWT', 'bare', CFG);
  const nwtTag = E.adjust(v, 'NWT', 'bare', CFG, { hang_tag: true });
  assert.strictEqual(nwtTag.fair_market, nwt.fair_market);
  assert.ok(!nwtTag.modifiers.applied.some((m) => m.key === 'hang_tag'));
  const good = E.adjust(v, 'Good', 'bare', CFG, { hang_tag: true });
  assert.ok(good.modifiers.applied.some((m) => m.key === 'hang_tag'));
});

test('unstuffed is a completeness grade, not a second calculator modifier', () => {
  assert.strictEqual(CFG.modifiers.multiplicative.unstuffed, undefined);
  assert.strictEqual(CFG.completeness_multipliers.unstuffed, 1);
});

test('a new-without-tags sale normalises by its own multiplier', () => {
  assert.ok(CFG.condition_order.includes('NWOT'));
  const s = { sold_price: 115, condition: 'NWOT', completeness: 'bare',
              evidence_type: 'completed_sale' };
  assert.ok(Math.abs(E.normalisedPrice(s, CFG) - 115 / CFG.condition_multipliers.NWOT) < 1e-9);
  assert.ok(CFG.condition_multipliers.NWOT < CFG.condition_multipliers.NWT);
});

test('the modifier chain is itemised so a figure can be taken apart', () => {
  const v = valueOf('kennel-pals-calico-cat');
  const a = E.adjust(v, 'Good', 'bare', CFG,
    { birth_certificate: true, sound_module: true });
  assert.strictEqual(a.modifiers.applied.length, 2);
  const kinds = a.modifiers.applied.map((m) => m.kind).sort();
  assert.deepStrictEqual(kinds, ['additive', 'multiplicative']);
  assert.ok(a.modifiers.applied.every((m) => m.label && m.label !== m.key));
});

test('no modifiers leaves a valuation untouched', () => {
  const v = valueOf('kennel-pals-calico-cat');
  const plain = E.adjust(v, 'Good', 'bare', CFG);
  const empty = E.adjust(v, 'Good', 'bare', CFG, {});
  assert.strictEqual(plain.fair_market, empty.fair_market);
  assert.strictEqual(empty.modifiers.factor, 1);
  assert.strictEqual(empty.modifiers.additive, 0);
});

test('an unknown modifier is ignored rather than guessed at', () => {
  const v = valueOf('kennel-pals-calico-cat');
  const a = E.adjust(v, 'Good', 'bare', CFG, { glitter_finish: true });
  assert.strictEqual(a.fair_market, E.adjust(v, 'Good', 'bare', CFG).fair_market);
});

test('modifiers move the conservative floor with the median', () => {
  const v = valueOf('kennel-pals-calico-cat');
  const a = E.adjust(v, 'Good', 'bare', CFG, { birth_certificate: true });
  assert.ok(a.lower_bound > v.lower_bound);
  assert.ok(a.lower_bound < a.fair_market);
});

// ---- the observations behind a number --------------------------------------

test('a valuation exposes the individual comps it was built from', () => {
  const item = { id: 'x' };
  const sales = [
    { id: 'a', sold_price: 40, evidence_type: 'completed_sale',
      condition: 'Good', completeness: 'bare' },
    { id: 'b', sold_price: 60, evidence_type: 'completed_sale',
      condition: 'Good', completeness: 'bare' }
  ];
  const v = E.valuate(item, sales, CFG);
  assert.strictEqual(v.points.length, 2);
  assert.deepStrictEqual(v.points.map((p) => p.raw).sort((a, b) => a - b), [40, 60]);
  assert.deepStrictEqual(v.points.map((p) => p.sale_id).sort(), ['a', 'b']);
});

test('the exposed comps carry the normalised price, not just the raw one', () => {
  // The median is taken of normalised values, so a page that plotted raw
  // prices against it would be drawing two different things on one axis.
  const item = { id: 'x' };
  const sales = [{ id: 'a', sold_price: 100, evidence_type: 'completed_sale',
                   condition: 'NWT', completeness: 'bare' }];
  const v = E.valuate(item, sales, CFG);
  assert.strictEqual(v.points[0].raw, 100);
  assert.ok(v.points[0].norm < 100, 'NWT should normalise down to the Good baseline');
  assert.strictEqual(v.points[0].norm, v.fair_market);
});

test('an item with no evidence exposes no comps', () => {
  const v = E.valuate({ id: 'x' }, [], CFG);
  assert.deepStrictEqual(v.points, []);
  assert.strictEqual(v.has_value, false);
});

test('a rejected outlier is not among the exposed comps', () => {
  const item = { id: 'x' };
  const sales = [40, 42, 41, 43, 39, 5000].map((p, i) => ({
    id: 's' + i, sold_price: p, evidence_type: 'completed_sale',
    condition: 'Good', completeness: 'bare'
  }));
  const v = E.valuate(item, sales, CFG);
  assert.ok(v.excluded_outliers.length > 0, 'expected the 5000 to be rejected');
  assert.ok(!v.points.some((p) => p.raw === 5000),
    'a comp the median ignored must not be drawn as if it counted');
});


// ---- the index summary (tools/build_assets.js) ------------------------------

test('summary() returns exactly SUMMARY_KEYS', () => {
  const v = valueOf('kennel-pals-calico-cat');
  assert.deepStrictEqual(Object.keys(E.summary(v)), E.SUMMARY_KEYS);
  assert.deepStrictEqual(Object.keys(E.summary(E.valuate({ id: 'x' }, [], CFG))), E.SUMMARY_KEYS);
  for (const k of ['sold_transactions', 'stale', 'stale_reason', 'last_sale_date', 'operator_count', 'window']) {
    assert.ok(E.SUMMARY_KEYS.includes(k), k);
  }
  assert.ok(!E.SUMMARY_KEYS.includes('points') && !E.SUMMARY_KEYS.includes('why'));
});

test('adjust() of a summary equals adjust() of the full valuation', () => {
  const priced = DATA.items.filter((i) => valueOf(i.id).has_value).slice(0, 50);
  assert.strictEqual(priced.length, 50);
  for (const i of priced) {
    const v = valueOf(i.id);
    for (const [cond, comp] of [['Good', 'bare'], ['NWT', 'complete'], ['Fair', 'unknown']]) {
      assert.deepStrictEqual(E.adjust(E.summary(v), cond, comp, CFG), E.adjust(v, cond, comp, CFG), i.id);
    }
  }
});

test('withBands() restores exactly the bands valuate() computed', () => {
  for (const i of DATA.items.slice(0, 400)) {
    const v = valueOf(i.id);
    const w = E.withBands(E.summary(v), i.id, CFG);
    assert.strictEqual(w.item_id, i.id);
    for (const k of ['buy_low', 'buy_high', 'trade_low', 'trade_high', 'sell_low', 'sell_high',
                     'ask_low', 'ask_high', 'fair_market', 'range_low', 'confidence']) {
      assert.strictEqual(w[k], v[k], i.id + '.' + k);
    }
  }
});

test('valuate is deterministic across runs (seeded bootstrap)', () => {
  for (const i of DATA.items.slice(0, 200)) {
    assert.deepStrictEqual(valueOf(i.id), valueOf(i.id), i.id);
  }
});

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
  const v = valueOf('pudgie-pink-pig');
  assert.strictEqual(v.strong_evidence_count, 0);
  assert.ok(v.caveats.includes('no-strong-evidence'));
});

test('a lot is flagged as an invalid single-item comparable', () => {
  const v = valueOf('hello-kitty-my-melody-pink-wink-lot-of-3');
  assert.ok(v.caveats.includes('lot'));
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
  const h = E.priceHistory(salesFor('vanilla-fudge-bunny'), CFG);
  assert.strictEqual(h.length, 1);
  assert.strictEqual(h[0].year, 2025);
});

test('undated research yields no chartable history', () => {
  assert.strictEqual(E.priceHistory(salesFor('pudgie-pink-pig'), CFG).length, 0);
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

// ---- deal finder -----------------------------------------------------------

const listingFor = (itemId, ask, condition) => ({
  evidence_type: 'active_listing', item_id: itemId, ask_price: ask,
  condition: condition || 'Good', title: 'test listing',
  source_url: 'https://www.ebay.com/itm/1'
});

const dealCtx = (listings, cfg) => ({
  config: cfg || CFG, listings: listings, itemById: itemById, valuationFor: valueOf
});

test('net proceeds subtract fees and shipping from the gross value', () => {
  const r = CFG.reseller;
  const net = E.netProceeds(100, CFG);
  const expected = 100 - 100 * r.marketplace_fee_pct - r.payment_fee_fixed - r.shipping_cost;
  assert.ok(Math.abs(net - expected) < 1e-9);
  assert.ok(net < 100, 'a gross discount is not profit');
});

test('a listing well below value is flagged with a real margin', () => {
  const deals = E.findDeals(dealCtx([listingFor('kennel-pals-calico-cat', 50)]));
  assert.strictEqual(deals.length, 1);
  assert.ok(deals[0].margin > 0);
  assert.strictEqual(deals[0].item_name, 'Kennel Pals Calico Cat');
  assert.ok(deals[0].discount_pct > 20);
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
  const deals = E.findDeals(dealCtx([
    listingFor('kennel-pals-calico-cat', 100),
    listingFor('kennel-pals-calico-cat', 30),
    listingFor('kennel-pals-calico-cat', 60)
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

test('your own sale counts as the strongest evidence', () => {
  const v = E.valuate({ id: 'x' }, [
    { id: 'a', sold_price: 60, evidence_type: 'collector_report', first_party: true,
      condition: 'Good', completeness: 'bare' }
  ], CFG);
  assert.strictEqual(v.strong_evidence_count, 1,
    'a first-party sale is strong even without a listing id');
  assert.strictEqual(v.first_party_count, 1);
  assert.ok(v.why.some((w) => /yourself/.test(w)));
});

test('a first-party sale does not suppress the usual caveats', () => {
  const v = E.valuate({ id: 'x', release_status: 'current' }, [
    { id: 'a', sold_price: 60, evidence_type: 'completed_sale', first_party: true,
      condition: 'Good', completeness: 'bare' }
  ], CFG);
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
  // Kennel Pals has one comp. Against the median it looks like a 40% discount;
  // against the floor it is not cheap enough, which is the correct answer.
  const listing = (ask) => ({ evidence_type: 'active_listing',
    item_id: 'kennel-pals-calico-cat', ask_price: ask, condition: 'Good', title: 't' });
  const ctx = (ask) => ({ config: CFG, listings: [listing(ask)],
    itemById: itemById, valuationFor: valueOf });

  const v = valueOf('kennel-pals-calico-cat');
  assert.ok(v.lower_bound < v.fair_market * 0.8, 'one comp should widen the gap');
  assert.strictEqual(E.findDeals(ctx(v.fair_market * 0.6)).length, 0,
    '40% off the median is not enough when there is one comp behind it');
  assert.strictEqual(E.findDeals(ctx(v.fair_market * 0.3)).length, 1,
    'a genuine bargain still gets through');
});

test('a deal reports both the median and the floor it was judged against', () => {
  const d = E.findDeals({ config: CFG, itemById: itemById, valuationFor: valueOf,
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
    { tush_tag_missing: true, customised: true, unstuffed: true });
  assert.ok(wrecked.modifiers.factor < 0.5);
  assert.strictEqual(wrecked.modifiers.capped, false);
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


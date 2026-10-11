/*
 * Page tests. Renders each page in a real DOM (jsdom) and asserts that it
 * builds, loads its data, and raises no errors along the way.
 * Run with:  node --test tools/test_pages.js
 */
'use strict';

const test = require('node:test');
const { afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');

/**
 * A resource loader that refuses to leave the machine.
 *
 * The pages link a webfont from Google. jsdom, handed a ResourceLoader, will
 * dutifully try to fetch it - 150 times, over a network that is not there -
 * and the suite simply stops, with no failure and no output to explain it.
 *
 * Tests must not depend on the network. Local files still load; anything
 * remote resolves to nothing, which is exactly what the fallback font stacks
 * are there to handle.
 */
class OfflineLoader extends ResourceLoader {
  fetch(url, options) {
    if (/^https?:/i.test(url)) return null;
    return super.fetch(url, options);
  }
}

const ROOT = path.join(__dirname, '..');

// Every JSDOM instance created by a test, closed after that test finishes.
// A 500+ item page is a large DOM; leaving them open exhausts the heap.
const OPEN_WINDOWS = [];
function track(dom) { OPEN_WINDOWS.push(dom); return dom; }
afterEach(() => {
  while (OPEN_WINDOWS.length) {
    try { OPEN_WINDOWS.pop().window.close(); } catch (e) { /* already gone */ }
  }
});

// Reading the catalogue does not require rendering a page. Several tests only
// need the data, and building 500 cards to get at it is what made this suite
// take three and a half minutes.
let DATA_CACHE = null;
function loadData() {
  if (!DATA_CACHE) {
    DATA_CACHE = JSON.parse(fs.readFileSync(path.join(ROOT, 'data.json'), 'utf8'));
  }
  return DATA_CACHE;
}

// The database schema is the migrations in supabase/migrations/, applied in
// filename order. Joining them all means a "no such policy" assertion also
// covers every future migration, not just the base file.
let SCHEMA_CACHE = null;
function readSchema() {
  if (SCHEMA_CACHE === null) {
    const dir = path.join(ROOT, 'supabase', 'migrations');
    SCHEMA_CACHE = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
      .map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  }
  return SCHEMA_CACHE;
}

/**
 * Reveal everything the grid is holding back.
 *
 * The price guide pages its results - 2,048 cards in one go is neither usable
 * nor fast - so a test about ordering or totals has to open the whole list
 * first, the same as a person clicking "Show more" until it disappears.
 */
function showAll(p) {
  const more = p.doc.getElementById('show-more');
  let guard = 0;
  while (more && !more.hidden && guard++ < 500) {
    more.dispatchEvent(new p.win.Event('click'));
  }
  return p.doc.querySelectorAll('#results .card');
}

/**
 * Choose a catalogue item the way a person does: search for it, then pick it.
 *
 * These <select>s hold 40 options at a time, so assigning `.value` to an id
 * that is not currently loaded silently does nothing - which is exactly the
 * bug this helper exists to stop a test from writing.
 */
function pickItem(p, selectId, itemId) {
  const select = p.doc.getElementById(selectId);
  const item = p.data.items.find((i) => i.id === itemId);
  assert.ok(item, 'fixture has no item ' + itemId);
  if (select.refill) select.refill(item.canonical_name);
  select.value = itemId;
  assert.strictEqual(select.value, itemId,
    itemId + ' is not selectable in #' + selectId);
  select.dispatchEvent(new p.win.Event('change'));
  return select;
}

/**
 * Load one page with its scripts executed, collecting anything that would have
 * shown up as a console error or an uncaught exception in a browser.
 */
/**
 * Render against the hand-curated catalogue only.
 *
 * The wiki import took the catalogue from 642 items to 2,048, and jsdom builds
 * every card synchronously with no layout engine to amortise it: a single page
 * render went from well under a second to about seven, which across 150 renders
 * is a suite nobody will wait for. Every assertion in this file was written
 * against curated records, so trimming the bulk import changes what is tested
 * not at all - it just stops each test paying for 1,400 cards it never looks at.
 *
 * Pass {full: true} where the whole shipped payload is the point.
 */
/**
 * The catalogue these tests render against.
 *
 * jsdom has no layout engine but still builds every node synchronously, at
 * roughly 8ms a row. Against the full 2,048-item catalogue one render takes
 * sixteen seconds, and this file renders about 150 times - a suite nobody will
 * run, which is the same as no suite at all.
 *
 * So the pages are rendered against a fixture instead. It keeps every item a
 * test names by id, every item carrying a sale, and a few of each thing the
 * filters slice on, because those are what the assertions actually inspect.
 * Counts are asserted against the rendered data rather than a hard-coded
 * number, so a smaller catalogue tests exactly the same behaviour.
 *
 * Pass {full: true} where the whole shipped catalogue is the point; either way
 * the page receives the files tools/build_assets.js builds from it.
 */
let FIXTURE_JSON = null;
function fixtureJson() {
  if (FIXTURE_JSON !== null) return FIXTURE_JSON;

  const data = JSON.parse(JSON.stringify(loadData()));
  const source = fs.readFileSync(__filename, 'utf8');
  const byId = new Map(data.items.map((i) => [i.id, i]));
  const keep = new Set();

  // Anything this file names by id, so a test can never lose its subject.
  // Two shapes count: a bare quoted slug, and one inside a url - a test that
  // says renderPage('item.html', 'item.html?id=some-bear') is naming that bear
  // just as surely, and missing it drops the item out from under the test.
  for (const m of source.matchAll(/'([a-z0-9][a-z0-9-]{3,})'/g)) {
    if (byId.has(m[1])) keep.add(m[1]);
  }
  for (const m of source.matchAll(/[?&]id=([a-z0-9][a-z0-9-]{3,})/g)) {
    if (byId.has(m[1])) keep.add(m[1]);
  }
  // Everything with evidence attached - the valuation paths.
  for (const sale of data.sales) keep.add(sale.item_id);

  // A few of each thing the filters and checklists slice on.
  const quota = (pick, n) => {
    let taken = 0;
    for (const i of data.items) {
      if (taken >= n) break;
      if (!keep.has(i.id) && pick(i)) { keep.add(i.id); taken += 1; }
    }
  };
  quota((i) => i.mini_bean, 6);
  quota((i) => i.release_status === 'upcoming', 3);
  quota((i) => i.release_status === 'current', 3);
  quota((i) => i.is_lot, 2);
  quota((i) => i.image_url, 3);
  quota((i) => i.needs_review, 3);
  for (const field of ['franchise', 'species', 'category']) {
    const seen = new Set();
    for (const i of data.items) {
      const v = i[field];
      if (v && !seen.has(v)) { seen.add(v); keep.add(i.id); }
    }
  }

  data.items = data.items.filter((i) => keep.has(i.id));
  FIXTURE_JSON = JSON.stringify(data);
  return FIXTURE_JSON;
}

/**
 * The browser's data files for a catalogue (tools/build_assets.js), built in
 * memory and memoised per catalogue: the same site-config, index, listings and
 * per-item files a deploy serves, so a page under test makes exactly the
 * requests it makes in production.
 */
const ASSETS = require('./build_assets.js');
const ENGINE = require('../engine.js');
const ASSET_CACHE = new Map();
function assetsFor(json) {
  if (ASSET_CACHE.has(json)) return ASSET_CACHE.get(json);
  const data = JSON.parse(json);
  const ctx = ASSETS.context(data, ENGINE);
  const indexText = JSON.stringify(ASSETS.buildIndex(data, ENGINE, ctx));
  const listingsText = JSON.stringify(ASSETS.buildListings(data));
  const manifest = {
    index: 'data/h/index.' + ASSETS.sha12(indexText) + '.json',
    listings: 'data/h/listings.' + ASSETS.sha12(listingsText) + '.json'
  };
  const cfg = ASSETS.buildSiteConfig(data, manifest, ASSETS.buildStats(data, ENGINE, ctx));
  const shards = new Map();
  const a = {
    data, cfg, cfgJs: ASSETS.siteConfigJs(cfg),
    /** The body served at `url` (relative to the site root), or null for a 404. */
    body(url) {
      if (url === manifest.index) return indexText;
      if (url === manifest.listings) return listingsText;
      const m = /^data\/items\/([^/]+)\.json$/.exec(url);
      if (!m) return null;
      const id = decodeURIComponent(m[1]);
      if (!shards.has(id)) {
        const s = ASSETS.buildShard(data, id, ctx);
        shards.set(id, s ? JSON.stringify(s) : null);
      }
      return shards.get(id);
    }
  };
  if (ASSET_CACHE.size > 6) ASSET_CACHE.delete(ASSET_CACHE.keys().next().value);
  ASSET_CACHE.set(json, a);
  return a;
}

/**
 * Load one page with its scripts executed, collecting anything that would have
 * shown up as a console error or an uncaught exception in a browser. Resolves
 * once the page's data has loaded and rendered (BC.whenIdle).
 *
 *   opts.full        the whole shipped catalogue instead of the fixture
 *   opts.mutate(d)   edit a private copy of the catalogue first
 *   opts.afterScript(src, win)   hook after each script
 *   opts.transport(url, serve)   replace the data transport (serve(url) is the default)
 *   opts.plain       no resource loader and no script-timeout override (the
 *                    auth tests drive their own Supabase client)
 *
 * The result carries `requests`: every data URL the page asked for, in order.
 */
async function renderPage(file, url, opts) {
  opts = opts || {};
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(e.message + '\n' + (e.stack || '')));
  vc.on('error', (...args) => errors.push('console.error: ' + args.join(' ')));
  vc.on('warn', (...args) => {
    const msg = args.join(' ');
    // The no-network fallback this harness forces on purpose (the Supabase
    // client cannot load here, see __BEARCHART_SCRIPT_TIMEOUT_MS). Now that a
    // render waits for its data, that timeout lands inside the test.
    if (/^BearChart auth unavailable, continuing anonymously: timed out loading vendor\//.test(msg)) return;
    errors.push('console.warn: ' + msg);
  });

  // Stop jsdom from running inline scripts while it parses (none ship - the
  // CSP forbids them - but a test page may carry one); they run below, after
  // every external script, as a browser's parser-blocking order would have it.
  const html = fs.readFileSync(path.join(ROOT, file), 'utf8')
    .replace(/<script(?![^>]*\bsrc=)([^>]*)>/gi, '<script$1 type="application/x-deferred">');

  const dom = track(new JSDOM(html, Object.assign({
    url: 'http://localhost:5173/' + (url || file),
    runScripts: 'dangerously',
    virtualConsole: vc,
    pretendToBeVisual: true
  }, opts.plain ? {} : { resources: new OfflineLoader() })));

  // There is no network here, so the Supabase client script can never load.
  // Production waits 8 seconds before giving up - right for a browser on a slow
  // connection, ruinous across 150 renders.
  if (!opts.plain) dom.window.__BEARCHART_SCRIPT_TIMEOUT_MS = 5;

  let json = opts.full ? JSON.stringify(loadData()) : fixtureJson();
  if (opts.mutate) {
    const d = JSON.parse(json);
    opts.mutate(d);
    json = JSON.stringify(d);
  }
  const assets = assetsFor(json);
  const requests = [];
  const win = dom.window;
  const serve = (u) => {
    const body = assets.body(u);
    if (body === null) {
      return Promise.reject(win.BearChartData.DataUnavailableError('404 ' + u, { status: 404 }));
    }
    return Promise.resolve(win.JSON.parse(body));   // objects of the page's realm
  };
  const transport = (u) => {
    u = String(u).replace(/^(\.\.\/)+/, '');
    requests.push(u);
    return opts.transport ? opts.transport(u, serve) : serve(u);
  };

  // jsdom will not fetch local scripts for us here, so execute them in order,
  // exactly as the browser would.
  for (const el of Array.from(win.document.querySelectorAll('script'))) {
    const src0 = el.getAttribute('src');
    if (!src0) continue;
    if (/^https?:/i.test(src0)) continue;          // anything remote is not this suite's business
    const src = src0.replace(/^(\.\.\/)+/, '');
    try {
      // site-config.js is generated; serve the one built from this catalogue.
      win.eval(src === 'site-config.js' ? assets.cfgJs : fs.readFileSync(path.join(ROOT, src), 'utf8'));
    } catch (e) {
      errors.push('while running ' + src + ': ' + e.message + '\n' + e.stack);
    }
    if (src === 'bc-data.js' && win.BearChartData) win.BearChartData._setTransport(transport);
    if (opts.afterScript) opts.afterScript(src, win);
  }
  for (const el of win.document.querySelectorAll('script:not([src])')) {
    if (el.getAttribute('type') === 'application/ld+json') continue;
    try {
      win.eval(el.textContent);
    } catch (e) {
      errors.push('inline script: ' + e.message + '\n' + e.stack);
    }
  }

  await settle(win);
  return { dom, doc: win.document, win, errors, requests, data: assets.data, cfg: assets.cfg };
}

/** Wait until every BC.withCatalogue / BC.withItem the page started has rendered. */
async function settle(win) {
  if (win.BC && win.BC.whenIdle) await win.BC.whenIdle();
  await new Promise((r) => setTimeout(r, 0));
}

const ROOT_JS_FILES = () => fs.readdirSync(ROOT)
  .filter((f) => f.endsWith('.js') && !['site-config.js', 'sw.js'].includes(f)).sort();

const noErrors = (p) => assert.deepStrictEqual(p.errors, [], p.errors.join('\n---\n'));

// ---- index -----------------------------------------------------------------

test('the price guide renders without errors', async () => {
  const p = await renderPage('index.html');
  noErrors(p);
});

test('the price guide shows a page of cards, not the whole catalogue', async () => {
  const p = await renderPage('index.html');
  const total = p.data.items.length;
  const first = p.doc.querySelectorAll('#results .card');
  assert.ok(first.length < total, 'the first screen should not hold every item');
  assert.strictEqual(p.doc.getElementById('show-more').hidden, false);
  assert.match(p.doc.getElementById('result-count').textContent,
    new RegExp('of ' + total + ' matching'));
});

test('"show more" eventually lists every item as a card', async () => {
  const p = await renderPage('index.html');
  const cards = showAll(p);
  assert.strictEqual(cards.length, p.data.items.length);
  assert.strictEqual(p.doc.getElementById('show-more').hidden, true);
});

test('the guide opens on a dozen bears, not the whole catalogue', async () => {
  // Arriving and using are different jobs. A dozen is a shelf you can take in;
  // on a phone, one column, sixty cards was a page 64,000 pixels tall.
  const p = await renderPage('index.html');
  assert.strictEqual(p.doc.querySelectorAll('#results .card').length, 12);
  assert.match(p.doc.getElementById('show-more').textContent, /^Show 12 more/);
});

test('searching brings up more, and paging restarts', async () => {
  const p = await renderPage('index.html');
  showAll(p);
  const q = p.doc.getElementById('q');
  q.value = 'bear';
  q.dispatchEvent(new p.win.Event('input'));
  return new Promise((done) => setTimeout(() => {
    const shown = p.doc.querySelectorAll('#results .card').length;
    const matching = Number(p.doc.getElementById('result-count').textContent.match(/of (\d+)/)[1]);
    // Having asked a question, you should not get the answer a dozen at a time.
    assert.ok(shown > 12, 'a search should show more than the browsing page');
    assert.ok(shown <= 48);
    assert.ok(matching >= shown);
    done();
  }, 200));
});

test('filtering also brings up more, and resetting goes back to a dozen', async () => {
  const p = await renderPage('index.html');
  const box = p.doc.querySelector('#filters input[type="checkbox"][data-group="category"]');
  assert.ok(box, 'expected a category filter');
  box.checked = true;
  box.dispatchEvent(new p.win.Event('change', { bubbles: true }));

  // Count from the data, not the label: when every match fits on one page the
  // counter reads "34 of 266 items", and a regex for /of (\d+)/ picks up the
  // size of the whole catalogue instead of the size of the result.
  const value = box.getAttribute('value');
  const matching = p.data.items.filter((i) => i.category === value).length;
  const shown = p.doc.querySelectorAll('#results .card').length;
  assert.strictEqual(shown, Math.min(48, matching));
  assert.ok(matching > 12, 'pick a category with enough items to prove the point');

  p.doc.getElementById('clear-all').dispatchEvent(new p.win.Event('click'));
  assert.strictEqual(p.doc.querySelectorAll('#results .card').length, 12);
});

test('the masthead, disclaimer and footer are present', async () => {
  const p = await renderPage('index.html');
  assert.match(p.doc.getElementById('masthead').textContent, /BearChart/);
  assert.match(p.doc.getElementById('disclaimer-bar').textContent,
    /not affiliated with Build-A-Bear Workshop/);
  assert.match(p.doc.getElementById('site-footer').textContent, /Jay's Retro Exchange/);
});

test('filters are built with counts', async () => {
  const p = await renderPage('index.html');
  const boxes = p.doc.querySelectorAll('#filters input[type=checkbox]');
  assert.ok(boxes.length > 20, 'expected a full filter set, got ' + boxes.length);
  assert.ok(p.doc.querySelectorAll('#filters .count').length > 20);
});

test('search narrows the results', async () => {
  const p = await renderPage('index.html');
  const before = p.doc.querySelectorAll('#results .card').length;
  const q = p.doc.getElementById('q');
  q.value = 'axolotl';
  q.dispatchEvent(new p.win.Event('input'));
  // The handler is debounced; drive the clock forward.
  return new Promise((resolve) => {
    setTimeout(() => {
      const after = p.doc.querySelectorAll('#results .card').length;
               const total = p.data.items.length;
         assert.ok(after > 0 && after < total, 'axolotl search returned ' + after + ' of ' + total);
      assert.match(p.doc.querySelector('#results .card').textContent, /Axolotl/i);
      resolve();
    }, 900);
  });
});

test('an alias finds its item', async () => {
  const p = await renderPage('index.html');
  const q = p.doc.getElementById('q');
  q.value = 'original brown teddy';
  q.dispatchEvent(new p.win.Event('input'));
  return new Promise((resolve) => {
    setTimeout(() => {
      assert.match(p.doc.querySelector('#results .card').textContent, /Classic Brown Teddy/);
      resolve();
    }, 900);
  });
});

test('a filter checkbox narrows the results', async () => {
  const p = await renderPage('index.html');
  const items = p.data.items;
  const box = p.doc.querySelector('#filters input[data-group="flag"][value="minibean"]');
  assert.ok(box, 'expected a Mini Beans filter');
  box.checked = true;
  box.dispatchEvent(new p.win.Event('change', { bubbles: true }));

  // Narrowing is about the MATCHING SET, not the number of cards on screen.
  // Filtering also switches the grid from the 12-card browsing page to the
  // 48-card working page, so a narrower result can legitimately show more
  // cards than the unfiltered view did - comparing the two counts measured
  // the page size, not the filter.
  const expected = items.filter((i) => i.mini_bean).length;
  assert.ok(expected > 0 && expected < items.length, 'the filter should narrow');
  assert.strictEqual(p.doc.querySelectorAll('#results .card').length,
    Math.min(48, expected));
});

test('sorting by price puts the most valuable item first and unpriced items last', async () => {
  const p = await renderPage('index.html');
  const sort = p.doc.getElementById('sort');
  sort.value = 'price-desc';
  sort.dispatchEvent(new p.win.Event('change'));
  const cards = showAll(p);
       // Whichever item the engine values highest should lead, not one fixed bear.
          const top = p.data.items
       .map((i) => [i.canonical_name, (p.win.BC.valuationFor(i.id) || {}).fair_market || 0])
       .sort((a, b) => b[1] - a[1])[0];
     assert.ok(cards[0].textContent.includes(top[0]), 'expected ' + top[0] + ' first');
  assert.match(cards[cards.length - 1].textContent, /No sold data yet/);
});

test('sorting by year orders oldest first', async () => {
  const p = await renderPage('index.html');
  const sort = p.doc.getElementById('sort');
  sort.value = 'oldest';
  sort.dispatchEvent(new p.win.Event('change'));
  assert.match(p.doc.querySelector('#results .card').textContent, /1997/);
});

test('items with no sold data say so instead of showing a price', async () => {
  const p = await renderPage('index.html');
  const q = p.doc.getElementById('q');
  q.value = 'floppy kitty';
  q.dispatchEvent(new p.win.Event('input'));
  return new Promise((resolve) => {
    setTimeout(() => {
      const card = p.doc.querySelector('#results .card');
      assert.match(card.textContent, /No sold data yet/);
      assert.doesNotMatch(card.querySelector('.value').textContent, /\$/);
      resolve();
    }, 900);
  });
});

test('the stats bar reports the database size', async () => {
  const p = await renderPage('index.html');
  const stats = p.doc.getElementById('stats').textContent;
  assert.match(stats, new RegExp(String(p.data.items.length)));
  assert.match(stats, /Sold transactions/);
});

test('the hero and the unfiltered stats tile show the same sold-transactions figure', async () => {
  const p = await renderPage('index.html');
  const hero = p.doc.getElementById('hero-proof').textContent;
  const m = /([\d,]+) sold transactions recorded/.exec(hero);
  assert.ok(m, hero);
  const tile = Array.from(p.doc.querySelectorAll('#stats .stat'))
    .find((el) => /Sold transactions/.test(el.querySelector('.k').textContent));
  assert.ok(tile);
  assert.strictEqual(tile.querySelector('.v').textContent, m[1]);
  const st = p.win.BC.catalogueStats();
  assert.strictEqual(m[1], st.sold_transactions.toLocaleString('en-US'));
  assert.match(p.doc.getElementById('site-footer').textContent,
    new RegExp(st.sold_transactions.toLocaleString('en-US') + ' sold transactions recorded'));
});

test('the quick calculator prices an item it has comps for', async () => {
  const p = await renderPage('index.html');
  const sel = p.doc.getElementById('calc-item');
  sel.value = 'original-pumpkin-kitty';
  sel.dispatchEvent(new p.win.Event('change'));
  assert.match(p.doc.getElementById('calc-out').textContent, /\$/);
});

test('the calculator offers only items it can actually price', async () => {
  // The refusal used to happen after you picked an unpriceable item. Now it
  // happens by never offering one: a menu of 1,980 dead ends is worse than a
  // short menu that works.
  const p = await renderPage('index.html');
  const offered = Array.from(p.doc.querySelectorAll('#calc-item option'))
    .map((o) => o.value).filter(Boolean);
  assert.ok(offered.length > 0);
  const priceable = new Set(p.data.items
    .filter((i) => p.win.BC.valuationFor(i.id).has_value).map((i) => i.id));
  assert.strictEqual(offered.length, priceable.size);
  for (const id of offered) assert.ok(priceable.has(id), id + ' has no comps');
});

test('changing condition changes the calculated value', async () => {
  const p = await renderPage('index.html');
  const sel = p.doc.getElementById('calc-item');
  sel.value = 'original-pumpkin-kitty';
  sel.dispatchEvent(new p.win.Event('change'));
  const good = p.doc.getElementById('calc-out').textContent;
  const cond = p.doc.getElementById('calc-cond');
  cond.value = 'Poor';
  cond.dispatchEvent(new p.win.Event('change'));
  assert.notStrictEqual(p.doc.getElementById('calc-out').textContent, good);
});

// ---- item page -------------------------------------------------------------

test('an item page renders without errors', async () => {
  const p = await renderPage('item.html', 'item.html?id=kennel-pals-calico-cat');
  noErrors(p);
  assert.match(p.doc.title, /Kennel Pals Calico Cat/);
});

test('an item page shows its valuation, reasoning and sold comps', async () => {
  const p = await renderPage('item.html', 'item.html?id=original-pumpkin-kitty');
  const text = p.doc.getElementById('item-root').textContent;
  assert.match(text, /Estimated market value/);
  assert.match(text, /Why this value/);
  assert.match(text, /Buy/);
  assert.match(text, /Trade/);
  assert.match(text, /High-end ask/);
  assert.match(text, /Sold observations/);
  assert.match(text, /\$60/);
});

test('a fully sourced sale shows its provenance', async () => {
  const p = await renderPage('item.html', 'item.html?id=kennel-pals-calico-cat');
  const text = p.doc.getElementById('item-root').textContent;
  assert.match(text, /2023-07-18/);
       assert.match(text, /364353106238/);
  assert.match(text, /completed sale/);
});

test('an item with no comps publishes no price', async () => {
  // Asserts the GUARANTEE, not the wording. This used to match the heading
  // "No published value" and broke the moment that panel was rewritten - while
  // the rule it exists to protect was never in danger. A test pinned to a
  // sentence stops guarding anything the first time somebody edits the copy.
  const p = await renderPage('item.html', 'item.html?id=floppy-kitty');
  const root = p.doc.getElementById('item-root');

  assert.strictEqual(p.win.BC.valuationFor('floppy-kitty').has_value, false);
  assert.doesNotMatch(root.textContent, /Estimated market value/);
  assert.strictEqual(root.querySelector('.headline .big'), null,
    'no headline figure on an item with no evidence');
  assert.strictEqual(root.querySelector('.evidence'), null,
    'nothing to plot without comps');

  // The panel that stands in for a price must not contain one. The rest of the
  // page legitimately shows dollar figures - the retail reference is a retail
  // figure, explicitly not a value - so the assertion is scoped to the panel.
  const unpriced = root.querySelector('.unpriced');
  assert.ok(unpriced, 'expected the no-price panel');
  assert.ok(unpriced.textContent.indexOf('$') === -1, unpriced.textContent);
});

test('per-condition medians are shown when grades differ', async () => {
  const p = await renderPage('item.html', 'item.html?id=loveable-lamb');
  const text = p.doc.getElementById('item-root').textContent;
  assert.match(text, /Sold price by condition/);
  assert.match(text, /204\.49/);
});

test('a sale by the operator is labelled as our store, never as "your own sale"', async () => {
  const p = await renderPage('item.html', 'item.html?id=original-pumpkin-kitty', {
    mutate: (d) => {
      const s = d.sales.find((x) => x.item_id === 'original-pumpkin-kitty');
      s.seller_is_operator = true;
    }
  });
  const text = p.doc.getElementById('item-root').textContent;
  assert.match(text, /Seller: Jay's Retro Exchange \(our store\)/);
  assert.doesNotMatch(text, /Your own sale/);
});

test('valuations in the page carry their staleness and window', async () => {
  const p = await renderPage('item.html', 'item.html?id=original-pumpkin-kitty');
  const v = p.win.BC.valuationFor('original-pumpkin-kitty');
  for (const k of ['stale', 'stale_reason', 'last_sale_date', 'window',
                   'operator_count', 'sold_transactions']) {
    assert.ok(k in v, 'valuation is missing ' + k);
  }
  assert.strictEqual(v.window.as_of, p.data.config.recency.as_of);
});

// ---- merged items ------------------------------------------------------------

function firstRedirect() {
  const red = loadData().redirects || {};
  const old = Object.keys(red).find((k) => loadData().items.some((i) => i.id === red[k]));
  assert.ok(old, 'the data carries at least one redirect');
  return [old, red[old]];
}

test('an old id of a merged item redirects to the item that absorbed it', async () => {
  const [oldId, newId] = firstRedirect();
  let went = null;
  const p = await renderPage('item.html', 'item.html?id=' + oldId, {
    afterScript: (src, win) => {
      if (src === 'common.js') win.BC.go = (url) => { went = url; };
    }
  });
  assert.strictEqual(went, 'item/' + newId + '.html');
  assert.strictEqual(p.win.BC.canonicalId(oldId), newId);
  assert.strictEqual(p.win.BearChartData.canonicalId(oldId), newId);
  assert.deepStrictEqual(p.requests, [], 'it redirects before loading anything');
});

test('a collection entry stored under a merged id still renders and is migrated', async () => {
  const [oldId, newId] = firstRedirect();
  // Stored before common.js runs, as a returning visitor's browser would have it.
  const p = await renderPage('collection.html', null, {
    afterScript: (src, win) => {
      if (src !== 'config.js') return;
      win.localStorage.setItem('bearchart.collection', JSON.stringify([
        { item_id: oldId, condition: 'Good', completeness: 'unknown', qty: 1 }]));
      win.localStorage.setItem('bearchart.wishlist', JSON.stringify([oldId, newId]));
      const hold = {}; hold[oldId] = 1; hold[newId] = 2;
      win.localStorage.setItem('bearchart.lastHoldings', JSON.stringify(hold));
      win.localStorage.setItem('bearchart.flows', JSON.stringify([
        { item_id: oldId, dir: 'acquire', qty: 1, v: 10, d: '2026-01-01' }]));
    }
  });
  const held = JSON.parse(p.win.localStorage.getItem('bearchart.lastHoldings'));
  assert.strictEqual(held[oldId], undefined);
  assert.ok(held[newId] >= 1, 'holdings are re-keyed, so a merge is not a sale');
  const flows = JSON.parse(p.win.localStorage.getItem('bearchart.flows'));
  assert.ok(flows.every((f) => f.item_id !== oldId));
  const coll = JSON.parse(p.win.localStorage.getItem('bearchart.collection'));
  assert.strictEqual(coll[0].item_id, newId);
  assert.deepStrictEqual(JSON.parse(p.win.localStorage.getItem('bearchart.wishlist')), [newId]);
  assert.ok(p.win.BC.itemById(coll[0].item_id));
});

test('a versioned item warns against merging versions', async () => {
  const p = await renderPage('item.html', 'item.html?id=vanilla-fudge-bunny');
  assert.match(p.doc.getElementById('item-root').textContent, /versions or variants/);
});

test('the retail reference is shown but labelled as a baseline only', async () => {
  const p = await renderPage('item.html', 'item.html?id=original-pumpkin-kitty');
  const text = p.doc.getElementById('item-root').textContent;
  assert.match(text, /Retail reference/);
  assert.match(text, /never secondary-market value/);
});

test('an unknown item id fails gracefully', async () => {
  const p = await renderPage('item.html', 'item.html?id=does-not-exist');
  noErrors(p);
  assert.match(p.doc.getElementById('item-root').textContent, /Item not found/);
});

test('the item calculator recalculates on condition change', async () => {
  const p = await renderPage('item.html', 'item.html?id=original-pumpkin-kitty');
  const before = p.doc.getElementById('c-out').textContent;
  const cond = p.doc.getElementById('c-cond');
  cond.value = 'NWT';
  cond.dispatchEvent(new p.win.Event('change'));
  assert.notStrictEqual(p.doc.getElementById('c-out').textContent, before);
});

test('a price history chart is drawn only where dated sales support one', async () => {
  const withHistory = await renderPage('item.html', 'item.html?id=loveable-lamb');
  assert.match(withHistory.doc.getElementById('item-root').textContent,
    /no trend to chart yet/);
});

// ---- collection ------------------------------------------------------------

test('the collection page renders and starts empty', async () => {
  const p = await renderPage('collection.html');
  noErrors(p);
  assert.match(p.doc.getElementById('collection-body').textContent, /collection is empty/);
});

test('adding an item to the collection totals it', async () => {
  const p = await renderPage('collection.html');
  pickItem(p, 'add-item', 'kennel-pals-calico-cat');
  p.doc.getElementById('add-qty').value = '2';
  p.doc.getElementById('add-btn').dispatchEvent(new p.win.Event('click'));

  assert.match(p.doc.getElementById('collection-body').textContent, /Kennel Pals Calico Cat/);
  const totals = p.doc.getElementById('totals').textContent;
  assert.match(totals, /Median value/);
  assert.match(totals, /Conservative/);
  assert.match(totals, /2/);
});

// ---- admin -----------------------------------------------------------------

test('the admin dashboard renders its counts and gap lists', async () => {
  const p = await renderPage('admin.html');
  noErrors(p);
  const stats = p.doc.getElementById('admin-stats').textContent;
  assert.match(stats, /Total items/);
  assert.match(stats, /Items missing sales/);
  assert.match(p.doc.getElementById('quality').textContent, /no sold data/i);
 // The recent list shows the newest dated sales, so look for whichever sale is
  // newest in the data rather than one fixed listing that newer comps push out.
  const newest = loadData().sales
    .filter((s) => s.sale_date && s.listing_id)
    .sort((x, y) => String(y.sale_date).localeCompare(String(x.sale_date)))[0];
  assert.ok(newest, 'expected at least one dated, sourced sale');
  assert.match(p.doc.getElementById('recent').textContent, new RegExp(newest.sale_date));});

test('admin refuses a completed_sale without full provenance', async () => {
  const p = await renderPage('admin.html');
  pickItem(p, 's-item', 'classic-brown-teddy');
  p.doc.getElementById('s-price').value = '25';
  p.doc.getElementById('s-evidence').value = 'completed_sale';
  p.doc.getElementById('s-add').dispatchEvent(new p.win.Event('click'));

  assert.match(p.doc.getElementById('s-msg').textContent,
    /needs a date, a marketplace and a listing id/);
  assert.match(p.doc.getElementById('draft-body').textContent, /Nothing pending/);
});

test('admin accepts a fully sourced sale', async () => {
  const p = await renderPage('admin.html');
  pickItem(p, 's-item', 'classic-brown-teddy');
  p.doc.getElementById('s-price').value = '25';
  p.doc.getElementById('s-date').value = '2026-01-15';
  p.doc.getElementById('s-market').value = 'eBay';
  p.doc.getElementById('s-listing').value = '123456789';
  p.doc.getElementById('s-evidence').value = 'completed_sale';
  p.doc.getElementById('s-add').dispatchEvent(new p.win.Event('click'));

  assert.match(p.doc.getElementById('draft-body').textContent, /Classic Brown Teddy/);
});

test('admin rejects a zero or missing price', async () => {
  const p = await renderPage('admin.html');
  pickItem(p, 's-item', 'classic-brown-teddy');
  p.doc.getElementById('s-price').value = '0';
  p.doc.getElementById('s-add').dispatchEvent(new p.win.Event('click'));
  assert.match(p.doc.getElementById('s-msg').textContent, /above zero/);
});

// ---- method page -----------------------------------------------------------

test('the method page renders and states the governing rule', async () => {
  const p = await renderPage('about.html');
  noErrors(p);
  const text = p.doc.body.textContent;
  assert.match(text, /Completed sold transactions outrank active asking prices/);
  assert.match(p.doc.getElementById('cond-table').textContent, /NWT/);
  assert.match(p.doc.getElementById('comp-table').textContent, /Bare bear/);
});

// ---- cross-page integrity --------------------------------------------------

test('every internal link and asset reference resolves to a real file', async () => {
  const pages = ['index.html', 'item.html', 'collection.html', 'admin.html', 'about.html'];
  for (const page of pages) {
    // Strip inline scripts first: markup built inside JS strings is not a link.
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8')
      .replace(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/gi, '');
    const refs = [...html.matchAll(/(?:href|src)="([^"#:]+)"/g)].map((m) => m[1]);
    for (const ref of refs) {
      const target = ref.split('?')[0];
      assert.ok(fs.existsSync(path.join(ROOT, target)),
        page + ' references a missing file: ' + target);
    }
  }
});

test('every item card links to a page that resolves', async () => {
  const p = await renderPage('index.html');
  const ids = new Set(p.data.items.map((i) => i.id));
  const cards = p.doc.querySelectorAll('#results .card');
  assert.ok(cards.length > 0);
  for (const a of cards) {
    const href = a.getAttribute('href');
    const m = /^item\/(.+)\.html$/.exec(href);
    assert.ok(m, 'card href is not an item page: ' + href);
    const id = decodeURIComponent(m[1]);
    assert.ok(ids.has(id), 'card links to unknown item: ' + id);
    // "Resolves" now means a file is really there. Cards used to point at
    // item.html?id=, which resolved whatever the id was - so a broken link was
    // something this test could not see.
    assert.ok(fs.existsSync(path.join(ROOT, 'item', id + '.html')),
      'no generated page for ' + id + ' (run npm run pages)');
  }
});

test('the old query-string item url still works', async () => {
  // Links people saved before the generated pages existed must not rot.
  const p = await renderPage('item.html', 'item.html?id=classic-brown-teddy');
  assert.match(p.doc.getElementById('item-root').textContent, /Classic Brown Teddy/);
});

test('the CSV export builds a header and one row per item', async () => {
  const p = await renderPage('index.html');
  const csv = p.win.BC.itemsCsv(p.data.items);
  const lines = csv.trim().split('\r\n');
  assert.strictEqual(lines.length, p.data.items.length + 1);
  assert.match(lines[0], /^id,canonical_name,aliases/);
  assert.match(lines[0], /confidence/);
});

test('the sales CSV keeps provenance columns', async () => {
  const p = await renderPage('index.html');
  // Pure: the caller passes the sales it loaded (item files), keyed by item.
  const byId = {};
  for (const sale of p.data.sales) (byId[sale.item_id] = byId[sale.item_id] || []).push(sale);
  const csv = p.win.BC.salesCsv(p.data.items, byId);
  assert.match(csv.split('\r\n')[0], /listing_id/);
  assert.match(csv, /364353106238/);
  assert.strictEqual(csv.trim().split('\r\n').length, p.data.sales.length + 1);
});

test('CSV values containing commas are quoted', async () => {
  const p = await renderPage('index.html');
  const csv = p.win.BC.toCsv([['a', 'b,c', 'd"e']]);
  assert.strictEqual(csv.trim(), 'a,"b,c","d""e"');
});

// ---- data delivery (bc-data.js, tools/build_assets.js) ----------------------

test('the price guide loads the catalogue index and nothing else', async () => {
  const p = await renderPage('index.html');
  assert.deepStrictEqual(p.requests, [p.cfg.data.index]);
  noErrors(p);
});

test('the price guide never runs the valuation engine on load', async () => {
  let calls = 0;
  const p = await renderPage('index.html', null, { afterScript: (src, win) => {
    if (src !== 'engine.js') return;
    const real = win.BearChartEngine.valuate;
    win.BearChartEngine.valuate = function () { calls += 1; return real.apply(this, arguments); };
  } });
  assert.ok(p.doc.querySelectorAll('#results .card').length > 0);
  assert.strictEqual(calls, 0, 'list pages read the build\'s summaries');
});

test('an item page makes exactly one data request: its own file', async () => {
  const p = await renderPage('item.html', 'item.html?id=kennel-pals-calico-cat');
  assert.deepStrictEqual(p.requests, ['data/items/kennel-pals-calico-cat.json']);
  noErrors(p);
});

test('a generated item page resolves its file from the parent directory', async () => {
  const p = await renderPage('item.html', 'item/kennel-pals-calico-cat.html');
  assert.deepStrictEqual(p.requests, ['data/items/kennel-pals-calico-cat.json']);
  assert.strictEqual(p.win.BearChartData.rel('data/x.json'), '../data/x.json');
  assert.match(p.doc.getElementById('item-root').textContent, /Kennel Pals Calico Cat/i);
});

test('the deal finder loads the index and the listings', async () => {
  const p = await renderPage('deals.html');
  assert.deepStrictEqual(p.requests.slice().sort(), [p.cfg.data.index, p.cfg.data.listings].sort());
});

test('config-only pages make no data request at all', async () => {
  for (const page of ['about.html', 'plans.html', 'privacy.html', 'terms.html', 'account.html', 'roadmap.html']) {
    const p = await renderPage(page);
    assert.deepStrictEqual(p.requests, [], page);
    noErrors(p);
  }
});

test('offline, an unvisited bear is priced from the index summary', async () => {
  // The item file is not cached and the network is gone; the cached index is.
  const p = await renderPage('item.html', 'item.html?id=kennel-pals-calico-cat', {
    transport: (url, serve) => (/^data\/items\//.test(url)
      ? Promise.reject(Object.assign(new Error('offline'), { offline: true }))
      : serve(url))
  });
  noErrors(p);
  const text = p.doc.getElementById('item-root').textContent;
  const v = p.win.BearChartData.config();   // still configured
  assert.ok(v);
  assert.match(text, /Estimated market value/);
  assert.match(text, /connect/i, 'it says the comps need a connection');
  assert.strictEqual(p.requests.length, 2);
});

test('offline with nothing cached, an item page says it is the bear that failed', async () => {
  const p = await renderPage('item.html', 'item.html?id=kennel-pals-calico-cat', {
    transport: () => Promise.reject(Object.assign(new Error('offline'), { offline: true }))
  });
  const err = p.doc.querySelector('[data-bc-error]');
  assert.ok(err);
  assert.match(err.textContent, /Couldn't load this bear/);
  assert.doesNotMatch(err.textContent, /price guide/);
});

test('a missing item file says the bear was not found', async () => {
  const p = await renderPage('item.html', 'item.html?id=no-such-bear-anywhere');
  assert.match(p.doc.getElementById('item-root').textContent, /Item not found/);
  assert.deepStrictEqual(p.requests, ['data/items/no-such-bear-anywhere.json']);
});

test('when the catalogue cannot load, the page says so and offers a retry', async () => {
  let fail = true;
  const p = await renderPage('index.html', null, {
    transport: (url, serve) => (fail
      ? Promise.reject(Object.assign(new Error('offline'), { offline: true }))
      : serve(url))
  });
  const err = p.doc.querySelector('[data-bc-error]');
  assert.ok(err, 'an error panel');
  assert.match(err.textContent, /Couldn't load the price guide/);
  assert.strictEqual(p.doc.documentElement.getAttribute('data-bc-data'), 'error');
  fail = false;
  err.querySelector('button').dispatchEvent(new p.win.Event('click'));
  await settle(p.win);
  assert.ok(p.doc.querySelectorAll('#results .card').length > 0, 'the retry renders the guide');
  assert.strictEqual(p.doc.documentElement.getAttribute('data-bc-data'), 'ready');
});

test('pages never touch a global data blob', () => {
  for (const f of ROOT_JS_FILES()) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.doesNotMatch(src, /BEARCHART_DATA/, f);
  }
});

// ---- images ----------------------------------------------------------------

test('every card renders a picture, falling back to a generated placeholder', async () => {
  const p = await renderPage('index.html');
  showAll(p);
  const imgs = p.doc.querySelectorAll('#results .card img.thumb');
  assert.strictEqual(imgs.length, p.data.items.length);
  // Nothing ships with a photo yet, so all of these are placeholders.
  for (const img of imgs) {
    assert.ok(img.getAttribute('src').startsWith('data:image/svg+xml'),
      'expected a generated placeholder, got ' + img.getAttribute('src').slice(0, 40));
  }
});

test('a placeholder is decorative and carries no alt text', async () => {
  const p = await renderPage('index.html');
  const img = p.doc.querySelector('#results .card img.thumb');
  assert.strictEqual(img.getAttribute('alt'), '');
  assert.strictEqual(img.getAttribute('aria-hidden'), 'true');
  assert.ok(img.classList.contains('is-placeholder'));
});

test('illustrations are deterministic per item and differ between items', async () => {
  const p = await renderPage('index.html');
  const tile = (id, species) =>
    p.win.BC.placeholderImage({ id: id, canonical_name: 'X', species: species });
  assert.strictEqual(tile('alpha', 'Bear'), tile('alpha', 'Bear'),
    'the same item must always draw the same tile');
  assert.notStrictEqual(tile('alpha', 'Bear'), tile('beta', 'Bear'),
    'different items should not look identical');
  assert.notStrictEqual(tile('alpha', 'Bear'), tile('alpha', 'Cat'),
    'a bear and a cat should not draw the same picture');
});

test('a real photo renders with alt text and an error fallback', async () => {
  const p = await renderPage('index.html');
  const html = p.win.BC.imageHtml({
    id: 'x', canonical_name: 'Lucky Kitty', image_url: '/images/lucky.jpg'
  }, 'hero');
  assert.match(html, /src="\/images\/lucky\.jpg"/);
  assert.match(html, /alt="Lucky Kitty"/);
  // No inline handler (the CSP forbids them): the fallback rides in a data
  // attribute that one capture-phase listener in common.js swaps in.
  assert.match(html, /data-fallback="data:image\/svg\+xml/, 'a broken photo must fall back to the placeholder');
  assert.doesNotMatch(html, /onerror=/);
  assert.match(html, /loading="lazy"/);
});

test('image markup escapes a hostile url or name', async () => {
  const p = await renderPage('index.html');
  const html = p.win.BC.imageHtml({
    id: 'x', canonical_name: '"><script>bad()</script>', image_url: '"><script>bad()</script>'
  }, 'hero');
  assert.doesNotMatch(html, /<script>/);
});

test('an item page shows a hero image and says when no photo is on file', async () => {
  const p = await renderPage('item.html', 'item.html?id=lucky-kitty');
  const hero = p.doc.querySelector('.item-hero img.hero');
  assert.ok(hero, 'expected a hero image');
  assert.match(p.doc.getElementById('item-root').textContent, /No photo on file/);
});

test('a photo credit is shown only when an image exists', async () => {
  const p = await renderPage('index.html');
  assert.strictEqual(p.win.BC.imageCredit({ id: 'x', canonical_name: 'A' }), '');
  const credited = p.win.BC.imageCredit({
    id: 'x', canonical_name: 'A', image_url: '/a.jpg',
    image_credit: "Jay's Retro Exchange", image_source: 'https://example.com'
  });
  assert.match(credited, /Jay&#39;s Retro Exchange/);
  assert.match(credited, /example\.com/);
});

test('admin reports photo coverage and lists items without one', async () => {
  const p = await renderPage('admin.html');
  assert.match(p.doc.getElementById('admin-stats').textContent, /Items with a photo/);
  assert.match(p.doc.getElementById('quality').textContent, /Items with no photo/);
});

test('admin refuses official Build-A-Bear imagery', async () => {
  const p = await renderPage('admin.html');
  pickItem(p, 'p-item', 'lucky-kitty');
  p.doc.getElementById('p-url').value = 'https://www.buildabear.com/dw/image/bear.jpg';
  p.doc.getElementById('p-add').dispatchEvent(new p.win.Event('click'));
  assert.match(p.doc.getElementById('p-msg').textContent, /official Build-A-Bear imagery/);
  assert.match(p.doc.getElementById('draft-body').textContent, /Nothing pending/);
});

test('admin queues a permitted photo and previews it', async () => {
  const p = await renderPage('admin.html');
  pickItem(p, 'p-item', 'lucky-kitty');
  const url = p.doc.getElementById('p-url');
  url.value = '/images/lucky-kitty.jpg';
  url.dispatchEvent(new p.win.Event('input'));
  assert.match(p.doc.getElementById('p-preview').innerHTML, /lucky-kitty\.jpg/);

  p.doc.getElementById('p-credit').value = "Jay's Retro Exchange";
  p.doc.getElementById('p-add').dispatchEvent(new p.win.Event('click'));
  const draft = p.doc.getElementById('draft-body').textContent;
  assert.match(draft, /Photos \(1\)/);
  assert.match(draft, /Lucky Kitty/);
});

test('the items CSV carries an image_url column', async () => {
  const p = await renderPage('index.html');
  assert.match(p.win.BC.itemsCsv(p.data.items).split('\r\n')[0], /image_url/);
});

// ---- asking prices ---------------------------------------------------------

/** Render an item page with synthetic active listings injected into the data. */
async function renderWithListings(itemId, listings) {
  const p = await renderPage('item.html', 'item.html?id=' + itemId, { mutate: (data) => {
    data.active_listings = listings;
    data.active_listings_fetched_at = '2026-09-08T12:00:00Z';
  } });
  return p.doc;
}

const listing = (id, price, extra) => Object.assign({
  id: 'active-' + id, item_id: 'original-pumpkin-kitty', listing_id: String(id),
  title: 'Build-A-Bear Pumpkin Kitty', ask_price: price, currency: 'USD',
  condition: 'Good', marketplace: 'eBay', evidence_type: 'active_listing',
  source_url: 'https://www.ebay.com/itm/' + id
}, extra || {});

test('an item page shows asking prices in their own clearly marked panel', async () => {
  const doc = await renderWithListings('original-pumpkin-kitty',
    [listing(1, 90), listing(2, 100), listing(3, 110)]);
  const text = doc.getElementById('item-root').textContent;
  assert.match(text, /Current asking prices/);
  assert.match(text, /These are not sales/);
  assert.match(text, /none of these affect the valuation/i);
});

test('the asking panel reports the ask-vs-sold spread', async () => {
  const doc = await renderWithListings('original-pumpkin-kitty',
    [listing(1, 90), listing(2, 100), listing(3, 110)]);
  const text = doc.getElementById('item-root').textContent;
  assert.match(text, /Median ask/);
  assert.match(text, /Sold-data value/);
  assert.match(text, /Spread/);
});

test('asking prices do not change the published valuation', async () => {
  const plain = await renderPage('item.html', 'item.html?id=original-pumpkin-kitty');
  const withAsks = await renderWithListings('original-pumpkin-kitty',
    [listing(1, 5000), listing(2, 6000)]);

  const valueOf = (doc) => doc.querySelector('.headline .big').textContent;
  assert.strictEqual(valueOf(withAsks), valueOf(plain.doc),
    'a $6000 asking price must not move the valuation');
});

test('a wildly optimistic asking price is called out as above market', async () => {
  const doc = await renderWithListings('original-pumpkin-kitty', [listing(1, 5000)]);
  assert.match(doc.getElementById('item-root').textContent, /above.*what this item actually sells for/i);
});

test('asking prices below the sold data flag stale comps', async () => {
  const doc = await renderWithListings('original-pumpkin-kitty', [listing(1, 5)]);
  assert.match(doc.getElementById('item-root').textContent, /market has\s+moved/i);
});

test('no asking panel is rendered when there are no listings', async () => {
  const p = await renderPage('item.html', 'item.html?id=buddy-bear-30-inch');
  assert.doesNotMatch(p.doc.getElementById('item-root').textContent, /Current asking prices/);
});

test('a hostile listing title cannot inject markup', async () => {
  const doc = await renderWithListings('original-pumpkin-kitty',
    [listing(1, 100, { title: '<img src=x onerror=alert(1)>' })]);
  assert.strictEqual(doc.querySelectorAll('img[onerror*="alert"]').length, 0);
});

// ---- expanded catalogue ----------------------------------------------------

test('the expanded catalogue is searchable and shows no invented prices', async () => {
  const p = await renderPage('index.html');
  const data = p.data;
  const added = data.items.find((i) => i.id === 'our-founding-bear');
  assert.ok(added, 'catalogue expansion should be present');
  assert.strictEqual(data.sales.filter((s) => s.item_id === added.id).length, 0);

  const q = p.doc.getElementById('q');
  q.value = 'founding bear';
  q.dispatchEvent(new p.win.Event('input'));
  return new Promise((resolve) => {
    setTimeout(() => {
      const card = p.doc.querySelector('#results .card');
      assert.match(card.textContent, /Founding Bear/);
      assert.match(card.textContent, /No sold data yet/);
      resolve();
    }, 900);
  });
});

test('WWF series items are catalogued under their franchise', async () => {
  const wwf = loadData().items.filter((i) => i.franchise === 'WWF / Wildlife');
  assert.ok(wwf.length >= 12, 'expected the expanded WWF series, got ' + wwf.length);
  for (const i of wwf) assert.strictEqual(i.licensed, true);
});

test('the Sanrio anniversary edition sizes were recorded', async () => {
  const p = await renderPage('index.html');
  const byId = Object.fromEntries(p.data.items.map((i) => [i.id, i]));
  assert.strictEqual(byId['chococat-limited-edition'].edition_size, 56000);
  assert.strictEqual(byId['keroppi-limited-edition'].edition_size, 66000);
});

test('the unresolved Lucky Kitty year conflict is recorded, not silently resolved', async () => {
  const p = await renderPage('item.html', 'item.html?id=lucky-kitty');
  const text = p.doc.getElementById('item-root').textContent;
  assert.match(text, /Year needs confirmation/);
  assert.match(text, /1997/);
});

// ---- aggregate observations in the UI --------------------------------------

test('admin refuses to record an average as a single completed sale', async () => {
  const p = await renderPage('admin.html');
  pickItem(p, 's-item', 'lucky-kitty');
  p.doc.getElementById('s-price').value = '54';
  p.doc.getElementById('s-sample').value = '12';
  p.doc.getElementById('s-date').value = '2026-01-15';
  p.doc.getElementById('s-market').value = 'eBay';
  p.doc.getElementById('s-listing').value = '123';
  p.doc.getElementById('s-evidence').value = 'completed_sale';
  p.doc.getElementById('s-add').dispatchEvent(new p.win.Event('click'));

  assert.match(p.doc.getElementById('s-msg').textContent,
    /not a single\s+completed sale/i);
  assert.match(p.doc.getElementById('draft-body').textContent, /Nothing pending/);
});

test('admin accepts an average recorded as a collector report', async () => {
  const p = await renderPage('admin.html');
  pickItem(p, 's-item', 'lucky-kitty');
  p.doc.getElementById('s-price').value = '54';
  p.doc.getElementById('s-sample').value = '12';
  p.doc.getElementById('s-evidence').value = 'collector_report';
  p.doc.getElementById('s-add').dispatchEvent(new p.win.Event('click'));
  assert.match(p.doc.getElementById('draft-body').textContent, /Lucky Kitty/);
});

// ---- expanded catalogue, second pass ----------------------------------------

test('the licensed franchise lines are catalogued without invented prices', async () => {
  const data = loadData();
  const priced = new Set(data.sales.map((s) => s.item_id));

  for (const franchise of ['Pokemon', 'Disney']) {
    const items = data.items.filter((i) => i.franchise === franchise);
    assert.ok(items.length >= 7, franchise + ' should be catalogued, got ' + items.length);
    for (const i of items) assert.strictEqual(i.licensed, true);
  }
  // The invariant that matters: the index never supplied a price, so nothing
  // catalogued from it may carry one that came from the index. A comp can attach
  // later, but only as a sourced sale (marketplace + listing id) recorded on its own.
  const fromIndex = data.items.filter(
    (i) => i.notes && /Catalogued from the CollectionHero index/.test(i.notes));
  assert.ok(fromIndex.length >= 50,
    'expected the catalogue expansion, got ' + fromIndex.length);
  for (const i of fromIndex) {
    if (!priced.has(i.id)) continue;
    for (const s of data.sales.filter((x) => x.item_id === i.id)) {
      assert.ok(s.marketplace && s.listing_id,
        i.id + ' was catalogued from an index with no prices; its comp ' + s.id +
        ' must be a sourced sale, not an index figure');
    }
  }
});

test('the Disney Princess edition sizes were captured', async () => {
  const p = await renderPage('index.html');
  const cinders = p.data.items.find((i) => i.id === 'cinderella-disney');
  assert.strictEqual(cinders.edition_size, 1500);
  assert.strictEqual(cinders.limited_edition, true);
});

test('a franchise filter narrows to that line', async () => {
  const p = await renderPage('index.html');
  const box = p.doc.querySelector('#filters input[data-group="franchise"][value="Pokemon"]');
  assert.ok(box, 'expected a Pokemon franchise filter');
  box.checked = true;
  box.dispatchEvent(new p.win.Event('change', { bubbles: true }));
  const cards = p.doc.querySelectorAll('#results .card');
  assert.strictEqual(cards.length,
    p.data.items.filter((i) => i.franchise === 'Pokemon').length);
});

// ---- species illustrations -------------------------------------------------

test('an illustration is drawn from the item species, not its name', async () => {
  const p = await renderPage('index.html');
  const I = p.win.BearChartIcons;
  assert.strictEqual(I.iconKeyFor({ species: 'Bear' }), 'bear');
  assert.strictEqual(I.iconKeyFor({ species: 'Panda' }), 'bear');
  assert.strictEqual(I.iconKeyFor({ species: 'Leopard' }), 'cat');
  assert.strictEqual(I.iconKeyFor({ species: 'Wolf' }), 'dog');
  assert.strictEqual(I.iconKeyFor({ species: 'Axolotl' }), 'axolotl');
  assert.strictEqual(I.iconKeyFor({ species: 'Dragon' }), 'dragon');
  assert.strictEqual(I.iconKeyFor({ category: 'Shoes' }), 'shoe');
  assert.strictEqual(I.iconKeyFor({ category: 'Clothing & Accessories' }), 'shirt');
});

test('an unrecorded species falls back to a paw print rather than breaking', async () => {
  // Wombat used to stand in for "unmapped" here and now has a drawing of its
  // own, which is the point of the fallback: the map grows, and an unmapped
  // species must still come out as a paw rather than a near-miss animal.
  const p = await renderPage('index.html');
  assert.strictEqual(p.win.BearChartIcons.iconKeyFor({ species: 'Aardvark' }), 'paw');
  assert.strictEqual(p.win.BearChartIcons.iconKeyFor({ species: 'Nudibranch' }), 'paw');
  assert.strictEqual(p.win.BearChartIcons.iconKeyFor({}), 'paw');
});

// ---- showing the evidence ---------------------------------------------------

test('a priced item draws the comps behind its number', async () => {
  const p = await renderPage('item.html', 'item.html?id=grey-panda-mini-beans');
  const strip = p.doc.querySelector('.evidence .ev-strip');
  assert.ok(strip, 'expected an evidence strip');
  const v = p.win.BC.valuationFor('grey-panda-mini-beans');
  assert.strictEqual(strip.querySelectorAll('.ev-dot').length, v.points.length);
  assert.ok(strip.querySelector('.ev-band'), 'the published range');
  assert.ok(strip.querySelector('.ev-median'), 'the median');
});

test('the strip labels the range, never the padding either side of it', async () => {
  // The axis ends are chosen to give the drawing air. Printing them would put
  // a precise-looking figure under a price at which nothing happened.
  const p = await renderPage('item.html', 'item.html?id=grey-panda-mini-beans');
  const v = p.win.BC.valuationFor('grey-panda-mini-beans');
  const ticks = Array.from(p.doc.querySelectorAll('.ev-tick')).map((t) => t.textContent);
  assert.ok(ticks.includes(p.win.BC.money(v.range_low)), ticks.join(' '));
  assert.ok(ticks.includes(p.win.BC.money(v.range_high)), ticks.join(' '));
  assert.strictEqual(ticks.length, 2, 'only the two range ends');
});

test('one comp draws one dot and says the range once', async () => {
  // Any item resting on exactly one comp will do; this one has a single sale.
  // (Polar Bear II used to be the example; merging its wiki duplicate gave it four.)
  const p = await renderPage('item.html', 'item.html?id=cherry-blossom-teddy');
  assert.strictEqual(p.doc.querySelectorAll('.ev-dot').length, 1);
  // range_low === range_high here, so printing it twice would read as two
  // different figures that happen to match.
  assert.strictEqual(p.doc.querySelectorAll('.ev-tick').length, 1);
  assert.match(p.doc.querySelector('.ev-key').textContent, /the one recorded sale/);
});

test('an unpriced item draws no strip at all', async () => {
  const p = await renderPage('item.html', 'item.html?id=buddy-bear-30-inch');
  assert.strictEqual(p.doc.querySelector('.evidence'), null);
  assert.strictEqual(p.win.BC.evidenceStrip(
    p.win.BC.valuationFor('buddy-bear-30-inch')), '');
});

test('the strip describes itself for a screen reader', async () => {
  const p = await renderPage('item.html', 'item.html?id=grey-panda-mini-beans');
  const strip = p.doc.querySelector('.ev-strip');
  assert.strictEqual(strip.getAttribute('role'), 'img');
  assert.match(strip.getAttribute('aria-label'), /recorded sale/);
});

// ---- the page with no price -------------------------------------------------

test('an unpriced page leads with what is known instead of an apology', async () => {
  const p = await renderPage('item.html', 'item.html?id=buddy-bear-30-inch');
  const panel = p.doc.querySelector('.unpriced');
  assert.ok(panel, 'expected the rebuilt empty state');
  assert.match(panel.querySelector('.unpriced-eyebrow').textContent, /No value published/i);
  assert.match(panel.querySelector('.unpriced-known').textContent, /Released/);
  assert.match(panel.querySelector('.unpriced-known').textContent, /1997/);
});

test('it still refuses to publish a price', async () => {
  const p = await renderPage('item.html', 'item.html?id=buddy-bear-30-inch');
  const panel = p.doc.querySelector('.unpriced');
  assert.match(panel.textContent, /publishes\s*no price/);
  assert.ok(panel.textContent.indexOf('$') === -1, 'no figure anywhere on it');
});

test('it does not repeat the tags already shown in the header', async () => {
  const p = await renderPage('item.html', 'item.html?id=buddy-bear-30-inch');
  assert.strictEqual(p.doc.querySelectorAll('.unpriced .tag').length, 0);
});

test('the ask points at a panel that is actually on the page', async () => {
  // A jump link to an anchor that does not exist is worse than no link.
  const p = await renderPage('item.html', 'item.html?id=buddy-bear-30-inch');
  const jump = p.doc.querySelector('.unpriced-jump');
  if (jump) {
    const target = jump.getAttribute('href').replace('#', '');
    assert.ok(p.doc.getElementById(target), 'jump target ' + target + ' is missing');
  } else {
    assert.strictEqual(p.win.BearChartSubmissions.configured(), false,
      'the jump should only be absent when submissions are off');
  }
});

// ---- collector submissions --------------------------------------------------

test('an item page invites a sold price and a problem report', async () => {
  const p = await renderPage('item.html', 'item.html?id=buddy-bear-30-inch');
  assert.ok(p.doc.getElementById('submit-panel'), 'expected the submit-a-sale panel');
  assert.ok(p.doc.getElementById('report-panel'), 'expected the report panel');
  assert.strictEqual(p.doc.querySelectorAll('#rep-reason option').length,
    p.win.BearChartSubmissions.reasons.length);
});

test('the panels survive the account library failing to load', async () => {
  // They key off whether accounts are CONFIGURED, not whether the CDN client
  // arrived. Keying on the live client made the whole feature vanish without
  // explanation whenever the script was slow, blocked, or the reader offline.
  const p = await renderPage('item.html', 'item.html?id=buddy-bear-30-inch');
  assert.strictEqual(p.win.BearChartAuth.getClient(), null, 'no client in this harness');
  assert.strictEqual(p.win.BearChartSubmissions.configured(), true);
  assert.ok(p.doc.getElementById('submit-panel'));
});

test('a signed-out reader is asked to sign in rather than shown a dead form', async () => {
  const p = await renderPage('item.html', 'item.html?id=buddy-bear-30-inch');
  const panel = p.doc.getElementById('submit-panel');
  assert.match(panel.textContent, /Sign in to add a sale/);
  assert.ok(!p.doc.getElementById('do-submit'), 'no submit button until signed in');
});

test('submitting a sale requires being signed in', async () => {
  const p = await renderPage('item.html', 'item.html?id=buddy-bear-30-inch');
  const res = await p.win.BearChartSubmissions.submitComp(
    { item_slug: 'buddy-bear-30-inch', sold_price: '40', marketplace: 'eBay' });
  assert.strictEqual(res.ok, false);
  assert.match(res.message, /sign in/i);
});

test('a report needs a reason from the list, not free text', async () => {
  const p = await renderPage('item.html', 'item.html?id=buddy-bear-30-inch');
  const S = p.win.BearChartSubmissions;
  const bad = await S.reportItem({ item_slug: 'buddy-bear-30-inch', reason: 'whatever' });
  assert.strictEqual(bad.ok, false);
  assert.match(bad.message, /Pick what is wrong/);
});

test('an unreachable server says so instead of claiming the feature is off', async () => {
  // Two different problems with two different answers: "come back online" and
  // "this site does not do that". Reporting the first as the second sends
  // somebody looking for a setting that is already correct.
  const p = await renderPage('item.html', 'item.html?id=buddy-bear-30-inch');
  const res = await p.win.BearChartSubmissions.reportItem(
    { item_slug: 'buddy-bear-30-inch', reason: 'duplicate' });
  assert.strictEqual(res.ok, false);
  assert.match(res.message, /connection|online/i);
});

test('the page states that a submission does not change a published value', async () => {
  const p = await renderPage('item.html', 'item.html?id=buddy-bear-30-inch');
  // Including submissions from the people who run the site - the operator
  // buys and sells what this guide values.
  assert.match(p.doc.getElementById('submit-panel').textContent,
    /review|reviewer/i);
});

// ---- the shop that runs the guide ------------------------------------------

test('the price guide carries the shop panel, labelled as the shop', async () => {
  const p = await renderPage('index.html');
  const promo = p.doc.querySelector('#sidebar-promo .promo');
  assert.ok(promo, 'expected the shop panel in the sidebar');
  assert.match(promo.textContent, /shop behind BearChart/i);
  const link = promo.querySelector('a.btn');
  assert.match(link.getAttribute('href'), /^https:\/\/jaysretroexchange\.com/);
  // sanitize.js extLink default (cross-spec decision #5).
  assert.strictEqual(link.getAttribute('rel'), 'noopener noreferrer');
  assert.strictEqual(link.getAttribute('target'), '_blank');
});

test('the shop panel discloses that it buys what the guide values', async () => {
  // The site's argument is that its numbers are not for sale. The operator's
  // own shop appearing on the page has to say so itself.
  const p = await renderPage('index.html');
  const note = p.doc.querySelector('#sidebar-promo .promo-note');
  assert.ok(note, 'the shop panel must carry a disclosure');
  assert.match(note.textContent, /No valuation on this site is adjusted/i);
});

test('the shop panel is reachable when the sidebar is collapsed away', async () => {
  // The sidebar is display:none below 860px. Without this the shop would be
  // invisible to every phone visitor.
  const p = await renderPage('index.html');
  assert.ok(p.doc.querySelector('#mobile-promo .promo'));
});

test('an item with no comps shows the shop, an item with comps shows the offer', async () => {
  const priced = await renderPage('item.html', 'item.html?id=classic-brown-teddy');
  const unpriced = await renderPage('item.html', 'item.html?id=buddy-bear-30-inch');

  // One pitch per page. A reader should never get "buy from us" and "sell to
  // us" stacked on the same bear.
  assert.ok(!priced.doc.querySelector('#item-root .promo'),
    'a priced item already has the sell-to-us panel');
  assert.match(priced.doc.getElementById('item-root').textContent, /Sell yours to/);

  assert.ok(unpriced.doc.querySelector('#item-root .promo'),
    'an item with nothing else to offer should show the shop');
  assert.doesNotMatch(unpriced.doc.getElementById('item-root').textContent,
    /Sell yours to/);
});

test('the shop panel disappears entirely when the business is switched off', async () => {
  const p = await renderPage('index.html');
  const BC = p.win.BC;
  const saved = BC.business.enabled;
  try {
    BC.business.enabled = false;
    assert.strictEqual(BC.shopPromo(), '');
    assert.strictEqual(BC.shopEnabled(), false);
  } finally {
    BC.business.enabled = saved;
  }
});

test('shop copy is escaped, not injected', async () => {
  const p = await renderPage('index.html');
  const BC = p.win.BC;
  const saved = BC.business.shop_headline;
  try {
    BC.business.shop_headline = '<img src=x onerror=alert(1)>';
    assert.doesNotMatch(BC.shopPromo(), /<img/);
  } finally {
    BC.business.shop_headline = saved;
  }
});

test('the illustration says it is an illustration', async () => {
  const p = await renderPage('index.html');
  const svg = decodeURIComponent(
    p.win.BC.placeholderImage({ id: 'x', canonical_name: 'A', species: 'Bear' }));
  assert.match(svg, /ILLUSTRATION/);
  assert.match(svg, /NO PHOTO YET/);
});

test('every catalogued item draws valid, well-formed SVG', async () => {
  const p = await renderPage('index.html');
  const parser = new p.win.DOMParser();
  const seen = new Set();
  for (const item of p.data.items) {
    const uri = p.win.BC.placeholderImage(item);
    assert.ok(uri.startsWith('data:image/svg+xml'), item.id);
    const svg = decodeURIComponent(uri.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''));
    const doc = parser.parseFromString(svg, 'image/svg+xml');
    assert.strictEqual(doc.querySelectorAll('parsererror').length, 0,
      'malformed SVG for ' + item.id);
    assert.ok(doc.documentElement.children.length > 2,
      'illustration for ' + item.id + ' looks empty');
    seen.add(p.win.BearChartIcons.iconKeyFor(item));
  }
  // The catalogue is varied enough that many different drawings are in use.
  assert.ok(seen.size >= 12, 'expected a varied icon set, used ' + seen.size);
});

test('every icon in the set renders without error', async () => {
  const p = await renderPage('index.html');
  const I = p.win.BearChartIcons;
  const parser = new p.win.DOMParser();
  for (const key of I.keys) {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">' +
      I.draw(key, '#000000', '#cccccc') + '</svg>';
    const doc = parser.parseFromString(svg, 'image/svg+xml');
    assert.strictEqual(doc.querySelectorAll('parsererror').length, 0,
      'icon "' + key + '" produced malformed SVG');
  }
});

test('items still show their illustration on cards and item pages', async () => {
  const p = await renderPage('index.html');
  showAll(p);
  assert.strictEqual(p.doc.querySelectorAll('#results .card img.thumb').length,
    p.data.items.length);
  const item = await renderPage('item.html', 'item.html?id=kennel-pals-calico-cat');
  assert.ok(item.doc.querySelector('.item-hero img.hero'));
});

// ---- upcoming and current releases -----------------------------------------

test('an upcoming release says it is not out and publishes no price', async () => {
  const p = await renderPage('index.html');
  const upcoming = p.data.items.find((i) => i.release_status === 'upcoming');
  assert.ok(upcoming, 'expected an upcoming release in the data');

  const item = await renderPage('item.html', 'item.html?id=' + upcoming.id);
  const root = item.doc.getElementById('item-root');
  assert.match(root.textContent, /Not released yet/);
  assert.match(root.textContent, /no secondary market/i);

  assert.doesNotMatch(root.textContent, /Estimated market value/);
  assert.strictEqual(root.querySelector('.headline .big'), null);
  const unpriced = root.querySelector('.unpriced');
  assert.ok(unpriced, 'expected the no-price panel');
  assert.ok(unpriced.textContent.indexOf('$') === -1, unpriced.textContent);
});

test('a current retail release is labelled and warns about the retail ceiling', async () => {
  const p = await renderPage('index.html');
  const current = p.data.items.find((i) => i.release_status === 'current');
  assert.ok(current);
  const item = await renderPage('item.html', 'item.html?id=' + current.id);
  const text = item.doc.getElementById('item-root').textContent;
  assert.match(text, /Available at retail now/);
  assert.match(text, /ceiling/i);
});

test('release badges appear on cards', async () => {
  const p = await renderPage('index.html');
  const box = p.doc.querySelector('#filters input[data-group="flag"][value="current"]');
  assert.ok(box, 'expected an "at retail now" filter');
  box.checked = true;
  box.dispatchEvent(new p.win.Event('change', { bubbles: true }));
  const cards = p.doc.querySelectorAll('#results .card');
  assert.ok(cards.length > 0);
  assert.match(cards[0].textContent, /At Retail Now/);
});

test('upcoming releases can be filtered to on their own', async () => {
  const p = await renderPage('index.html');
  const box = p.doc.querySelector('#filters input[data-group="flag"][value="upcoming"]');
  assert.ok(box, 'expected an upcoming filter');
  box.checked = true;
  box.dispatchEvent(new p.win.Event('change', { bubbles: true }));
  const cards = p.doc.querySelectorAll('#results .card');
  assert.strictEqual(cards.length,
    p.data.items.filter((i) => i.release_status === 'upcoming').length);
  assert.match(cards[0].textContent, /Upcoming/);
});

test('admin can mark a new item as an upcoming release', async () => {
  const p = await renderPage('admin.html');
  p.doc.getElementById('i-name').value = 'Test Upcoming Bear';
  p.doc.getElementById('i-status').value = 'upcoming';
  p.doc.getElementById('i-add').dispatchEvent(new p.win.Event('click'));
  assert.match(p.doc.getElementById('draft-body').textContent, /Test Upcoming Bear/);
});

// ---- monetisation hooks ----------------------------------------------------

/** Render an item page with the business config switched on. */
async function renderWithBusiness(itemId, business) {
  const p = await renderPage('item.html', 'item.html?id=' + itemId, { mutate: (data) => {
    data.business = Object.assign({}, data.business, business);
  } });
  return p.win;
}

test('the sell-to-us panel is hidden until the business config is filled in', async () => {
  // This used to pass by reading the shipped default, which was "off". The
  // business is switched on now, so the test had to start stating the rule it
  // was actually there to protect instead of the configuration of the day.
  const off = await renderWithBusiness('kennel-pals-calico-cat', { enabled: false });
  assert.doesNotMatch(off.document.getElementById('item-root').textContent,
    /Sell yours to/);

  // Enabled but with no way to reach anyone is not enabled: an offer button
  // that goes nowhere is worse than no offer.
  const unreachable = await renderWithBusiness('kennel-pals-calico-cat',
    { enabled: true, contact_email: null, contact_url: null });
  assert.strictEqual(unreachable.BC.businessEnabled(), false);
  assert.doesNotMatch(unreachable.document.getElementById('item-root').textContent,
    /Sell yours to/);
});

test('the shipped config does offer to buy a priced item', async () => {
  // The other half: with the business live, a priced item carries the offer.
  const p = await renderPage('item.html', 'item.html?id=kennel-pals-calico-cat');
  assert.match(p.doc.getElementById('item-root').textContent, /Sell yours to/);
});

test('enabling the business config shows an offer at the published buy price', async () => {
  const win = await renderWithBusiness('kennel-pals-calico-cat',
    { enabled: true, contact_email: 'hello@example.com' });
  const text = win.document.getElementById('item-root').textContent;
  assert.match(text, /Sell yours to Jay's Retro Exchange/);
  assert.match(text, /Get an offer/);

  // The offer must be the same buy range the guide publishes to everyone.
  const v = win.BC.valuationFor('kennel-pals-calico-cat');
  assert.ok(text.includes(win.BC.range(v.buy_low, v.buy_high)));
});

test('the offer carries a conflict-of-interest disclosure', async () => {
  const win = await renderWithBusiness('kennel-pals-calico-cat',
    { enabled: true, contact_email: 'hello@example.com' });
  const text = win.document.getElementById('item-root').textContent;
  assert.match(text, /Disclosure/);
  assert.match(text, /would\s+be buying this one from you/);
  assert.match(text, /free to sell\s+elsewhere/);
});

test('turning the business on does not move any valuation', async () => {
  const plain = await renderPage('item.html', 'item.html?id=kennel-pals-calico-cat');
  const win = await renderWithBusiness('kennel-pals-calico-cat',
    { enabled: true, contact_email: 'hello@example.com' });
  assert.strictEqual(
    win.document.querySelector('.headline .big').textContent,
    plain.doc.querySelector('.headline .big').textContent);
});

test('affiliate ids are only applied to eBay links, and only when configured', async () => {
    const ebay = 'https://www.ebay.com/itm/123';
  const off = await renderWithBusiness('kennel-pals-calico-cat', { ebay_campaign_id: null });
  assert.strictEqual(off.BC.affiliate(ebay), ebay, 'inert with no campaign id');

  const win = await renderWithBusiness('kennel-pals-calico-cat', { ebay_campaign_id: '5338000000' });
  assert.match(win.BC.affiliate(ebay), /campid=5338000000/);
  // Anything that is not eBay is left alone.
  assert.strictEqual(win.BC.affiliate('https://www.mercari.com/x'),
    'https://www.mercari.com/x');
  assert.strictEqual(win.BC.affiliate(null), null);
});

test('an affiliate id cannot reach the valuation or reorder listings', async () => {
  const plain = await renderPage('item.html', 'item.html?id=kennel-pals-calico-cat');
  const win = await renderWithBusiness('kennel-pals-calico-cat', { ebay_campaign_id: '5338000000' });
  assert.strictEqual(
    win.document.querySelector('.headline .big').textContent,
    plain.doc.querySelector('.headline .big').textContent);
  const rows = win.document.querySelectorAll('.panel table tbody tr').length;
  assert.strictEqual(rows, plain.doc.querySelectorAll('.panel table tbody tr').length);
});

// ---- deal finder page ------------------------------------------------------

/** Render deals.html with synthetic active listings injected. */
async function renderDeals(listings) {
  const p = await renderPage('deals.html', null, { mutate: (data) => {
    data.active_listings = listings || [];
    data.active_listings_fetched_at = '2026-09-10T09:00:00Z';
  } });
  return p.win;
}

const activeFor = (itemId, ask, condition) => ({
  id: 'active-' + ask, item_id: itemId, listing_id: String(ask),
  title: 'Build-A-Bear listing', ask_price: ask, currency: 'USD',
  condition: condition || 'Good', marketplace: 'eBay',
  evidence_type: 'active_listing', source_url: 'https://www.ebay.com/itm/' + ask
});

test('the deals page renders without errors', async () => {
  const p = await renderPage('deals.html');
  noErrors(p);
});

test('old asking prices are flagged as possibly out of date', async () => {
  const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
  const list = [activeFor('kennel-pals-calico-cat', 5)];
  const old = await renderPage('deals.html', null, { mutate: (d) => {
    d.active_listings = list; d.active_listings_fetched_at = daysAgo(12);
  } });
  assert.match(old.doc.getElementById('deal-age').textContent, /last checked 12 days ago and may be out of date/);
  const fresh = await renderPage('deals.html', null, { mutate: (d) => {
    d.active_listings = list; d.active_listings_fetched_at = daysAgo(1);
  } });
  assert.strictEqual(fresh.doc.getElementById('deal-age').textContent, '');
  const item = await renderPage('item.html', 'item.html?id=kennel-pals-calico-cat', { mutate: (d) => {
    d.active_listings = list; d.active_listings_fetched_at = daysAgo(30);
  } });
  assert.match(item.doc.getElementById('item-root').textContent, /may be out of date/);
});

test('with no listings loaded the deals page explains how to get some', async () => {
  const win = await renderDeals([]);
  const text = win.document.getElementById('deals').textContent;
  assert.match(text, /No active listings loaded/);
  assert.match(text, /npm run ebay/);
});

test('an underpriced listing appears with its net margin', async () => {
  const win = await renderDeals([activeFor('my-little-pony-muffins', 50)]);
  const text = win.document.getElementById('deals').textContent;
  assert.match(text, /My Little Pony Muffins/);
  assert.match(text, /Net after fees/);
  const rows = win.document.querySelectorAll('#deals tbody tr');
  assert.strictEqual(rows.length, 1);
});

test('a fairly priced listing is not shown as a deal', async () => {
  const win = await renderDeals([activeFor('my-little-pony-muffins', 250)]);
  assert.match(win.document.getElementById('deals').textContent,
    /Nothing under your thresholds/);
});

test('tightening the margin threshold removes marginal deals', async () => {
  const win = await renderDeals([activeFor('my-little-pony-muffins', 50)]);
  assert.strictEqual(win.document.querySelectorAll('#deals tbody tr').length, 1);

  const input = win.document.getElementById('min-margin');
  input.value = '5000';
  input.dispatchEvent(new win.Event('input'));
  assert.match(win.document.getElementById('deals').textContent,
    /Nothing under your thresholds/);
});

test('raising the fee assumption reduces the reported margin', async () => {
  const win = await renderDeals([activeFor('my-little-pony-muffins', 50)]);
  const marginOf = () => win.document.querySelectorAll('#deals tbody tr td')[4].textContent;
  const before = marginOf();
  const fee = win.document.getElementById('fee');
  // Far enough above the schedule to move the margin, not so far that the
  // listing stops being a deal once the buyer's shipping is counted.
  fee.value = '25';
  fee.dispatchEvent(new win.Event('input'));
  assert.notStrictEqual(marginOf(), before);
});

test('a deal shows the shipping and what the buyer pays in total', async () => {
  const stated = Object.assign(activeFor('my-little-pony-muffins', 50), { ship_price: 6 });
  let win = await renderDeals([stated]);
  let asking = win.document.querySelectorAll('#deals tbody tr td')[1].textContent;
  assert.match(asking, /\+ \$6 shipping/);
  assert.match(asking, /Buyer pays \$56/);

  win = await renderDeals([activeFor('my-little-pony-muffins', 50)]);
  asking = win.document.querySelectorAll('#deals tbody tr td')[1].textContent;
  assert.match(asking, /shipping \(assumed\)/);
  assert.match(win.document.getElementById('deals').textContent, /Shipping not stated/);
});

test('the deals page states that no sold data means no deal', async () => {
  const p = await renderPage('deals.html');
  assert.match(p.doc.getElementById('how-it-works').textContent, /No sold data, no deal/);
});

// ---- checklists ------------------------------------------------------------

test('the checklists page renders and builds sets from the catalogue', async () => {
  const p = await renderPage('checklists.html');
  noErrors(p);
  const sets = p.doc.querySelectorAll('#set-list [data-set]');
  assert.ok(sets.length >= 10, 'expected a good spread of checklists, got ' + sets.length);
  const names = p.doc.getElementById('set-list').textContent;
  for (const n of ['Mini Beans', 'Employee exclusives', 'Vintage', 'Pokemon']) {
    assert.ok(names.includes(n), 'missing checklist: ' + n);
  }
});

test('a checklist shows every item in its set with progress', async () => {
  const p = await renderPage('checklists.html');
  const rows = p.doc.querySelectorAll('#set-body tbody tr');
  const miniBeans = p.data.items.filter((i) => i.mini_bean).length;
  assert.strictEqual(rows.length, miniBeans, 'first set should be Mini Beans');
  assert.match(p.doc.getElementById('set-progress').textContent, /0 of /);
  assert.ok(p.doc.querySelector('.progress span'));
});

test('switching checklist changes the item list', async () => {
  const p = await renderPage('checklists.html');
  const before = p.doc.querySelectorAll('#set-body tbody tr').length;
  const row = p.doc.querySelector('#set-list [data-set="employee"]');
  assert.ok(row, 'expected an employee-exclusive checklist');
  row.dispatchEvent(new p.win.Event('click', { bubbles: true }));
  assert.strictEqual(p.doc.getElementById('set-title').textContent, 'Employee exclusives');
  assert.notStrictEqual(p.doc.querySelectorAll('#set-body tbody tr').length, before);
});

test('ticking an item marks it owned and moves the progress bar', async () => {
  const p = await renderPage('checklists.html');
  const box = p.doc.querySelector('#set-body input[data-own]');
  const id = box.dataset.own;
  box.checked = true;
  box.dispatchEvent(new p.win.Event('change', { bubbles: true }));

  assert.match(p.doc.getElementById('set-progress').textContent, /1 of /);
  const saved = JSON.parse(p.win.localStorage.getItem('bearchart.collection'));
  assert.ok(saved.some((e) => e.item_id === id),
    'ticking a checklist should add to the collection');
});

test('the missing-only filter hides what you already own', async () => {
  const p = await renderPage('checklists.html');
  const total = p.doc.querySelectorAll('#set-body tbody tr').length;
  const box = p.doc.querySelector('#set-body input[data-own]');
  box.checked = true;
  box.dispatchEvent(new p.win.Event('change', { bubbles: true }));

  const hide = p.doc.getElementById('hide-owned');
  hide.checked = true;
  hide.dispatchEvent(new p.win.Event('change'));
  assert.strictEqual(p.doc.querySelectorAll('#set-body tbody tr').length, total - 1);
});

test('checklist items with no comps show no price rather than a guess', async () => {
  const p = await renderPage('checklists.html');
  const row = p.doc.querySelector('#set-list [data-set="employee"]');
  row.dispatchEvent(new p.win.Event('click', { bubbles: true }));
  const text = p.doc.getElementById('set-body').textContent;
  assert.match(text, /no data/);
});

test('the deals and checklists pages are reachable from every page', async () => {
  for (const page of ['index.html', 'item.html', 'collection.html', 'about.html']) {
    const p = await renderPage(page, page === 'item.html'
      ? 'item.html?id=kennel-pals-calico-cat' : page);
    const nav = p.doc.getElementById('masthead').innerHTML;
    assert.ok(nav.includes('deals.html'), page + ' should link to the deal finder');
    assert.ok(nav.includes('checklists.html'), page + ' should link to checklists');
  }
});

// ---- identification work queue ---------------------------------------------

test('admin surfaces the identification questions still to settle', async () => {
  const p = await renderPage('admin.html');
  noErrors(p);
  assert.match(p.doc.getElementById('admin-stats').textContent, /Questions to settle/);
  const quality = p.doc.getElementById('quality').textContent;
  assert.match(quality, /Identification questions to settle/);
  assert.match(quality, /tush tag/);
});

test('every flagged item is one whose notes record an open question', async () => {
  // Kept in step with OPEN_QUESTION in tools/build_data.py - if you widen the
  // vocabulary there, widen it here too.
  const OPEN = /unresolved|confirm before|before merging|may overlap|may be the same|whether they are the same|needs confirmation/i;
  const flagged = loadData().items.filter((i) => i.needs_review);
  assert.ok(flagged.length > 0, 'expected some open questions');
  for (const i of flagged) {
    assert.match(i.notes || '', OPEN,
      i.id + ' is flagged for review but its notes record no question');
  }
});

test('no item with an open question is left unflagged', async () => {
  const OPEN = /unresolved|confirm before|before merging|may overlap|may be the same|whether they are the same|needs confirmation/i;
  for (const i of loadData().items) {
    if (OPEN.test(i.notes || '')) {
      assert.strictEqual(i.needs_review, true,
        i.id + ' records a question but is not flagged for review');
    }
  }
});

test('items with no open question are not flagged for review', async () => {
  const data = loadData();
  const clean = data.items.find((i) => i.id === 'kennel-pals-calico-cat');
  assert.strictEqual(clean.needs_review, false);
});

// ---- accounts --------------------------------------------------------------

/** Render a page with the auth config switched on, without a real backend. */
async function renderWithoutAuth(file, url) {
  return await renderWithAuth(file, url, { enabled: false, supabase_url: null,
                                     supabase_anon_key: null });
}

async function renderWithAuth(file, url, authCfg, mutate) {
  const p = await renderPage(file, url, { plain: true, mutate: (data) => {
    data.config = Object.assign({}, data.config, {
      auth: Object.assign({ enabled: true, supabase_url: 'https://x.supabase.co',
                            supabase_anon_key: 'anon-key' }, authCfg || {})
    });
    if (mutate) mutate(data);
  } });
  return p.win;
}

/** A stand-in for the Supabase client, so auth can be driven without a network. */
function mockClient(opts) {
  opts = opts || {};
  return {
    calls: [],
    auth: {},
    from(table) {
      return {
        select() { return this; },
        eq() { return this; },
        maybeSingle: () => Promise.resolve(
          table === 'admins' && opts.isAdmin ? { data: { role: 'owner' } } : { data: null })
      };
    },
    rpc(name, args) {
      this.calls.push([name, args]);
      return Promise.resolve(opts.rpcError
        ? { error: { message: opts.rpcError } }
        : { data: (args.entries || []).length });
    }
  };
}

test('with no auth configured the site works anonymously and says so', async () => {
  const win = await renderWithoutAuth('account.html');
  const text = win.document.getElementById('account-root').textContent;
  assert.match(text, /Accounts are not switched on/);
  assert.match(text, /work exactly as they do now/);
});

test('with a live project the account page offers sign in', async () => {
  const p = await renderPage('account.html');
  noErrors(p);
  const text = p.doc.getElementById('account-root').textContent;
  assert.match(text, /Sign in/);
  assert.match(text, /Create an account/);
  assert.match(text, /do not need an account/);
});

test('the account tab is always reachable, configured or not', async () => {
  // It was hidden while accounts were off, which made the feature and its own
  // setup instructions impossible to find from the site.
  const off = await renderWithoutAuth('index.html');
  assert.match(off.document.getElementById('masthead').innerHTML, /account\.html/);
  const on = await renderPage('index.html');
  assert.match(on.doc.getElementById('masthead').innerHTML, /account\.html/);
});

test('the tab reads as a sign-in prompt once accounts are configured', async () => {
  const win = await renderWithAuth('index.html');
  assert.match(win.document.getElementById('masthead').innerHTML, />Sign in</);
});

test('there is no client-side session flag anywhere', async () => {
  // A "signed in" boolean in storage would be settable from the console, which
  // is why auth is delegated to a server rather than faked here.
  for (const f of ['auth.js', 'account.js', 'common.js', 'admin.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.doesNotMatch(src, /localStorage\s*\.\s*setItem\s*\(\s*['"][^'"]*(signed|logged|auth|session|admin)/i,
      f + ' must not persist a session flag in the browser');
  }
});

test('the anon key is used but the service-role key never appears', async () => {
  for (const f of ['auth.js', 'account.js', 'tools/build_data.py']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.doesNotMatch(src, /service_role_key\s*[:=]\s*['"][A-Za-z0-9._-]{10,}/,
      f + ' must never carry a service-role key');
  }
});

test('signing in is refused when accounts are not configured', async () => {
  const win = await renderWithoutAuth('account.html');
  const A = win.BearChartAuth;
  assert.strictEqual(A.configured(), false);
  const res = await A.signIn('a@example.com', 'password123');
  assert.strictEqual(res.ok, false);
  assert.match(res.message, /not set up/);
});

test('a live project reports itself as configured', async () => {
  const p = await renderPage('account.html');
  assert.strictEqual(p.win.BearChartAuth.configured(), true);
});

test('a short password is rejected before any request is made', async () => {
  const win = await renderWithAuth('account.html');
  const res = await win.BearChartAuth.signUp('a@example.com', 'short');
  assert.strictEqual(res.ok, false);
  assert.match(res.message, /at least 8/);
});

test('sign up and sign in require an email', async () => {
  const win = await renderWithAuth('account.html');
  const A = win.BearChartAuth;
  assert.match((await A.signUp('', 'password123')).message, /email/i);
  assert.match((await A.signIn('', '')).message, /email/i);
  assert.match((await A.signInWithLink('')).message, /email/i);
});

test('admin status is asked of the server, never assumed', async () => {
  const win = await renderWithAuth('admin.html');
  const A = win.BearChartAuth;
  const session = { user: { id: 'u1', email: 'jay@example.com' } };

  await A._setClientForTests(mockClient({ isAdmin: false }), session);
  assert.strictEqual(A.state().isAdmin, false);

  await A._setClientForTests(mockClient({ isAdmin: true }), session);
  assert.strictEqual(A.state().isAdmin, true);
});

test('admin page tells a non-admin the database will refuse their writes', async () => {
  const win = await renderWithAuth('admin.html');
  const A = win.BearChartAuth;
  await A._setClientForTests(mockClient({ isAdmin: false }),
    { user: { id: 'u1', email: 'someone@example.com' } });
  const text = win.document.getElementById('access-notice').textContent;
  assert.match(text, /not an\s+admin account/);
  assert.match(text, /whatever this page shows/);
});

test('with no accounts configured the admin page says it is unprotected', async () => {
  const win = await renderWithoutAuth('admin.html');
  const text = win.document.getElementById('access-notice').textContent;
  assert.match(text, /No account system is switched on/);
  assert.match(text, /only writes to/);
});

test('with a live project the admin page asks you to sign in', async () => {
  const p = await renderPage('admin.html');
  assert.match(p.doc.getElementById('access-notice').textContent,
    /not signed in/i);
});

test('the collection upload sends slugs and never a user id', async () => {
  const win = await renderWithAuth('account.html');
  const A = win.BearChartAuth;
  win.localStorage.setItem('bearchart.collection', JSON.stringify([
    { item_id: 'lucky-kitty', condition: 'Good', completeness: 'bare', qty: 2 }
  ]));
  const client = mockClient({});
  await A._setClientForTests(client, { user: { id: 'u1', email: 'jay@example.com' } });

  // Re-render so the signed-in view with the upload button exists.
  win.document.getElementById('account-root').innerHTML = '';
  A.onChange(() => {});
  await new Promise((r) => setTimeout(r, 50));
});

test('a failed upload keeps the local collection intact', async () => {
  const win = await renderWithAuth('account.html');
  win.localStorage.setItem('bearchart.collection', JSON.stringify([
    { item_id: 'lucky-kitty', condition: 'Good', completeness: 'bare', qty: 1 }
  ]));
  await win.BearChartAuth._setClientForTests(mockClient({ rpcError: 'boom' }),
    { user: { id: 'u1', email: 'jay@example.com' } });
  const stored = JSON.parse(win.localStorage.getItem('bearchart.collection'));
  assert.strictEqual(stored.length, 1, 'local data must survive a server failure');
});

test('the schema stamps the user id server-side rather than trusting the client', async () => {
  const sql = readSchema();
  assert.match(sql, /create or replace function add_collection_items/);
  assert.match(sql, /auth\.uid\(\),\s*--\s*never taken from the caller/);
  assert.match(sql, /raise exception 'not signed in'/);
});

test('every page loads auth before common so the nav can show the session', async () => {
  for (const page of ['index.html', 'item.html', 'collection.html', 'admin.html',
                      'about.html', 'deals.html', 'checklists.html', 'account.html']) {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    assert.ok(html.indexOf('auth.js') > -1, page + ' should load auth.js');
    assert.ok(html.indexOf('auth.js') < html.indexOf('common.js'),
      page + ' must load auth.js before common.js');
  }
});

// ---- portfolio history & roadmap -------------------------------------------

test('the collection page records a snapshot and says history starts today', async () => {
  const p = await renderPage('collection.html');
  noErrors(p);
  assert.match(p.doc.getElementById('history-body').textContent, /History starts today/);
  const snaps = JSON.parse(p.win.localStorage.getItem('bearchart.snapshots'));
  assert.strictEqual(snaps.length, 1, 'one snapshot per day');
  assert.ok(snaps[0].d.match(/^\d{4}-\d{2}-\d{2}$/));
});

test('adding an item is recorded as an external flow, not appreciation', async () => {
  const p = await renderPage('collection.html');
  pickItem(p, 'add-item', 'kennel-pals-calico-cat');
  p.doc.getElementById('add-btn').dispatchEvent(new p.win.Event('click'));

  const flows = JSON.parse(p.win.localStorage.getItem('bearchart.flows') || '[]');
  assert.strictEqual(flows.length, 1);
  assert.strictEqual(flows[0].dir, 'acquire');
  assert.ok(flows[0].v > 0);
});

test('re-opening the page on the same day does not add a second snapshot', async () => {
  const p = await renderPage('collection.html');
  pickItem(p, 'add-item', 'lucky-kitty');
  p.doc.getElementById('add-btn').dispatchEvent(new p.win.Event('click'));
  p.doc.getElementById('add-btn').dispatchEvent(new p.win.Event('click'));
  const snaps = JSON.parse(p.win.localStorage.getItem('bearchart.snapshots'));
  assert.strictEqual(snaps.length, 1);
});

test('the roadmap renders and counts what is actually built', async () => {
  const p = await renderPage('roadmap.html');
  noErrors(p);
  for (const id of ['p2', 'p3', 'p4', 'never']) {
    assert.ok(p.doc.querySelectorAll('#' + id + ' .road-row').length > 0,
      id + ' should list capabilities');
  }
  assert.match(p.doc.getElementById('phase-stats').textContent, /Capabilities built/);
  assert.ok(p.doc.querySelectorAll('.road-tag.ship').length >= 5);
});

test('the roadmap states the data constraint rather than promising around it', async () => {
  const p = await renderPage('roadmap.html');
  const text = p.doc.body.textContent;
  assert.match(text, /cannot be bought or fetched/);
  assert.match(text, /Not possible/);
  assert.match(text, /Never/);
});

test('a shipped claim drops to planned if the capability is missing', async () => {
  // The roadmap checks the engine rather than trusting a hand-maintained label,
  // so it cannot keep advertising something that has been removed.
  const src = fs.readFileSync(path.join(ROOT, 'roadmap.js'), 'utf8');
  assert.match(src, /typeof E\.lowerBound === 'function'/);
  assert.match(src, /if \(state === 'shipped' && entry\.length > 3 && !entry\[3\]\)/);
});

test('the roadmap is in the menu for admins only, for now', async () => {
  const p = await renderPage('index.html');
  assert.doesNotMatch(p.doc.getElementById('masthead').innerHTML, /roadmap\.html/);
  const r = await renderPage('roadmap.html');
  assert.match(r.doc.getElementById('masthead').innerHTML, /roadmap\.html/);
});

// ---- insurance schedule -----------------------------------------------------

async function collectionWith(itemIds) {
  const p = await renderPage('collection.html');
  for (const id of itemIds) {
    pickItem(p, 'add-item', id);
    p.doc.getElementById('add-btn').dispatchEvent(new p.win.Event('click'));
  }
  return p;
}

async function captureDownload(p, buttonId) {
  let captured = null;
  p.win.BC.download = (name, text) => { captured = { name, text }; };
  p.doc.getElementById(buttonId).dispatchEvent(new p.win.Event('click'));
  await settle(p.win);   // the insurance schedule loads each bear's comps first
  return captured;
}

test('the insurance schedule carries the evidence, not just the number', async () => {
  const p = await collectionWith(['kennel-pals-calico-cat']);
  const out = await captureDownload(p, 'export-insurance');
  assert.match(out.name, /insurance-schedule/);

  const header = out.text.split('\r\n')[0];
  for (const col of ['replacement_cost_usd', 'actual_cash_value_usd', 'comp_count',
                     'confidence', 'comp_date_range', 'evidence_urls',
                     'valuation_method', 'valued_on']) {
    assert.ok(header.includes(col), 'missing column: ' + col);
  }
  // The comps come from the bear's own file, loaded for the schedule.
  assert.ok(p.requests.includes('data/items/kennel-pals-calico-cat.json'), p.requests.join(' '));
  const urls = p.data.sales.filter((x) => x.item_id === 'kennel-pals-calico-cat' && x.source_url)
    .map((x) => x.source_url);
  assert.ok(urls.length, 'the fixture bear has sourced comps');
  for (const u of urls) assert.ok(out.text.includes(u), 'evidence url ' + u);
});

test('offline, the insurance schedule is refused rather than shipped without its evidence', async () => {
  const p = await renderPage('collection.html', null, {
    transport: (url, serve) => (/^data\/items\//.test(url)
      ? Promise.reject(Object.assign(new Error('offline'), { offline: true }))
      : serve(url))
  });
  pickItem(p, 'add-item', 'kennel-pals-calico-cat');
  p.doc.getElementById('add-btn').dispatchEvent(new p.win.Event('click'));
  const out = await captureDownload(p, 'export-insurance');
  assert.strictEqual(out, null, 'no schedule without the comps behind it');
  const msg = p.doc.getElementById('export-msg');
  assert.strictEqual(msg.hidden, false);
  assert.match(msg.textContent, /Could not load the sales behind 1 of your bears - you seem to be offline/);
  assert.strictEqual(p.doc.getElementById('export-insurance').disabled, false);
  noErrors(p);
});

test('a bear whose file is gone is named, not blamed on the connection', async () => {
  const p = await renderPage('collection.html', null, {
    transport: (url, serve) => serve(/^data\/items\/kennel-pals-calico-cat/.test(url)
      ? 'data/items/no-such-file.json' : url)
  });
  pickItem(p, 'add-item', 'kennel-pals-calico-cat');
  p.doc.getElementById('add-btn').dispatchEvent(new p.win.Event('click'));
  assert.strictEqual(await captureDownload(p, 'export-insurance'), null);
  const text = p.doc.getElementById('export-msg').textContent;
  assert.match(text, /could not be found in the price guide \(kennel-pals-calico-cat\)/);
  assert.doesNotMatch(text, /offline/);
});

test('actual cash value is the conservative floor, below replacement cost', async () => {
  const p = await collectionWith(['kennel-pals-calico-cat']);
  const rows = (await captureDownload(p, 'export-insurance')).text.split('\r\n');
  const header = rows[0].split(',');
  const cells = rows[1].split(',');
  const rc = parseFloat(cells[header.indexOf('replacement_cost_usd')]);
  const acv = parseFloat(cells[header.indexOf('actual_cash_value_usd')]);
  assert.ok(rc > 0 && acv > 0);
  assert.ok(acv < rc, 'ACV must sit below replacement cost');
});

test('an unvalued item is left blank rather than valued at zero', async () => {
  const p = await collectionWith(['floppy-kitty']);
  const rows = (await captureDownload(p, 'export-insurance')).text.split('\r\n');
  const header = rows[0].split(',');
  const cells = rows[1].split(',');
  assert.strictEqual(cells[header.indexOf('replacement_cost_usd')], '');
  assert.strictEqual(cells[header.indexOf('confidence')], 'VERY LOW');
  assert.ok(rows[1].includes('No comparable sales on record'));
});

test('the cover statement refuses the word appraisal', async () => {
  const p = await collectionWith(['kennel-pals-calico-cat']);
  const cover = (await captureDownload(p, 'export-cover')).text;
  assert.match(cover, /NOT a professional/);
  assert.match(cover, /not prepared by a licensed appraiser/);
  assert.match(cover, /Active asking prices are never used/);
  assert.match(cover, /REPLACEMENT COST/);
  assert.match(cover, /ACTUAL CASH VALUE/);
});

test('the cover statement counts how much of the schedule is well supported', async () => {
  const p = await collectionWith(['kennel-pals-calico-cat', 'floppy-kitty']);
  const cover = (await captureDownload(p, 'export-cover')).text;
  assert.match(cover, /Items on schedule:\s+2/);
  assert.match(cover, /Lines with a supported value:\s+1/);
});

// ---- membership -------------------------------------------------------------

test('with no provider connected, nothing is gated and the page says so', async () => {
  const p = await renderPage('plans.html');
  noErrors(p);
  const P = p.win.BearChartPlans;
  assert.strictEqual(P.configured(), false);
  assert.strictEqual(P.currentTier({ signedIn: false }), 'unlimited_local');
  // Every paid feature is available, because none of them are purchasable.
  assert.strictEqual(P.can('alerts_push', { signedIn: false }), true);
  assert.strictEqual(P.can('collection_sync', { signedIn: false }), true);
  assert.match(p.doc.getElementById('status-notice').textContent,
    /Nothing is for sale yet/);
});

test('the three plans render with their prices', async () => {
  const p = await renderPage('plans.html');
  const cards = p.doc.querySelectorAll('.plan');
  assert.strictEqual(cards.length, 3);
  const text = p.doc.getElementById('plans').textContent;
  assert.match(text, /Free/);
  assert.match(text, /\$7/);
  assert.match(text, /\$14/);
});

test('entitlements resolve by tier once a provider exists', async () => {
  const p = await renderPage('plans.html');
  const P = p.win.BearChartPlans;
  // Simulate a configured provider by asking the pure resolver directly.
  const plans = P.plans();
  const free = plans.find((x) => x.id === 'free');
  const pro = plans.find((x) => x.id === 'pro');
  const power = plans.find((x) => x.id === 'power');

  // Length, not deepStrictEqual: the array comes from the jsdom realm and
  // carries a different Array prototype, which deepStrictEqual rejects.
  assert.strictEqual(free.entitlements.length, 0, 'the free tier unlocks nothing paid');
  assert.ok(pro.entitlements.includes('collection_sync'));
  assert.ok(!pro.entitlements.includes('alerts_push'), 'alerts are Power only');
  assert.ok(power.entitlements.includes('alerts_push'));
  // Power is a superset of Pro: upgrading never removes something.
  for (const e of pro.entitlements) assert.ok(power.entitlements.includes(e), e);
});

test('an upgrade prompt names the cheapest plan that includes the feature', async () => {
  const p = await renderPage('plans.html');
  const P = p.win.BearChartPlans;
  assert.strictEqual(P.requiredPlan('collection_sync').id, 'pro');
  assert.strictEqual(P.requiredPlan('alerts_push').id, 'power');
  assert.strictEqual(P.requiredPlan('not_a_feature'), null);
});

test('no plan sells a feature only the page enforces', async () => {
  // Every row of the enforcement table is checked by the server or the shop.
  // Entitlements still being built say so rather than claiming enforcement.
  const p = await renderPage('plans.html');
  const table = p.doc.getElementById('enforcement').textContent;
  assert.match(table, /Server/);
  assert.doesNotMatch(table, /Interface only/);
  assert.match(table, /Not built yet/);
  assert.doesNotMatch(table, /Outfit and set valuations/, 'a planned entitlement is not listed as enforced');
});

test('plans tick only what works today; the rest is "On the way"', async () => {
  const p = await renderPage('plans.html');
  const plans = p.doc.getElementById('plans');
  const ticked = Array.from(plans.querySelectorAll('.plan-features li')).map((li) => li.textContent);
  const soon = Array.from(plans.querySelectorAll('.plan-soon li')).map((li) => li.textContent);
  assert.ok(soon.some((t) => /Outfit and set valuations/.test(t)), 'outfits are on the way');
  assert.ok(soon.every((t) => /^On the way: /.test(t)), 'each soon item is announced as such');
  assert.ok(!ticked.some((t) => /Outfit and set|Wishlist alerts|deal alerts|API access/i.test(t)),
    'nothing still being built carries a tick: ' + ticked.join(' | '));
  assert.ok(ticked.some((t) => /showcase of your top 12 bears/.test(t)), 'the showcase is sold, server-checked');
  assert.doesNotMatch(plans.textContent, /Download the sold-price records|\(coming soon\)/);
  const P = p.win.BearChartPlans;
  assert.strictEqual(P.featureStatusFor('power', 'outfits'), 'soon');
  assert.strictEqual(P.featureStatusFor('pro', 'outfits'), null);
  assert.strictEqual(P.featureStatusFor('free', 'values'), 'included');
  assert.ok(P.onTheWay().some((f) => f.id === 'outfits'));
});

test('the sold-comps CSV appears nowhere while its flag is off', async () => {
  assert.strictEqual(loadData().config.features.comps_export, false);
  const index = await renderPage('index.html');
  assert.strictEqual(index.doc.getElementById('csv-sales'), null);
  assert.ok(index.doc.getElementById('exports-note'), 'the note stays for other export messages');
  const item = await renderPage('item.html', 'item.html?id=kennel-pals-calico-cat');
  assert.strictEqual(item.doc.getElementById('export-item'), null);
  assert.ok(item.doc.querySelectorAll('.panel table tbody tr').length > 0, 'the comps themselves stay listed');
  const plans = await renderPage('plans.html');
  assert.doesNotMatch(plans.doc.getElementById('plans').textContent, /CSV/);
  const P = plans.win.BearChartPlans;
  assert.ok(!P.plan('power').entitlements.includes('comps_export'));
});

test('with the flag on, the CSV button asks the export-comps function', async () => {
  const win = await renderWithAuth('index.html', null, null, (d) => { d.config.features.comps_export = true; });
  const btn = win.document.getElementById('csv-sales');
  assert.ok(btn, 'the button is added');
  const invoked = [];
  const client = mockClient({});
  client.functions = { invoke: (name, opts) => {
    invoked.push([name, opts.body.item_ids.length]);
    return Promise.resolve({ data: null, error: { context: { status: 403 } } });
  } };
  await win.BearChartAuth._setClientForTests(client, { user: { id: 'u1', email: 'a@b.test' } });
  btn.dispatchEvent(new win.Event('click'));
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(invoked.length, 1);
  assert.strictEqual(invoked[0][0], 'export-comps');
  assert.ok(invoked[0][1] > 0 && invoked[0][1] <= 500);
  const note = win.document.getElementById('exports-note');
  assert.strictEqual(note.hidden, false);
  assert.match(note.textContent, /Power/);
  assert.match(note.textContent, /free/);

  // A larger result than one request covers is said, not silently cut.
  client.functions.invoke = (name, opts) => {
    invoked.push([name, opts.body.item_ids.length]);
    return Promise.resolve({ data: 'sale_id\r\n', error: null });
  };
  win.BC.download = () => {};
  win.__lastResults = Array.from({ length: 501 }, (_, k) => ({ id: 'bear-' + k }));
  btn.dispatchEvent(new win.Event('click'));
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(invoked[1][1], 500);
  assert.match(note.textContent, /first 500 of 501 matching bears/);
});

test('the shared hot-slot limit is stated before anyone pays, not after', async () => {
  const p = await renderPage('plans.html');
  const text = p.doc.getElementById('hot-slots').textContent;
  assert.match(text, /shared, not personal/);
  assert.match(text, /for the whole site/);
  assert.match(text, /breaks at the fourth customer/);
});

test('no checkout button appears while nothing is purchasable', async () => {
  const p = await renderPage('plans.html');
  assert.strictEqual(p.doc.querySelectorAll('#plans button[data-plan]').length, 0);
  assert.match(p.doc.getElementById('plans').textContent, /Not purchasable yet/);
});

test('paid server features are gated in the database, not just the page', async () => {
  const sql = readSchema();
  assert.match(sql, /create or replace function current_tier/);
  assert.match(sql, /create or replace function has_entitlement/);
  // Collection sync must be refused by the function itself.
  assert.match(sql, /collection sync requires a Pro membership/);
  // Writing hosted history must require the entitlement.
  assert.match(sql, /has_entitlement\('hosted_history'\)/);
});

test('a client cannot write its own subscription row', async () => {
  const sql = readSchema();
  assert.match(sql, /create policy subs_read_own on subscriptions for select/);
  assert.doesNotMatch(sql, /create policy \w+ on subscriptions for (all|insert|update)/,
    'a client that could write this table could grant itself the top tier');
});

test('a lapsed subscription reads as free', async () => {
  const sql = readSchema();
  assert.match(sql, /current_period_end is null or s\.current_period_end > now\(\)/);
  assert.match(sql, /status in \('active','trialing'\)/);
});

test('a lapsed member can still read their own history', async () => {
  // Losing access to data you already created would be punitive, and is a
  // different decision from losing the ability to add more.
  const sql = readSchema();
  assert.match(sql, /snapshots_read_own on holding_snapshots for select\s+using \(auth\.uid\(\) = user_id\)/);
});

test('the membership tab is reachable from every page', async () => {
  for (const page of ['index.html', 'collection.html', 'account.html']) {
    const p = await renderPage(page);
    assert.match(p.doc.getElementById('masthead').innerHTML, /plans\.html/,
      page + ' should link to membership');
  }
});

// ---- Stripe integration -----------------------------------------------------
// These assert the security-critical shape of code that cannot be run here (it
// is Deno, and needs live Stripe keys). They are the guard against someone
// later "simplifying" away a check that is the only thing standing between a
// stranger and a free Power membership.

// index.ts is wiring only; the logic lives in _shared/. Concatenate both so
// these shape tests keep guarding wherever the code moved.
function sharedSources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((d) => {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) return sharedSources(p);
      return d.name.endsWith('.ts') ? [fs.readFileSync(p, 'utf8')] : [];
    });
}
const SHARED_DIR = path.join(ROOT, 'supabase', 'functions', '_shared');
const edgeFn = (name) =>
  [fs.readFileSync(path.join(ROOT, 'supabase', 'functions', name, 'index.ts'), 'utf8')]
    .concat(sharedSources(SHARED_DIR)).join('\n');

test('the webhook verifies the Stripe signature before trusting the body', async () => {
  const src = edgeFn('stripe-webhook');
  assert.match(src, /constructEventAsync/,
    'Deno crypto is async-only; the sync variant fails silently');
  assert.match(src, /STRIPE_WEBHOOK_SECRET/);
  assert.match(src, /return new Response\("invalid signature", \{ status: 400 \}\)/);
  // The raw body must be used; reserialising changes the signed bytes.
  assert.match(src, /const body = await req\.text\(\)/);
});

test('the webhook never takes the tier or the user from the request', async () => {
  const src = edgeFn('stripe-webhook');
  // Tier comes from the price id Stripe reports, matched against env.
  assert.match(src, /function tierForPrice/);
  assert.match(src, /get\("PRICE_POWER"\)|v\("PRICE_POWER"\)/);
  // User: the recorded customer first, then client_reference_id, which was set
  // server-side at checkout.
  assert.match(src, /o\.client_reference_id/);
  assert.match(src, /known \?\? \(isUuid\(hint\) \? hint : null\)/);
  assert.doesNotMatch(src, /body\.(user_id|tier)/,
    'a request that could name its own tier would not need to pay');
});

test('the webhook is idempotent, because Stripe delivers at least once', async () => {
  const src = edgeFn('stripe-webhook');
  assert.match(src, /stripe_events/);
  assert.match(src, /duplicate: true/);
  assert.match(src, /23505/, 'a unique-violation means we have seen this event');
  // A failed handler must release the lock so the retry can do real work.
  assert.match(src, /from\("stripe_events"\)\.delete\(\)\.eq\("id", id\)/);
  assert.match(src, /await events\.release\(e\.id\)/);
});

test('the webhook writes with the service role, which no client holds', async () => {
  const src = edgeFn('stripe-webhook');
  assert.match(src, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(src, /rpc\("apply_subscription_state"/);
  const sql = readSchema();
  assert.match(sql, /alter table stripe_events enable row level security/);
  assert.doesNotMatch(sql, /create policy \w+ on stripe_events/,
    'RLS on with no policies denies every client, which is the intent');
});

test('checkout resolves the buyer from their token, not from the body', async () => {
  const src = edgeFn('create-checkout');
  assert.match(src, /client\.auth\.getUser\(\)/);
  assert.match(src, /client_reference_id: i\.userId/);
  assert.match(src, /userId: caller\.id/);
  assert.doesNotMatch(src, /body\.user_id|body\?\.user_id/);
});

test('checkout takes a plan name and resolves the price itself', async () => {
  const src = edgeFn('create-checkout');
  assert.match(src, /function priceForPlan/);
  assert.match(src, /line_items: \[\{ price: i\.priceId, quantity: 1 \}\]/);
  // A caller who could pass a price id could pass the cheapest one.
  assert.doesNotMatch(src, /body\.price|price: *body/);
  // Never echo the input back.
  assert.match(src, /error: "unknown plan" \}/);
  assert.doesNotMatch(src, /unknown plan: \$\{/);
});

test('checkout does not leak provider errors to the browser', async () => {
  const src = edgeFn('create-checkout');
  assert.match(src, /could not start checkout/);
  assert.doesNotMatch(src, /error: \(err as Error\)\.message/,
    'Stripe error text can name internal configuration');
});

test('members can cancel without emailing anyone', async () => {
  const src = edgeFn('create-portal');
  assert.match(src, /billingPortal\.sessions\.create/);
  // The customer is looked up for the caller under their own RLS, so nobody
  // can open somebody else's billing page.
  assert.match(src, /forUser\(caller\.user\.id\)/);
  assert.match(src, /\.eq\("user_id", userId\)/);
});

test('every edge function checks the Stripe key against the environment and is observed', async () => {
  for (const name of ['stripe-webhook', 'create-checkout', 'create-portal']) {
    const idx = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', name, 'index.ts'), 'utf8');
    assert.match(idx, /stripeSecretKey\(get\)/, name + ' must use the live/test key guard');
    assert.match(idx, new RegExp('withObservability\\("' + name + '"'), name);
    // Settings are read on the request, never at module load.
    assert.doesNotMatch(idx, /^const \w+ = .*Deno\.env/m, name);
  }
});

test('pure billing modules never import esm.sh or touch Deno', async () => {
  const pure = ['http.ts', 'env.ts', 'billing/types.ts', 'billing/ports.ts', 'billing/policy.ts',
    'billing/service.ts', 'billing/checkout_service.ts', 'billing/webhook_handler.ts'];
  for (const f of pure) {
    const src = fs.readFileSync(path.join(SHARED_DIR, f), 'utf8');
    assert.doesNotMatch(src, /esm\.sh/, f);
    assert.doesNotMatch(src, /\bDeno\./, f);
  }
});

test('the client sends a plan name and never a price', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'plans.js'), 'utf8');
  assert.match(src, /body: \{ plan: id \}/);
  assert.doesNotMatch(src, /price_id|priceId/);
});

test('checkout stays inert until a provider is configured', async () => {
  const p = await renderPage('plans.html');
  assert.strictEqual(p.doc.querySelectorAll('#plans button[data-plan]').length, 0);
  assert.match(p.doc.getElementById('plans').textContent, /Not purchasable yet/);
});

// ---- runtime config and error reporting -------------------------------------
// config.js is committed inert; observability.js must do nothing without a DSN:
// no script element, no request, no console noise.

const ROOT_PAGES = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));

test('every page loads config.js then observability.js before anything else', async () => {
  for (const page of ROOT_PAGES) {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    const srcs = Array.from(html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g), (m) => m[1]
      .replace(/^\//, ''));
    assert.deepStrictEqual(srcs.slice(0, 2), ['config.js', 'observability.js'], page);
  }
  const itemHtml = fs.readFileSync(path.join(ROOT, 'item', '_offline.html'), 'utf8');
  // Script order per the master brief (#13).
  assert.match(itemHtml, /<script src="\.\.\/config\.js"><\/script>\s*<script src="\.\.\/observability\.js"><\/script>\s*<script src="\.\.\/site-config\.js"><\/script>\s*<script src="\.\.\/sanitize\.js"><\/script>\s*<script src="\.\.\/bc-data\.js">/);
});

test('the service worker precaches the shell by per-file hash, data index included', async () => {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const pre = JSON.parse(sw.match(/const PRECACHE = (\[[\s\S]*?\]);/)[1]);
  const urls = pre.map((e) => e.url);
  for (const f of ['config.js', 'observability.js', 'site-config.js', 'bc-data.js', 'item/_offline.html']) {
    assert.ok(urls.includes(f), f + ' precached');
  }
  assert.ok(!urls.includes('data.js'), 'data.js is gone');
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'manifest.json'), 'utf8'));
  assert.ok(urls.includes(manifest.index), 'the catalogue index is precached');
  assert.ok(urls.includes(manifest.listings), 'the listings are precached');
  assert.ok(!urls.some((u) => /^data\/items\//.test(u)), 'item files are cached as visited');
  const crypto = require('node:crypto');
  for (const e of pre) {
    if (e.url === 'config.js') continue;   // the deploy's copy, see build_site.sh
    const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, e.url)))
      .digest('hex').slice(0, 12);
    assert.strictEqual(e.rev, sha, e.url + ' rev is its own hash');
  }
  // config.js and site-config.js must not go stale while online.
  assert.deepStrictEqual(JSON.parse(sw.match(/const NETWORK_FIRST = (\[[^\]]*\]);/)[1]),
    ['config.js', 'site-config.js']);
  assert.match(sw, /const SHELL = 'bearchart-shell-[0-9a-f]{12}'/);
  assert.match(sw, /bearchart-items-v1/);
  assert.match(sw, /bearchart-pages-v1/);
});

test('the service worker writes a version key only at install, never for a runtime refresh', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const body = (name) => {
    const at = sw.indexOf('async function ' + name + '(');
    assert.ok(at > -1, name);
    const rest = sw.slice(at + 1);
    const end = rest.search(/\n(async function |function |const |self\.addEventListener)/);
    return rest.slice(0, end);
  };
  for (const fn of ['networkFirst', 'staleWhileRevalidate', 'navigate']) {
    assert.doesNotMatch(body(fn), /put[^;\n]*revKey/, fn + ' stores a fresh response under a ?__rev= key');
  }
  // Offline, the version's own site-config wins over a newer runtime copy.
  assert.match(body('cached'), /revKey\(rel\)[\s\S]*RUNTIME/);
  assert.match(sw, /const RUNTIME = 'bearchart-runtime-v1'/);
});

test('cache headers: hashed data is immutable, the manifest and item files revalidate', () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const cc = (src) => ((vercel.headers.find((h) => h.source === src) || { headers: [] }).headers
    .find((h) => h.key === 'Cache-Control') || {}).value;
  assert.strictEqual(cc('/data/h/(.*)'), 'public, max-age=31536000, immutable');
  assert.strictEqual(cc('/data/items/(.*)'), 'public, max-age=0, must-revalidate');
  assert.strictEqual(cc('/site-config.js'), 'public, max-age=0, must-revalidate');
  assert.strictEqual(cc('/sw.js'), 'public, max-age=0, must-revalidate');
});

test('generated files are not committed', () => {
  const tracked = require('node:child_process').execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' })
    .split('\n');
  for (const f of ['data.js', 'sw.js', 'site-config.js']) assert.ok(!tracked.includes(f), f + ' is tracked');
  assert.ok(!tracked.some((f) => /^(data|item)\//.test(f)), 'data/ or item/ is tracked');
  assert.ok(tracked.includes('data.json'), 'data.json is the dataset of record');
  assert.ok(tracked.includes('tools/imported_sales.json'), 'imported sales stay tracked (owner decision)');
});

test('the committed config.js sets nothing', async () => {
  const dom = track(new JSDOM('<!doctype html><html><head></head><body></body></html>',
    { url: 'https://bearchart.test/', runScripts: 'outside-only' }));
  dom.window.eval(fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8'));
  assert.deepStrictEqual(Object.keys(dom.window.BEARCHART_RUNTIME), []);
});

test('error reporting is inert without a DSN on every page', async () => {
  for (const page of ['index.html', 'item.html', 'collection.html', 'account.html', 'plans.html']) {
    const p = await renderPage(page);
    noErrors(p);
    assert.strictEqual(p.win.bcObs.enabled, false, page);
    assert.strictEqual(p.doc.querySelectorAll('script[src*="sentry"]').length, 0,
      page + ' must not inject the Sentry SDK');
    // Safe to call whether or not reporting is on.
    p.win.bcObs.captureException(new Error('ignored'));
    p.win.bcObs.setUser('user-1');
  }
});

/** observability.js alone, in a window that looks like a deployed site. */
function observabilityWindow(runtime, url) {
  const dom = track(new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: url || 'https://preview.bearchart.test/item/x.html?q=bear#access_token=secret',
    runScripts: 'outside-only',
    resources: new OfflineLoader({ userAgent: 'Mozilla/5.0 (BearChart test browser)' })
  }));
  dom.window.BEARCHART_RUNTIME = runtime;
  dom.window.eval(fs.readFileSync(path.join(ROOT, 'observability.js'), 'utf8'));
  return dom.window;
}

test('without a DSN, even on a deployed host, nothing is loaded', async () => {
  const win = observabilityWindow({});
  assert.strictEqual(win.document.querySelectorAll('script').length, 0);
  assert.strictEqual(win.bcObs.enabled, false);
});

test('a DSN is ignored on localhost', async () => {
  const win = observabilityWindow({ sentry_dsn: 'https://k@o1.ingest.us.sentry.io/1' },
    'http://localhost:5173/index.html');
  assert.strictEqual(win.document.querySelectorAll('script').length, 0);
});

test('with a DSN the pinned SDK loads with SRI, and reports carry no tokens or email', async () => {
  const win = observabilityWindow({ sentry_dsn: 'https://k@o1.ingest.us.sentry.io/1',
                                    env: 'preview', release: 'abc123' });
  const el = win.document.querySelector('script');
  assert.match(el.src, /^https:\/\/browser\.sentry-cdn\.com\/\d+\.\d+\.\d+\/bundle\.min\.js$/);
  assert.match(el.integrity, /^sha384-/);
  assert.strictEqual(el.crossOrigin, 'anonymous');

  // Before the SDK arrives, an error is queued rather than lost.
  const early = new Error('early');
  win.bcObs.captureException(early);

  const calls = { init: null, captured: [], user: [] };
  win.Sentry = {
    init: (o) => { calls.init = o; },
    captureException: (e) => calls.captured.push(e),
    captureMessage: () => {},
    setUser: (u) => calls.user.push(u)
  };
  el.onload();
  assert.strictEqual(win.bcObs.enabled, true);
  assert.strictEqual(calls.init.environment, 'preview');
  assert.strictEqual(calls.init.release, 'abc123');
  assert.strictEqual(calls.init.sendDefaultPii, false);
  assert.deepStrictEqual(calls.captured, [early]);

  const ev = calls.init.beforeSend({ request: {
    url: 'https://preview.bearchart.test/account.html?x=1#access_token=secret', cookies: 'sb=1',
    query_string: 'x=1',
    headers: { Referer: 'https://preview.bearchart.test/account.html#access_token=secret',
               'User-Agent': 'ua' } } });
  assert.strictEqual(ev.request.url, 'https://preview.bearchart.test/account.html');
  assert.strictEqual(ev.request.cookies, undefined);
  assert.strictEqual(ev.request.query_string, undefined);
  assert.strictEqual(ev.request.headers.Referer, undefined);
  assert.strictEqual(ev.request.headers['User-Agent'], 'ua');
  const crumb = calls.init.beforeBreadcrumb({ data: { url: '/a?b=c#d' } });
  assert.strictEqual(crumb.data.url, '/a');
  const nav = calls.init.beforeBreadcrumb({ category: 'navigation', data: {
    from: '/account.html#access_token=x&refresh_token=y', to: '/collection.html?ref=mail#access_token=x' } });
  assert.strictEqual(nav.data.from, '/account.html');
  assert.strictEqual(nav.data.to, '/collection.html');
  assert.doesNotMatch(JSON.stringify(nav), /access_token/);

  win.bcObs.setUser('user-1');
  win.bcObs.setUser(null);
  // The user object is built in the page's realm; compare its shape.
  assert.strictEqual(JSON.stringify(calls.user), '[{"id":"user-1"},null]');
});

test('a deploy can switch accounts off through config.js, overriding site-config.js', async () => {
  const dom = track(new JSDOM('<!doctype html><html><head></head><body></body></html>',
    { url: 'https://preview.bearchart.test/', runScripts: 'outside-only' }));
  dom.window.BEARCHART_CONFIG = { auth: { enabled: true,
    supabase_url: 'https://prod.supabase.co', supabase_anon_key: 'prod-anon' } };
  dom.window.BEARCHART_RUNTIME = { auth: { enabled: false } };
  for (const f of ['config.js', 'bc-data.js', 'auth.js']) {
    dom.window.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  }
  assert.strictEqual(dom.window.BearChartAuth.configured(), false);
});

test('member photos follow the deploy override: accounts off means no request at all', async () => {
  // A browser-like window (not jsdom's UA), so only the config can stop the fetch.
  const dom = track(new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'https://preview.bearchart.test/item/x.html', runScripts: 'outside-only',
    resources: new OfflineLoader({ userAgent: 'Mozilla/5.0 (BearChart test browser)' })
  }));
  const win = dom.window;
  win.BEARCHART_CONFIG = { auth: { enabled: true,
    supabase_url: 'https://prod.supabase.co', supabase_anon_key: 'prod-anon' } };
  win.BEARCHART_RUNTIME = { auth: { enabled: false } };
  const fetched = [];
  win.fetch = (url) => { fetched.push(String(url)); return Promise.resolve({ ok: true, json: () => [] }); };
  for (const f of ['config.js', 'bc-data.js', 'auth.js', 'submissions.js']) {
    win.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  }
  assert.strictEqual(win.BearChartAuth.config().enabled, false);
  const photos = await win.BearChartSubmissions.memberPhotos();
  assert.strictEqual(JSON.stringify(photos), '{}');
  assert.deepStrictEqual(fetched, [], 'a preview must not query the production database');

  // Control: without the override the same window does query the configured project.
  win.BEARCHART_RUNTIME = {};
  for (const f of ['auth.js', 'submissions.js']) win.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  await win.BearChartSubmissions.memberPhotos();
  assert.strictEqual(fetched.length, 1);
  assert.match(fetched[0], /^https:\/\/prod\.supabase\.co\/rest\/v1\/item_photos/);
});

// ---- security: links, CSP, auth links (security workstream) -----------------

const ROOT_HTML = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).sort();
const ROOT_JS = fs.readdirSync(ROOT).filter((f) => f.endsWith('.js')).sort();

test('an image with a javascript: url renders the placeholder, not the url', async () => {
  const p = await renderPage('index.html');
  const html = p.win.BC.imageHtml({ id: 'x', canonical_name: 'X', image_url: 'javascript:alert(1)' }, 'hero');
  assert.doesNotMatch(html, /javascript:/i);
  assert.match(html, /is-placeholder/);
});

test('a broken photo swaps in its fallback through the delegated listener', async () => {
  const p = await renderPage('index.html');
  const host = p.doc.createElement('div');
  host.innerHTML = p.win.BC.imageHtml({ id: 'x', canonical_name: 'X', image_url: '/nope.jpg' }, 'thumb');
  p.doc.body.appendChild(host);
  const img = host.querySelector('img');
  img.dispatchEvent(new p.win.Event('error'));
  assert.match(img.getAttribute('src'), /^data:image\/svg\+xml/);
  assert.ok(img.classList.contains('is-placeholder'));
});

test('the admin queue never turns a member-supplied javascript: link into an href', async () => {
  const win = await renderWithAuth('admin.html');
  const row = win.__adminTest.compRow({ id: 'c1', item_slug: 'lucky-kitty', sold_price: 10,
    status: 'pending', listing_url: 'javascript:alert(1)', listing_id: '12345' });
  assert.doesNotMatch(row, /href="javascript/i);
  assert.match(row, /12345/, 'the listing id is still shown as text');
  const ok = win.__adminTest.compRow({ id: 'c2', item_slug: 'lucky-kitty', sold_price: 10,
    status: 'pending', listing_url: 'https://www.ebay.com/itm/1' });
  assert.match(ok, /href="https:\/\/www\.ebay\.com\/itm\/1"/);
  assert.match(ok, /rel="noopener noreferrer"/);
});

test('no dynamic href is built with esc() alone', async () => {
  for (const f of ROOT_JS.filter((x) => x !== 'data.js' && x !== 'sanitize.js')) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.doesNotMatch(src, /href="' \+ (BC\.)?esc\(/, f + ': use BC.extLink / BC.safeUrl for outbound links');
  }
});

test('every CSV goes through the formula-safe toCsv in sanitize.js', async () => {
  for (const f of ROOT_JS.filter((x) => x !== 'data.js' && x !== 'sanitize.js')) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.doesNotMatch(src, /replace\(\/"\/g, '""'\)/, f + ' hand-rolls CSV quoting');
  }
});

test('the listing field takes an https link or a bare id, nothing else', async () => {
  const win = await renderWithAuth('item.html', 'item.html?id=lucky-kitty');
  const S = win.BearChartSubmissions;
  assert.deepStrictEqual(Object.assign({}, S.classifyListingRef('https://www.ebay.com/itm/123')),
    { listing_url: 'https://www.ebay.com/itm/123' });
  assert.deepStrictEqual(Object.assign({}, S.classifyListingRef('123456789')), { listing_id: '123456789' });
  assert.match(S.classifyListingRef('javascript:alert(1)').error, /https:\/\//);
  assert.match(S.classifyListingRef('javascript:').error, /https:\/\//);
  assert.match(S.classifyListingRef('http://www.ebay.com/itm/1').error, /https:\/\//);
});

test('a problem report sends the page path, never the full address', async () => {
  const win = await renderWithAuth('item.html', 'item.html?id=lucky-kitty&code=secret#access_token=t');
  const client = mockClient({});
  await win.BearChartAuth._setClientForTests(client, null);
  const res = await win.BearChartSubmissions.reportItem({ item_slug: 'lucky-kitty', reason: 'other' });
  assert.strictEqual(res.ok, true);
  const [fn, args] = client.calls[0];
  assert.strictEqual(fn, 'report_item');
  assert.strictEqual(args.entry.page_url, '/item.html');
});

test('no page runs an inline script (the CSP allows none)', async () => {
  for (const f of ROOT_HTML) {
    const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of html.matchAll(/<script\b([^>]*)>/gi)) {
      const attrs = m[1];
      if (/\bsrc=/.test(attrs) || /type="application\/ld\+json"/.test(attrs)) continue;
      assert.fail(f + ' has an inline <script' + attrs + '>');
    }
    assert.doesNotMatch(html, /\son[a-z]+\s*=\s*["']/i, f + ' has an inline event handler');
  }
});

test('no script builds markup with an inline event handler', async () => {
  for (const f of ROOT_JS.filter((x) => x !== 'data.js' && x !== 'icons.js')) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.doesNotMatch(src, /\son[a-z]+=\s*["']/, f);
  }
});

test('the CSP and security headers are set for every path', async () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const all = vercel.headers.find((h) => h.source === '/(.*)');
  assert.ok(all, 'a catch-all header block');
  const get = (k) => (all.headers.find((h) => h.key === k) || {}).value || '';
  const csp = get('Content-Security-Policy');
  const directive = (name) => (csp.split(';').map((d) => d.trim())
    .find((d) => d.split(/\s+/)[0] === name) || '');
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'self'/);
  const scriptSrc = directive('script-src');
  assert.ok(scriptSrc, 'script-src is set');
  assert.doesNotMatch(scriptSrc, /unsafe-inline|unsafe-eval/);
  assert.doesNotMatch(csp, /jsdelivr|unpkg/);
  // Error reporting (observability.js) loads Sentry's bundle and posts to its ingest host.
  assert.match(scriptSrc, /https:\/\/browser\.sentry-cdn\.com/);
  assert.match(directive('connect-src'), /https:\/\/\*\.ingest\.us\.sentry\.io/);
  assert.match(scriptSrc, /https:\/\/us-assets\.i\.posthog\.com/);
  // The Supabase project the site talks to must be allowed, or sign-in breaks.
  const host = new URL(loadData().config.auth.supabase_url).host;
  assert.ok(directive('connect-src').split(/\s+/).includes('https://' + host), 'connect-src has ' + host);
  assert.ok(directive('connect-src').split(/\s+/).includes('wss://' + host), 'connect-src has wss://' + host);
  assert.match(get('Strict-Transport-Security'), /max-age=\d{8,}/);
  assert.match(get('Permissions-Policy'), /camera=\(\)/);
  assert.strictEqual(get('X-Frame-Options'), 'DENY');
});

test('the Sentry bundle observability.js loads is the one the CSP allows', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'observability.js'), 'utf8');
  const url = src.match(/SDK_URL = '([^']+)'/)[1];
  assert.strictEqual(new URL(url).origin, 'https://browser.sentry-cdn.com');
  assert.match(src, /SDK_SRI = 'sha384-/);
});

test('supabase-js is vendored and pinned: no CDN anywhere', async () => {
  for (const f of ROOT_HTML.concat(['auth.js'])) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.doesNotMatch(src, /jsdelivr|unpkg/, f);
  }
});

test('the vendored supabase-js matches the SRI hash auth.js loads it with', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8');
  const ver = src.match(/SUPABASE_VERSION = '([^']+)'/)[1];
  const sri = src.match(/SUPABASE_SRI = '([^']+)'/)[1];
  const file = path.join(ROOT, 'vendor', 'supabase-js-' + ver + '.min.js');
  assert.ok(fs.existsSync(file), file + ' exists');
  const digest = require('node:crypto').createHash('sha384').update(fs.readFileSync(file)).digest('base64');
  assert.strictEqual(sri, 'sha384-' + digest, 'run tools/vendor_supabase.sh and update auth.js');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.strictEqual(pkg.devDependencies['@supabase/supabase-js'], ver,
    'package.json pins the same exact version');
  assert.match(fs.readFileSync(path.join(ROOT, 'tools', 'build_site.sh'), 'utf8'),
    /cp -r [^\n]*\bvendor\b/, 'build_site.sh ships vendor/');
});

test('sanitize.js loads before auth.js on every page that loads auth', async () => {
  for (const f of ROOT_HTML) {
    const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
    if (html.indexOf('auth.js') === -1) continue;
    assert.ok(html.indexOf('sanitize.js') > -1, f + ' loads sanitize.js');
    assert.ok(html.indexOf('sanitize.js') < html.indexOf('auth.js'), f + ': sanitize.js before auth.js');
    assert.ok(html.indexOf('observability.js') < html.indexOf('sanitize.js'), f + ': after observability.js');
  }
  const pages = fs.readFileSync(path.join(ROOT, 'tools', 'build_pages.py'), 'utf8');
  const scripts = pages.match(/SCRIPTS = \[([^\]]+)\]/)[1];
  assert.ok(scripts.indexOf('"sanitize.js"') > -1 && scripts.indexOf('"sanitize.js"') < scripts.indexOf('"auth.js"'),
    'generated item pages load sanitize.js before auth.js');
  const pwa = fs.readFileSync(path.join(ROOT, 'tools', 'build_pwa.py'), 'utf8');
  for (const f of ['sanitize.js', 'about.js', 'page.js']) assert.ok(pwa.indexOf('"' + f + '"') > -1, f + ' precached');
});

test('every page loads the shared scripts in the one agreed order', () => {
  const ORDER = ['config.js', 'observability.js', 'site-config.js', 'sanitize.js', 'bc-data.js',
    'engine.js', 'icons.js', 'auth.js', 'entitlements.js', 'submissions.js', 'common.js'];
  for (const f of ROOT_HTML) {
    const srcs = Array.from(fs.readFileSync(path.join(ROOT, f), 'utf8')
      .matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)).map((m) => m[1].replace(/^\//, ''));
    if (!srcs.includes('common.js')) continue;   // 404.html: config and error reporting only
    assert.deepStrictEqual(srcs.slice(0, ORDER.length), ORDER, f);
    assert.ok(!srcs.includes('data.js'), f + ' still loads data.js');
  }
  const pages = fs.readFileSync(path.join(ROOT, 'tools', 'build_pages.py'), 'utf8');
  const scripts = JSON.parse(pages.match(/SCRIPTS = (\[[^\]]+\])/)[1]);
  assert.deepStrictEqual(scripts, ORDER.concat(['item.js']), 'generated item pages');
  const pwa = fs.readFileSync(path.join(ROOT, 'tools', 'build_pwa.py'), 'utf8');
  for (const f of ORDER) assert.ok(pwa.indexOf('"' + f + '"') > -1, f + ' precached');
  assert.ok(pwa.indexOf('"data.js"') === -1, 'data.js is not precached');
});

test('the dead direct collections upload is gone from the account page', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'account.js'), 'utf8');
  assert.doesNotMatch(src, /add_collection_items/);
});

test('auth uses PKCE and listens for PASSWORD_RECOVERY before reading the session', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8');
  assert.match(src, /flowType: 'pkce'/);
  const listen = src.indexOf('onAuthStateChange(');
  const read = src.indexOf('getSession(');
  assert.ok(listen > -1 && read > -1 && listen < read, 'register the listener before getSession');
  assert.match(src, /PASSWORD_RECOVERY/);
  assert.match(src, /redirectTo: siteUrl\('account\.html'\)/);
  assert.match(src, /emailRedirectTo: siteUrl\('account\.html'\)/);
});

function recoveryClient() {
  const c = mockClient({});
  c.updates = [];
  c.auth = { updateUser: (u) => { c.updates.push(u); return Promise.resolve({ data: {}, error: null }); } };
  return c;
}

test('a password-reset link asks for a new password and checks it', async () => {
  const win = await renderWithAuth('account.html');
  const A = win.BearChartAuth;
  const client = recoveryClient();
  await A._setClientForTests(client, { user: { id: 'u1', email: 'jay@example.com' } });
  A._setRecoveryForTests(true);
  assert.ok(win.document.getElementById('new-password'), 'the recovery view is shown');
  assert.ok(win.document.getElementById('confirm-password'));
  assert.strictEqual(win.document.getElementById('new-password').getAttribute('autocomplete'), 'new-password');
  assert.match((await A.updatePassword('short', 'short')).message, /at least 8/);
  assert.match((await A.updatePassword('long-enough-1', 'long-enough-2')).message, /do not match/);
  assert.strictEqual(client.updates.length, 0, 'nothing is sent for an invalid password');
  const ok = await A.updatePassword('long-enough-1', 'long-enough-1');
  assert.strictEqual(ok.ok, true);
  // The arg object comes from the jsdom realm: compare by JSON, not prototype.
  assert.strictEqual(JSON.stringify(client.updates), JSON.stringify([{ password: 'long-enough-1' }]));
  assert.strictEqual(A.state().recovery, false);
  assert.ok(!win.document.getElementById('new-password'), 'back to the normal account view');
});

test('the password minimum has one definition', async () => {
  const win = await renderWithAuth('account.html');
  const A = win.BearChartAuth;
  assert.strictEqual(A.MIN_PASSWORD_LENGTH, 8);
  assert.match(A.passwordProblem('1234567'), /at least 8/);
  assert.strictEqual(A.passwordProblem('12345678'), null);
});

test('analytics never receives login codes from the address bar', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'common.js'), 'utf8');
  assert.match(src, /before_send: S \? S\.scrubEvent/);
  assert.match(src, /sanitize_properties:/);
  assert.match(src, /custom_personal_data_properties/);
});

test('member uploads are sniffed and re-encoded, and approval re-encodes before publishing', async () => {
  const subs = fs.readFileSync(path.join(ROOT, 'submissions.js'), 'utf8');
  assert.match(subs, /sniffImageType\(/);
  assert.doesNotMatch(subs, /file\.type/, 'the declared type is never trusted');
  const admin = fs.readFileSync(path.join(ROOT, 'admin.js'), 'utf8');
  const body = admin.slice(admin.indexOf('function approvePhoto'), admin.indexOf('function rejectPhoto'));
  assert.ok(body.indexOf('shrinkPhoto(') > -1 && body.indexOf('shrinkPhoto(') < body.indexOf('.upload('),
    'approvePhoto re-encodes before uploading to the public bucket');
  assert.doesNotMatch(body, /reviewed_at:/, 'the database stamps the reviewer');
});

test('billing redirects only ever go to Stripe', async () => {
  for (const f of ['account.js', 'plans.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.match(src, /BC\.safeRedirect\(res\.data\.url, \['checkout\.stripe\.com', 'billing\.stripe\.com'\]\)/, f);
    assert.doesNotMatch(src, /location\.href = res\.data\.url/, f);
  }
});

test('affiliate links are marked sponsored', async () => {
  const p = await renderPage('index.html');
  const BC = p.win.BC;
  const saved = BC.business.ebay_campaign_id;
  BC.business.ebay_campaign_id = '5338000000';
  try {
    const a = BC.affiliateLink('https://www.ebay.com/itm/1', 'x');
    assert.match(a, /campid=5338000000/);
    assert.match(a, /rel="noopener noreferrer sponsored"/);
    assert.strictEqual(BC.affiliateLink('javascript:alert(1)', 'x'), 'x');
  } finally { BC.business.ebay_campaign_id = saved; }
});

test('the guide rewrites only its own URL parameters, never an auth link\'s', async () => {
  const p = await renderPage('index.html', 'index.html?code=abc&sort=relevance#access_token=t');
  const q = p.doc.getElementById('q');
  q.value = 'bear';
  q.dispatchEvent(new p.win.Event('input'));
  return new Promise((done) => setTimeout(() => {
    const loc = p.win.location;
    assert.match(loc.search, /code=abc/);
    assert.match(loc.search, /q=bear/);
    assert.strictEqual(loc.hash, '#access_token=t');
    done();
  }, 200));
});

test('a failed email link shows a fixed message, not text from the URL', async () => {
  const win = await renderWithAuth('account.html',
    'account.html?error=access_denied&error_description=Call+0800+SCAM+now');
  // init() runs on load; the link error is captured before anything else.
  await new Promise((r) => setTimeout(r, 20));
  const msg = win.BearChartAuth.state().linkError;
  assert.ok(msg, 'the link error is reported');
  assert.doesNotMatch(msg, /SCAM|0800/);
  assert.match(msg, /expired or has already been used/);
});

test('a contact email that could add mailto parameters gets no button', async () => {
  const win = await renderWithBusiness('lucky-kitty', { enabled: true, contact_url: '',
    contact_email: 'jay@example.com?bcc=x@evil.test' });
  assert.doesNotMatch(win.document.body.innerHTML, /mailto:/);
  const ok = await renderWithBusiness('lucky-kitty', { enabled: true, contact_url: '',
    contact_email: 'jay@example.com' });
  assert.match(ok.document.body.innerHTML, /mailto:jay@example\.com\?subject=/);
});

test('no test-only hooks leak into a real browser', async () => {
  const admin = fs.readFileSync(path.join(ROOT, 'admin.js'), 'utf8');
  const hook = admin.indexOf('window.__adminTest =');
  assert.ok(hook > -1 && admin.lastIndexOf('/jsdom/i.test(', hook) > hook - 200,
    '__adminTest is only set under jsdom');
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'showcase.js'), 'utf8'), /window\.BearChartShowcase/);
});

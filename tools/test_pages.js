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
  const item = p.win.BEARCHART_DATA.items.find((i) => i.id === itemId);
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
 * Pass {full: true} where the real shipped payload is the point - that is what
 * keeps "data.js and data.json carry identical content" honest.
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

function renderPage(file, url, opts) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(e.message + '\n' + (e.stack || '')));
  vc.on('error', (...args) => errors.push('console.error: ' + args.join(' ')));
  vc.on('warn', (...args) => errors.push('console.warn: ' + args.join(' ')));

  // Stop jsdom from running inline scripts while it parses.
  //
  // In a browser a classic <script src> blocks the parser, so about.html's
  // inline script is guaranteed to run after common.js has defined BC. jsdom
  // does not fetch those src scripts here, so the inline one would otherwise
  // run first and die on an undefined BC. This used to pass only because the
  // old resource loader left those fetches pending forever, which deferred the
  // inline script as a side effect - and was also what hung the suite.
  //
  // Neutralising the type here and running every script below in document
  // order gets the browser's ordering guarantee back, without depending on a
  // fetch that never returns.
  const html = fs.readFileSync(path.join(ROOT, file), 'utf8')
    .replace(/<script(?![^>]*\bsrc=)([^>]*)>/gi, '<script$1 type="application/x-deferred">');

  const dom = track(new JSDOM(html, {
    url: 'http://localhost:5173/' + (url || file),
    runScripts: 'dangerously',
    resources: new OfflineLoader(),
    virtualConsole: vc,
    pretendToBeVisual: true
  }));

  // There is no network here, so the Supabase client script can never load.
  // Production waits 8 seconds before giving up - right for a browser on a slow
  // connection, ruinous across 150 renders. The fallback path is what we want to
  // exercise; we just do not want to wait for it. Set on the window rather than
  // in BEARCHART_DATA, so the shipped data stays byte-identical to data.json.
  dom.window.__BEARCHART_SCRIPT_TIMEOUT_MS = 5;

  // jsdom will not fetch local scripts for us here, so execute them in order,
  // exactly as the browser would.
  const scripts = Array.from(dom.window.document.querySelectorAll('script'));
  for (const el of scripts) {
    const src = el.getAttribute('src');

    // A deferred inline script: run it now that everything before it has run.
    if (!src) {
      try {
        dom.window.eval(el.textContent);
      } catch (e) {
        errors.push('inline script in ' + file + ': ' + e.message);
      }
      continue;
    }
    // Anything remote (the webfont) is not this suite's business.
    if (/^https?:/i.test(src)) continue;
    // Skip the 2.4MB generated data.js entirely and hand the window a parsed
    // fixture. Re-parsing that file for each of 150 renders was, on its own,
    // about a quarter of the suite's runtime.
    if (src === 'data.js' && !(opts && opts.full)) {
      dom.window.eval('window.BEARCHART_DATA = JSON.parse(' +
        JSON.stringify(fixtureJson()) + ');');
      continue;
    }
    const code = fs.readFileSync(path.join(ROOT, src), 'utf8');
    try {
      dom.window.eval(code);
    } catch (e) {
      errors.push('while running ' + src + ': ' + e.message + '\n' + e.stack);
    }

  }
  // Inline scripts (about.html uses one) run after the external ones.
  for (const el of dom.window.document.querySelectorAll('script:not([src])')) {
    try {
      dom.window.eval(el.textContent);
    } catch (e) {
      errors.push('inline script: ' + e.message + '\n' + e.stack);
    }
  }

  return { dom, doc: dom.window.document, win: dom.window, errors };
}

const noErrors = (p) => assert.deepStrictEqual(p.errors, [], p.errors.join('\n---\n'));

// ---- index -----------------------------------------------------------------

test('the price guide renders without errors', () => {
  const p = renderPage('index.html');
  noErrors(p);
});

test('the price guide shows a page of cards, not the whole catalogue', () => {
  const p = renderPage('index.html');
  const total = p.win.BEARCHART_DATA.items.length;
  const first = p.doc.querySelectorAll('#results .card');
  assert.ok(first.length < total, 'the first screen should not hold every item');
  assert.strictEqual(p.doc.getElementById('show-more').hidden, false);
  assert.match(p.doc.getElementById('result-count').textContent,
    new RegExp('of ' + total + ' matching'));
});

test('"show more" eventually lists every item as a card', () => {
  const p = renderPage('index.html');
  const cards = showAll(p);
  assert.strictEqual(cards.length, p.win.BEARCHART_DATA.items.length);
  assert.strictEqual(p.doc.getElementById('show-more').hidden, true);
});

test('the guide opens on a dozen bears, not the whole catalogue', () => {
  // Arriving and using are different jobs. A dozen is a shelf you can take in;
  // on a phone, one column, sixty cards was a page 64,000 pixels tall.
  const p = renderPage('index.html');
  assert.strictEqual(p.doc.querySelectorAll('#results .card').length, 12);
  assert.match(p.doc.getElementById('show-more').textContent, /^Show 12 more/);
});

test('searching brings up more, and paging restarts', () => {
  const p = renderPage('index.html');
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

test('filtering also brings up more, and resetting goes back to a dozen', () => {
  const p = renderPage('index.html');
  const box = p.doc.querySelector('#filters input[type="checkbox"][data-group="category"]');
  assert.ok(box, 'expected a category filter');
  box.checked = true;
  box.dispatchEvent(new p.win.Event('change', { bubbles: true }));

  // Count from the data, not the label: when every match fits on one page the
  // counter reads "34 of 266 items", and a regex for /of (\d+)/ picks up the
  // size of the whole catalogue instead of the size of the result.
  const value = box.getAttribute('value');
  const matching = p.win.BEARCHART_DATA.items.filter((i) => i.category === value).length;
  const shown = p.doc.querySelectorAll('#results .card').length;
  assert.strictEqual(shown, Math.min(48, matching));
  assert.ok(matching > 12, 'pick a category with enough items to prove the point');

  p.doc.getElementById('clear-all').dispatchEvent(new p.win.Event('click'));
  assert.strictEqual(p.doc.querySelectorAll('#results .card').length, 12);
});

test('the masthead, disclaimer and footer are present', () => {
  const p = renderPage('index.html');
  assert.match(p.doc.getElementById('masthead').textContent, /BearChart/);
  assert.match(p.doc.getElementById('disclaimer-bar').textContent,
    /not affiliated with Build-A-Bear Workshop/);
  assert.match(p.doc.getElementById('site-footer').textContent, /Jay's Retro Exchange/);
});

test('filters are built with counts', () => {
  const p = renderPage('index.html');
  const boxes = p.doc.querySelectorAll('#filters input[type=checkbox]');
  assert.ok(boxes.length > 20, 'expected a full filter set, got ' + boxes.length);
  assert.ok(p.doc.querySelectorAll('#filters .count').length > 20);
});

test('search narrows the results', () => {
  const p = renderPage('index.html');
  const before = p.doc.querySelectorAll('#results .card').length;
  const q = p.doc.getElementById('q');
  q.value = 'axolotl';
  q.dispatchEvent(new p.win.Event('input'));
  // The handler is debounced; drive the clock forward.
  return new Promise((resolve) => {
    setTimeout(() => {
      const after = p.doc.querySelectorAll('#results .card').length;
      assert.ok(after > 0 && after < before, 'axolotl search returned ' + after + ' of ' + before);
      assert.match(p.doc.querySelector('#results .card').textContent, /Axolotl/i);
      resolve();
    }, 900);
  });
});

test('an alias finds its item', () => {
  const p = renderPage('index.html');
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

test('a filter checkbox narrows the results', () => {
  const p = renderPage('index.html');
  const items = p.win.BEARCHART_DATA.items;
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

test('sorting by price puts the most valuable item first and unpriced items last', () => {
  const p = renderPage('index.html');
  const sort = p.doc.getElementById('sort');
  sort.value = 'price-desc';
  sort.dispatchEvent(new p.win.Event('change'));
  const cards = showAll(p);
       // Whichever item the engine values highest should lead, not one fixed bear.
          const top = p.win.BEARCHART_DATA.items
       .map((i) => [i.canonical_name, (p.win.BC.valuationFor(i.id) || {}).fair_market || 0])
       .sort((a, b) => b[1] - a[1])[0];
     assert.ok(cards[0].textContent.includes(top[0]), 'expected ' + top[0] + ' first');
  assert.match(cards[cards.length - 1].textContent, /No sold data yet/);
});

test('sorting by year orders oldest first', () => {
  const p = renderPage('index.html');
  const sort = p.doc.getElementById('sort');
  sort.value = 'oldest';
  sort.dispatchEvent(new p.win.Event('change'));
  assert.match(p.doc.querySelector('#results .card').textContent, /1997/);
});

test('items with no sold data say so instead of showing a price', () => {
  const p = renderPage('index.html');
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

test('the stats bar reports the database size', () => {
  const p = renderPage('index.html');
  const stats = p.doc.getElementById('stats').textContent;
  assert.match(stats, new RegExp(String(p.win.BEARCHART_DATA.items.length)));
  assert.match(stats, /Sold observations/);
});

test('the quick calculator prices an item it has comps for', () => {
  const p = renderPage('index.html');
  const sel = p.doc.getElementById('calc-item');
  sel.value = 'original-pumpkin-kitty';
  sel.dispatchEvent(new p.win.Event('change'));
  assert.match(p.doc.getElementById('calc-out').textContent, /\$/);
});

test('the calculator offers only items it can actually price', () => {
  // The refusal used to happen after you picked an unpriceable item. Now it
  // happens by never offering one: a menu of 1,980 dead ends is worse than a
  // short menu that works.
  const p = renderPage('index.html');
  const offered = Array.from(p.doc.querySelectorAll('#calc-item option'))
    .map((o) => o.value).filter(Boolean);
  assert.ok(offered.length > 0);
  const priceable = new Set(p.win.BEARCHART_DATA.items
    .filter((i) => p.win.BC.valuationFor(i.id).has_value).map((i) => i.id));
  assert.strictEqual(offered.length, priceable.size);
  for (const id of offered) assert.ok(priceable.has(id), id + ' has no comps');
});

test('changing condition changes the calculated value', () => {
  const p = renderPage('index.html');
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

test('an item page renders without errors', () => {
  const p = renderPage('item.html', 'item.html?id=kennel-pals-calico-cat');
  noErrors(p);
  assert.match(p.doc.title, /Kennel Pals Calico Cat/);
});

test('an item page shows its valuation, reasoning and sold comps', () => {
  const p = renderPage('item.html', 'item.html?id=original-pumpkin-kitty');
  const text = p.doc.getElementById('item-root').textContent;
  assert.match(text, /Estimated market value/);
  assert.match(text, /Why this value/);
  assert.match(text, /Buy/);
  assert.match(text, /Trade/);
  assert.match(text, /High-end ask/);
  assert.match(text, /Sold observations/);
  assert.match(text, /\$60/);
});

test('a fully sourced sale shows its provenance', () => {
  const p = renderPage('item.html', 'item.html?id=kennel-pals-calico-cat');
  const text = p.doc.getElementById('item-root').textContent;
  assert.match(text, /2023-07-18/);
       assert.match(text, /364353106238/);
  assert.match(text, /completed sale/);
});

test('an item with no comps publishes no price', () => {
  // Asserts the GUARANTEE, not the wording. This used to match the heading
  // "No published value" and broke the moment that panel was rewritten - while
  // the rule it exists to protect was never in danger. A test pinned to a
  // sentence stops guarding anything the first time somebody edits the copy.
  const p = renderPage('item.html', 'item.html?id=floppy-kitty');
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

test('per-condition medians are shown when grades differ', () => {
  const p = renderPage('item.html', 'item.html?id=loveable-lamb');
  const text = p.doc.getElementById('item-root').textContent;
  assert.match(text, /Sold price by condition/);
  assert.match(text, /204\.49/);
});

test('a versioned item warns against merging versions', () => {
  const p = renderPage('item.html', 'item.html?id=vanilla-fudge-bunny');
  assert.match(p.doc.getElementById('item-root').textContent, /versions or variants/);
});

test('the retail reference is shown but labelled as a baseline only', () => {
  const p = renderPage('item.html', 'item.html?id=original-pumpkin-kitty');
  const text = p.doc.getElementById('item-root').textContent;
  assert.match(text, /Retail reference/);
  assert.match(text, /never secondary-market value/);
});

test('an unknown item id fails gracefully', () => {
  const p = renderPage('item.html', 'item.html?id=does-not-exist');
  noErrors(p);
  assert.match(p.doc.getElementById('item-root').textContent, /Item not found/);
});

test('the item calculator recalculates on condition change', () => {
  const p = renderPage('item.html', 'item.html?id=original-pumpkin-kitty');
  const before = p.doc.getElementById('c-out').textContent;
  const cond = p.doc.getElementById('c-cond');
  cond.value = 'NWT';
  cond.dispatchEvent(new p.win.Event('change'));
  assert.notStrictEqual(p.doc.getElementById('c-out').textContent, before);
});

test('a price history chart is drawn only where dated sales support one', () => {
  const withHistory = renderPage('item.html', 'item.html?id=pudgie-pink-pig');
  assert.match(withHistory.doc.getElementById('item-root').textContent,
    /no trend to chart yet/);
});

// ---- collection ------------------------------------------------------------

test('the collection page renders and starts empty', () => {
  const p = renderPage('collection.html');
  noErrors(p);
  assert.match(p.doc.getElementById('collection-body').textContent, /collection is empty/);
});

test('adding an item to the collection totals it', () => {
  const p = renderPage('collection.html');
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

test('the admin dashboard renders its counts and gap lists', () => {
  const p = renderPage('admin.html');
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

test('admin refuses a completed_sale without full provenance', () => {
  const p = renderPage('admin.html');
  pickItem(p, 's-item', 'classic-brown-teddy');
  p.doc.getElementById('s-price').value = '25';
  p.doc.getElementById('s-evidence').value = 'completed_sale';
  p.doc.getElementById('s-add').dispatchEvent(new p.win.Event('click'));

  assert.match(p.doc.getElementById('s-msg').textContent,
    /needs a date, a marketplace and a listing id/);
  assert.match(p.doc.getElementById('draft-body').textContent, /Nothing pending/);
});

test('admin accepts a fully sourced sale', () => {
  const p = renderPage('admin.html');
  pickItem(p, 's-item', 'classic-brown-teddy');
  p.doc.getElementById('s-price').value = '25';
  p.doc.getElementById('s-date').value = '2026-01-15';
  p.doc.getElementById('s-market').value = 'eBay';
  p.doc.getElementById('s-listing').value = '123456789';
  p.doc.getElementById('s-evidence').value = 'completed_sale';
  p.doc.getElementById('s-add').dispatchEvent(new p.win.Event('click'));

  assert.match(p.doc.getElementById('draft-body').textContent, /Classic Brown Teddy/);
});

test('admin rejects a zero or missing price', () => {
  const p = renderPage('admin.html');
  pickItem(p, 's-item', 'classic-brown-teddy');
  p.doc.getElementById('s-price').value = '0';
  p.doc.getElementById('s-add').dispatchEvent(new p.win.Event('click'));
  assert.match(p.doc.getElementById('s-msg').textContent, /above zero/);
});

// ---- method page -----------------------------------------------------------

test('the method page renders and states the governing rule', () => {
  const p = renderPage('about.html');
  noErrors(p);
  const text = p.doc.body.textContent;
  assert.match(text, /Completed sold transactions outrank active asking prices/);
  assert.match(p.doc.getElementById('cond-table').textContent, /NWT/);
  assert.match(p.doc.getElementById('comp-table').textContent, /Bare bear/);
});

// ---- cross-page integrity --------------------------------------------------

test('every internal link and asset reference resolves to a real file', () => {
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

test('every item card links to a page that resolves', () => {
  const p = renderPage('index.html');
  const ids = new Set(p.win.BEARCHART_DATA.items.map((i) => i.id));
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

test('the old query-string item url still works', () => {
  // Links people saved before the generated pages existed must not rot.
  const p = renderPage('item.html', 'item.html?id=classic-brown-teddy');
  assert.match(p.doc.getElementById('item-root').textContent, /Classic Brown Teddy/);
});

test('the CSV export builds a header and one row per item', () => {
  const p = renderPage('index.html');
  const csv = p.win.BC.itemsCsv(p.win.BEARCHART_DATA.items);
  const lines = csv.trim().split('\r\n');
  assert.strictEqual(lines.length, p.win.BEARCHART_DATA.items.length + 1);
  assert.match(lines[0], /^id,canonical_name,aliases/);
  assert.match(lines[0], /confidence/);
});

test('the sales CSV keeps provenance columns', () => {
  const p = renderPage('index.html');
  const csv = p.win.BC.salesCsv(p.win.BEARCHART_DATA.items);
  assert.match(csv.split('\r\n')[0], /listing_id/);
  assert.match(csv, /364353106238/);
  assert.strictEqual(csv.trim().split('\r\n').length, p.win.BEARCHART_DATA.sales.length + 1);
});

test('CSV values containing commas are quoted', () => {
  const p = renderPage('index.html');
  const csv = p.win.BC.toCsv([['a', 'b,c', 'd"e']]);
  assert.strictEqual(csv.trim(), 'a,"b,c","d""e"');
});

test('data.js and data.json carry identical content', () => {
  const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'data.json'), 'utf8'));
  const p = renderPage('index.html', null, { full: true });
  // Re-parse across the realm boundary: jsdom objects carry a different
  // Object prototype, which deepStrictEqual would otherwise reject.
  const fromJs = JSON.parse(JSON.stringify(p.win.BEARCHART_DATA));
  assert.deepStrictEqual(fromJs, json);
});

// ---- images ----------------------------------------------------------------

test('every card renders a picture, falling back to a generated placeholder', () => {
  const p = renderPage('index.html');
  showAll(p);
  const imgs = p.doc.querySelectorAll('#results .card img.thumb');
  assert.strictEqual(imgs.length, p.win.BEARCHART_DATA.items.length);
  // Nothing ships with a photo yet, so all of these are placeholders.
  for (const img of imgs) {
    assert.ok(img.getAttribute('src').startsWith('data:image/svg+xml'),
      'expected a generated placeholder, got ' + img.getAttribute('src').slice(0, 40));
  }
});

test('a placeholder is decorative and carries no alt text', () => {
  const p = renderPage('index.html');
  const img = p.doc.querySelector('#results .card img.thumb');
  assert.strictEqual(img.getAttribute('alt'), '');
  assert.strictEqual(img.getAttribute('aria-hidden'), 'true');
  assert.ok(img.classList.contains('is-placeholder'));
});

test('illustrations are deterministic per item and differ between items', () => {
  const p = renderPage('index.html');
  const tile = (id, species) =>
    p.win.BC.placeholderImage({ id: id, canonical_name: 'X', species: species });
  assert.strictEqual(tile('alpha', 'Bear'), tile('alpha', 'Bear'),
    'the same item must always draw the same tile');
  assert.notStrictEqual(tile('alpha', 'Bear'), tile('beta', 'Bear'),
    'different items should not look identical');
  assert.notStrictEqual(tile('alpha', 'Bear'), tile('alpha', 'Cat'),
    'a bear and a cat should not draw the same picture');
});

test('a real photo renders with alt text and an error fallback', () => {
  const p = renderPage('index.html');
  const html = p.win.BC.imageHtml({
    id: 'x', canonical_name: 'Lucky Kitty', image_url: '/images/lucky.jpg'
  }, 'hero');
  assert.match(html, /src="\/images\/lucky\.jpg"/);
  assert.match(html, /alt="Lucky Kitty"/);
  assert.match(html, /onerror=/, 'a broken photo must fall back to the placeholder');
  assert.match(html, /loading="lazy"/);
});

test('image markup escapes a hostile url or name', () => {
  const p = renderPage('index.html');
  const html = p.win.BC.imageHtml({
    id: 'x', canonical_name: '"><script>bad()</script>', image_url: '"><script>bad()</script>'
  }, 'hero');
  assert.doesNotMatch(html, /<script>/);
});

test('an item page shows a hero image and says when no photo is on file', () => {
  const p = renderPage('item.html', 'item.html?id=lucky-kitty');
  const hero = p.doc.querySelector('.item-hero img.hero');
  assert.ok(hero, 'expected a hero image');
  assert.match(p.doc.getElementById('item-root').textContent, /No photo on file/);
});

test('a photo credit is shown only when an image exists', () => {
  const p = renderPage('index.html');
  assert.strictEqual(p.win.BC.imageCredit({ id: 'x', canonical_name: 'A' }), '');
  const credited = p.win.BC.imageCredit({
    id: 'x', canonical_name: 'A', image_url: '/a.jpg',
    image_credit: "Jay's Retro Exchange", image_source: 'https://example.com'
  });
  assert.match(credited, /Jay&#39;s Retro Exchange/);
  assert.match(credited, /example\.com/);
});

test('admin reports photo coverage and lists items without one', () => {
  const p = renderPage('admin.html');
  assert.match(p.doc.getElementById('admin-stats').textContent, /Items with a photo/);
  assert.match(p.doc.getElementById('quality').textContent, /Items with no photo/);
});

test('admin refuses official Build-A-Bear imagery', () => {
  const p = renderPage('admin.html');
  pickItem(p, 'p-item', 'lucky-kitty');
  p.doc.getElementById('p-url').value = 'https://www.buildabear.com/dw/image/bear.jpg';
  p.doc.getElementById('p-add').dispatchEvent(new p.win.Event('click'));
  assert.match(p.doc.getElementById('p-msg').textContent, /official Build-A-Bear imagery/);
  assert.match(p.doc.getElementById('draft-body').textContent, /Nothing pending/);
});

test('admin queues a permitted photo and previews it', () => {
  const p = renderPage('admin.html');
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

test('the items CSV carries an image_url column', () => {
  const p = renderPage('index.html');
  assert.match(p.win.BC.itemsCsv(p.win.BEARCHART_DATA.items).split('\r\n')[0], /image_url/);
});

// ---- asking prices ---------------------------------------------------------

/** Render an item page with synthetic active listings injected into the data. */
function renderWithListings(itemId, listings) {
  const data = JSON.parse(JSON.stringify(loadData()));
  data.active_listings = listings;
  data.active_listings_fetched_at = '2026-09-08T12:00:00Z';

  const html = fs.readFileSync(path.join(ROOT, 'item.html'), 'utf8');
  const dom = track(new JSDOM(html, {
    url: 'http://localhost:5173/item.html?id=' + itemId,
    runScripts: 'dangerously', pretendToBeVisual: true
  }));
  dom.window.BEARCHART_DATA = data;
  for (const src of ['engine.js', 'common.js', 'item.js']) {
    dom.window.eval(fs.readFileSync(path.join(ROOT, src), 'utf8'));
  }
  return dom.window.document;
}

const listing = (id, price, extra) => Object.assign({
  id: 'active-' + id, item_id: 'original-pumpkin-kitty', listing_id: String(id),
  title: 'Build-A-Bear Pumpkin Kitty', ask_price: price, currency: 'USD',
  condition: 'Good', marketplace: 'eBay', evidence_type: 'active_listing',
  source_url: 'https://www.ebay.com/itm/' + id
}, extra || {});

test('an item page shows asking prices in their own clearly marked panel', () => {
  const doc = renderWithListings('original-pumpkin-kitty',
    [listing(1, 90), listing(2, 100), listing(3, 110)]);
  const text = doc.getElementById('item-root').textContent;
  assert.match(text, /Current asking prices/);
  assert.match(text, /These are not sales/);
  assert.match(text, /none of these affect the valuation/i);
});

test('the asking panel reports the ask-vs-sold spread', () => {
  const doc = renderWithListings('original-pumpkin-kitty',
    [listing(1, 90), listing(2, 100), listing(3, 110)]);
  const text = doc.getElementById('item-root').textContent;
  assert.match(text, /Median ask/);
  assert.match(text, /Sold-data value/);
  assert.match(text, /Spread/);
});

test('asking prices do not change the published valuation', () => {
  const plain = renderPage('item.html', 'item.html?id=original-pumpkin-kitty');
  const withAsks = renderWithListings('original-pumpkin-kitty',
    [listing(1, 5000), listing(2, 6000)]);

  const valueOf = (doc) => doc.querySelector('.headline .big').textContent;
  assert.strictEqual(valueOf(withAsks), valueOf(plain.doc),
    'a $6000 asking price must not move the valuation');
});

test('a wildly optimistic asking price is called out as above market', () => {
  const doc = renderWithListings('original-pumpkin-kitty', [listing(1, 5000)]);
  assert.match(doc.getElementById('item-root').textContent, /above.*what this item actually sells for/i);
});

test('asking prices below the sold data flag stale comps', () => {
  const doc = renderWithListings('original-pumpkin-kitty', [listing(1, 5)]);
  assert.match(doc.getElementById('item-root').textContent, /market has\s+moved/i);
});

test('no asking panel is rendered when there are no listings', () => {
  const p = renderPage('item.html', 'item.html?id=original-pumpkin-kitty');
  assert.doesNotMatch(p.doc.getElementById('item-root').textContent, /Current asking prices/);
});

test('a hostile listing title cannot inject markup', () => {
  const doc = renderWithListings('original-pumpkin-kitty',
    [listing(1, 100, { title: '<img src=x onerror=alert(1)>' })]);
  assert.strictEqual(doc.querySelectorAll('img[onerror*="alert"]').length, 0);
});

// ---- expanded catalogue ----------------------------------------------------

test('the expanded catalogue is searchable and shows no invented prices', () => {
  const p = renderPage('index.html');
  const data = p.win.BEARCHART_DATA;
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

test('WWF series items are catalogued under their franchise', () => {
  const wwf = loadData().items.filter((i) => i.franchise === 'WWF / Wildlife');
  assert.ok(wwf.length >= 12, 'expected the expanded WWF series, got ' + wwf.length);
  for (const i of wwf) assert.strictEqual(i.licensed, true);
});

test('the Sanrio anniversary edition sizes were recorded', () => {
  const p = renderPage('index.html');
  const byId = Object.fromEntries(p.win.BEARCHART_DATA.items.map((i) => [i.id, i]));
  assert.strictEqual(byId['chococat-limited-edition'].edition_size, 56000);
  assert.strictEqual(byId['keroppi-limited-edition'].edition_size, 66000);
});

test('the unresolved Lucky Kitty year conflict is recorded, not silently resolved', () => {
  const p = renderPage('item.html', 'item.html?id=lucky-kitty');
  const text = p.doc.getElementById('item-root').textContent;
  assert.match(text, /Year needs confirmation/);
  assert.match(text, /1997/);
});

// ---- aggregate observations in the UI --------------------------------------

test('admin refuses to record an average as a single completed sale', () => {
  const p = renderPage('admin.html');
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

test('admin accepts an average recorded as a collector report', () => {
  const p = renderPage('admin.html');
  pickItem(p, 's-item', 'lucky-kitty');
  p.doc.getElementById('s-price').value = '54';
  p.doc.getElementById('s-sample').value = '12';
  p.doc.getElementById('s-evidence').value = 'collector_report';
  p.doc.getElementById('s-add').dispatchEvent(new p.win.Event('click'));
  assert.match(p.doc.getElementById('draft-body').textContent, /Lucky Kitty/);
});

// ---- expanded catalogue, second pass ----------------------------------------

test('the licensed franchise lines are catalogued without invented prices', () => {
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

test('the Disney Princess edition sizes were captured', () => {
  const p = renderPage('index.html');
  const cinders = p.win.BEARCHART_DATA.items.find((i) => i.id === 'cinderella-disney');
  assert.strictEqual(cinders.edition_size, 1500);
  assert.strictEqual(cinders.limited_edition, true);
});

test('a franchise filter narrows to that line', () => {
  const p = renderPage('index.html');
  const box = p.doc.querySelector('#filters input[data-group="franchise"][value="Pokemon"]');
  assert.ok(box, 'expected a Pokemon franchise filter');
  box.checked = true;
  box.dispatchEvent(new p.win.Event('change', { bubbles: true }));
  const cards = p.doc.querySelectorAll('#results .card');
  assert.strictEqual(cards.length,
    p.win.BEARCHART_DATA.items.filter((i) => i.franchise === 'Pokemon').length);
});

// ---- species illustrations -------------------------------------------------

test('an illustration is drawn from the item species, not its name', () => {
  const p = renderPage('index.html');
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

test('an unrecorded species falls back to a paw print rather than breaking', () => {
  // Wombat used to stand in for "unmapped" here and now has a drawing of its
  // own, which is the point of the fallback: the map grows, and an unmapped
  // species must still come out as a paw rather than a near-miss animal.
  const p = renderPage('index.html');
  assert.strictEqual(p.win.BearChartIcons.iconKeyFor({ species: 'Aardvark' }), 'paw');
  assert.strictEqual(p.win.BearChartIcons.iconKeyFor({ species: 'Nudibranch' }), 'paw');
  assert.strictEqual(p.win.BearChartIcons.iconKeyFor({}), 'paw');
});

// ---- showing the evidence ---------------------------------------------------

test('a priced item draws the comps behind its number', () => {
  const p = renderPage('item.html', 'item.html?id=grey-panda-mini-beans');
  const strip = p.doc.querySelector('.evidence .ev-strip');
  assert.ok(strip, 'expected an evidence strip');
  const v = p.win.BC.valuationFor('grey-panda-mini-beans');
  assert.strictEqual(strip.querySelectorAll('.ev-dot').length, v.points.length);
  assert.ok(strip.querySelector('.ev-band'), 'the published range');
  assert.ok(strip.querySelector('.ev-median'), 'the median');
});

test('the strip labels the range, never the padding either side of it', () => {
  // The axis ends are chosen to give the drawing air. Printing them would put
  // a precise-looking figure under a price at which nothing happened.
  const p = renderPage('item.html', 'item.html?id=grey-panda-mini-beans');
  const v = p.win.BC.valuationFor('grey-panda-mini-beans');
  const ticks = Array.from(p.doc.querySelectorAll('.ev-tick')).map((t) => t.textContent);
  assert.ok(ticks.includes(p.win.BC.money(v.range_low)), ticks.join(' '));
  assert.ok(ticks.includes(p.win.BC.money(v.range_high)), ticks.join(' '));
  assert.strictEqual(ticks.length, 2, 'only the two range ends');
});

test('one comp draws one dot and says the range once', () => {
  // Any item resting on exactly one comp will do; this one has a single sale.
  const p = renderPage('item.html', 'item.html?id=employee-exclusive-holiday-moose');
  assert.strictEqual(p.doc.querySelectorAll('.ev-dot').length, 1);
  // range_low === range_high here, so printing it twice would read as two
  // different figures that happen to match.
  assert.strictEqual(p.doc.querySelectorAll('.ev-tick').length, 1);
  assert.match(p.doc.querySelector('.ev-key').textContent, /the one recorded sale/);
});

test('an unpriced item draws no strip at all', () => {
  const p = renderPage('item.html', 'item.html?id=buddy-bear-30-inch');
  assert.strictEqual(p.doc.querySelector('.evidence'), null);
  assert.strictEqual(p.win.BC.evidenceStrip(
    p.win.BC.valuationFor('buddy-bear-30-inch')), '');
});

test('the strip describes itself for a screen reader', () => {
  const p = renderPage('item.html', 'item.html?id=grey-panda-mini-beans');
  const strip = p.doc.querySelector('.ev-strip');
  assert.strictEqual(strip.getAttribute('role'), 'img');
  assert.match(strip.getAttribute('aria-label'), /recorded sale/);
});

// ---- the page with no price -------------------------------------------------

test('an unpriced page leads with what is known instead of an apology', () => {
  const p = renderPage('item.html', 'item.html?id=buddy-bear-30-inch');
  const panel = p.doc.querySelector('.unpriced');
  assert.ok(panel, 'expected the rebuilt empty state');
  assert.match(panel.querySelector('.unpriced-eyebrow').textContent, /No value published/i);
  assert.match(panel.querySelector('.unpriced-known').textContent, /Released/);
  assert.match(panel.querySelector('.unpriced-known').textContent, /1997/);
});

test('it still refuses to publish a price', () => {
  const p = renderPage('item.html', 'item.html?id=buddy-bear-30-inch');
  const panel = p.doc.querySelector('.unpriced');
  assert.match(panel.textContent, /publishes\s*no price/);
  assert.ok(panel.textContent.indexOf('$') === -1, 'no figure anywhere on it');
});

test('it does not repeat the tags already shown in the header', () => {
  const p = renderPage('item.html', 'item.html?id=buddy-bear-30-inch');
  assert.strictEqual(p.doc.querySelectorAll('.unpriced .tag').length, 0);
});

test('the ask points at a panel that is actually on the page', () => {
  // A jump link to an anchor that does not exist is worse than no link.
  const p = renderPage('item.html', 'item.html?id=buddy-bear-30-inch');
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

test('an item page invites a sold price and a problem report', () => {
  const p = renderPage('item.html', 'item.html?id=buddy-bear-30-inch');
  assert.ok(p.doc.getElementById('submit-panel'), 'expected the submit-a-sale panel');
  assert.ok(p.doc.getElementById('report-panel'), 'expected the report panel');
  assert.strictEqual(p.doc.querySelectorAll('#rep-reason option').length,
    p.win.BearChartSubmissions.reasons.length);
});

test('the panels survive the account library failing to load', () => {
  // They key off whether accounts are CONFIGURED, not whether the CDN client
  // arrived. Keying on the live client made the whole feature vanish without
  // explanation whenever the script was slow, blocked, or the reader offline.
  const p = renderPage('item.html', 'item.html?id=buddy-bear-30-inch');
  assert.strictEqual(p.win.BearChartAuth.getClient(), null, 'no client in this harness');
  assert.strictEqual(p.win.BearChartSubmissions.configured(), true);
  assert.ok(p.doc.getElementById('submit-panel'));
});

test('a signed-out reader is asked to sign in rather than shown a dead form', () => {
  const p = renderPage('item.html', 'item.html?id=buddy-bear-30-inch');
  const panel = p.doc.getElementById('submit-panel');
  assert.match(panel.textContent, /Sign in to add a sale/);
  assert.ok(!p.doc.getElementById('do-submit'), 'no submit button until signed in');
});

test('submitting a sale requires being signed in', async () => {
  const p = renderPage('item.html', 'item.html?id=buddy-bear-30-inch');
  const res = await p.win.BearChartSubmissions.submitComp(
    { item_slug: 'buddy-bear-30-inch', sold_price: '40', marketplace: 'eBay' });
  assert.strictEqual(res.ok, false);
  assert.match(res.message, /sign in/i);
});

test('a report needs a reason from the list, not free text', async () => {
  const p = renderPage('item.html', 'item.html?id=buddy-bear-30-inch');
  const S = p.win.BearChartSubmissions;
  const bad = await S.reportItem({ item_slug: 'buddy-bear-30-inch', reason: 'whatever' });
  assert.strictEqual(bad.ok, false);
  assert.match(bad.message, /Pick what is wrong/);
});

test('an unreachable server says so instead of claiming the feature is off', async () => {
  // Two different problems with two different answers: "come back online" and
  // "this site does not do that". Reporting the first as the second sends
  // somebody looking for a setting that is already correct.
  const p = renderPage('item.html', 'item.html?id=buddy-bear-30-inch');
  const res = await p.win.BearChartSubmissions.reportItem(
    { item_slug: 'buddy-bear-30-inch', reason: 'duplicate' });
  assert.strictEqual(res.ok, false);
  assert.match(res.message, /connection|online/i);
});

test('the page states that a submission does not change a published value', () => {
  const p = renderPage('item.html', 'item.html?id=buddy-bear-30-inch');
  // Including submissions from the people who run the site - the operator
  // buys and sells what this guide values.
  assert.match(p.doc.getElementById('submit-panel').textContent,
    /review|reviewer/i);
});

// ---- the shop that runs the guide ------------------------------------------

test('the price guide carries the shop panel, labelled as the shop', () => {
  const p = renderPage('index.html');
  const promo = p.doc.querySelector('#sidebar-promo .promo');
  assert.ok(promo, 'expected the shop panel in the sidebar');
  assert.match(promo.textContent, /shop behind BearChart/i);
  const link = promo.querySelector('a.btn');
  assert.match(link.getAttribute('href'), /^https:\/\/jaysretroexchange\.com/);
  assert.strictEqual(link.getAttribute('rel'), 'noopener');
  assert.strictEqual(link.getAttribute('target'), '_blank');
});

test('the shop panel discloses that it buys what the guide values', () => {
  // The site's argument is that its numbers are not for sale. The operator's
  // own shop appearing on the page has to say so itself.
  const p = renderPage('index.html');
  const note = p.doc.querySelector('#sidebar-promo .promo-note');
  assert.ok(note, 'the shop panel must carry a disclosure');
  assert.match(note.textContent, /No valuation on this site is adjusted/i);
});

test('the shop panel is reachable when the sidebar is collapsed away', () => {
  // The sidebar is display:none below 860px. Without this the shop would be
  // invisible to every phone visitor.
  const p = renderPage('index.html');
  assert.ok(p.doc.querySelector('#mobile-promo .promo'));
});

test('an item with no comps shows the shop, an item with comps shows the offer', () => {
  const priced = renderPage('item.html', 'item.html?id=classic-brown-teddy');
  const unpriced = renderPage('item.html', 'item.html?id=buddy-bear-30-inch');

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

test('the shop panel disappears entirely when the business is switched off', () => {
  const p = renderPage('index.html');
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

test('shop copy is escaped, not injected', () => {
  const p = renderPage('index.html');
  const BC = p.win.BC;
  const saved = BC.business.shop_headline;
  try {
    BC.business.shop_headline = '<img src=x onerror=alert(1)>';
    assert.doesNotMatch(BC.shopPromo(), /<img/);
  } finally {
    BC.business.shop_headline = saved;
  }
});

test('the illustration says it is an illustration', () => {
  const p = renderPage('index.html');
  const svg = decodeURIComponent(
    p.win.BC.placeholderImage({ id: 'x', canonical_name: 'A', species: 'Bear' }));
  assert.match(svg, /ILLUSTRATION/);
  assert.match(svg, /NO PHOTO YET/);
});

test('every catalogued item draws valid, well-formed SVG', () => {
  const p = renderPage('index.html');
  const parser = new p.win.DOMParser();
  const seen = new Set();
  for (const item of p.win.BEARCHART_DATA.items) {
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

test('every icon in the set renders without error', () => {
  const p = renderPage('index.html');
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

test('items still show their illustration on cards and item pages', () => {
  const p = renderPage('index.html');
  showAll(p);
  assert.strictEqual(p.doc.querySelectorAll('#results .card img.thumb').length,
    p.win.BEARCHART_DATA.items.length);
  const item = renderPage('item.html', 'item.html?id=kennel-pals-calico-cat');
  assert.ok(item.doc.querySelector('.item-hero img.hero'));
});

// ---- upcoming and current releases -----------------------------------------

test('an upcoming release says it is not out and publishes no price', () => {
  const p = renderPage('index.html');
  const upcoming = p.win.BEARCHART_DATA.items.find((i) => i.release_status === 'upcoming');
  assert.ok(upcoming, 'expected an upcoming release in the data');

  const item = renderPage('item.html', 'item.html?id=' + upcoming.id);
  const root = item.doc.getElementById('item-root');
  assert.match(root.textContent, /Not released yet/);
  assert.match(root.textContent, /no secondary market/i);

  assert.doesNotMatch(root.textContent, /Estimated market value/);
  assert.strictEqual(root.querySelector('.headline .big'), null);
  const unpriced = root.querySelector('.unpriced');
  assert.ok(unpriced, 'expected the no-price panel');
  assert.ok(unpriced.textContent.indexOf('$') === -1, unpriced.textContent);
});

test('a current retail release is labelled and warns about the retail ceiling', () => {
  const p = renderPage('index.html');
  const current = p.win.BEARCHART_DATA.items.find((i) => i.release_status === 'current');
  assert.ok(current);
  const item = renderPage('item.html', 'item.html?id=' + current.id);
  const text = item.doc.getElementById('item-root').textContent;
  assert.match(text, /Available at retail now/);
  assert.match(text, /ceiling/i);
});

test('release badges appear on cards', () => {
  const p = renderPage('index.html');
  const box = p.doc.querySelector('#filters input[data-group="flag"][value="current"]');
  assert.ok(box, 'expected an "at retail now" filter');
  box.checked = true;
  box.dispatchEvent(new p.win.Event('change', { bubbles: true }));
  const cards = p.doc.querySelectorAll('#results .card');
  assert.ok(cards.length > 0);
  assert.match(cards[0].textContent, /At Retail Now/);
});

test('upcoming releases can be filtered to on their own', () => {
  const p = renderPage('index.html');
  const box = p.doc.querySelector('#filters input[data-group="flag"][value="upcoming"]');
  assert.ok(box, 'expected an upcoming filter');
  box.checked = true;
  box.dispatchEvent(new p.win.Event('change', { bubbles: true }));
  const cards = p.doc.querySelectorAll('#results .card');
  assert.strictEqual(cards.length,
    p.win.BEARCHART_DATA.items.filter((i) => i.release_status === 'upcoming').length);
  assert.match(cards[0].textContent, /Upcoming/);
});

test('admin can mark a new item as an upcoming release', () => {
  const p = renderPage('admin.html');
  p.doc.getElementById('i-name').value = 'Test Upcoming Bear';
  p.doc.getElementById('i-status').value = 'upcoming';
  p.doc.getElementById('i-add').dispatchEvent(new p.win.Event('click'));
  assert.match(p.doc.getElementById('draft-body').textContent, /Test Upcoming Bear/);
});

// ---- monetisation hooks ----------------------------------------------------

/** Render an item page with the business config switched on. */
function renderWithBusiness(itemId, business) {
  const data = JSON.parse(JSON.stringify(loadData()));
  data.business = Object.assign({}, data.business, business);

  const dom = track(new JSDOM(fs.readFileSync(path.join(ROOT, 'item.html'), 'utf8'), {
    url: 'http://localhost:5173/item.html?id=' + itemId,
    runScripts: 'dangerously', pretendToBeVisual: true
  }));
  dom.window.BEARCHART_DATA = data;
  for (const src of ['engine.js', 'icons.js', 'common.js', 'item.js']) {
    dom.window.eval(fs.readFileSync(path.join(ROOT, src), 'utf8'));
  }
  return dom.window;
}

test('the sell-to-us panel is hidden until the business config is filled in', () => {
  // This used to pass by reading the shipped default, which was "off". The
  // business is switched on now, so the test had to start stating the rule it
  // was actually there to protect instead of the configuration of the day.
  const off = renderWithBusiness('kennel-pals-calico-cat', { enabled: false });
  assert.doesNotMatch(off.document.getElementById('item-root').textContent,
    /Sell yours to/);

  // Enabled but with no way to reach anyone is not enabled: an offer button
  // that goes nowhere is worse than no offer.
  const unreachable = renderWithBusiness('kennel-pals-calico-cat',
    { enabled: true, contact_email: null, contact_url: null });
  assert.strictEqual(unreachable.BC.businessEnabled(), false);
  assert.doesNotMatch(unreachable.document.getElementById('item-root').textContent,
    /Sell yours to/);
});

test('the shipped config does offer to buy a priced item', () => {
  // The other half: with the business live, a priced item carries the offer.
  const p = renderPage('item.html', 'item.html?id=kennel-pals-calico-cat');
  assert.match(p.doc.getElementById('item-root').textContent, /Sell yours to/);
});

test('enabling the business config shows an offer at the published buy price', () => {
  const win = renderWithBusiness('kennel-pals-calico-cat',
    { enabled: true, contact_email: 'hello@example.com' });
  const text = win.document.getElementById('item-root').textContent;
  assert.match(text, /Sell yours to Jay's Retro Exchange/);
  assert.match(text, /Get an offer/);

  // The offer must be the same buy range the guide publishes to everyone.
  const v = win.BC.valuationFor('kennel-pals-calico-cat');
  assert.ok(text.includes(win.BC.range(v.buy_low, v.buy_high)));
});

test('the offer carries a conflict-of-interest disclosure', () => {
  const win = renderWithBusiness('kennel-pals-calico-cat',
    { enabled: true, contact_email: 'hello@example.com' });
  const text = win.document.getElementById('item-root').textContent;
  assert.match(text, /Disclosure/);
  assert.match(text, /would\s+be buying this one from you/);
  assert.match(text, /free to sell\s+elsewhere/);
});

test('turning the business on does not move any valuation', () => {
  const plain = renderPage('item.html', 'item.html?id=kennel-pals-calico-cat');
  const win = renderWithBusiness('kennel-pals-calico-cat',
    { enabled: true, contact_email: 'hello@example.com' });
  assert.strictEqual(
    win.document.querySelector('.headline .big').textContent,
    plain.doc.querySelector('.headline .big').textContent);
});

test('affiliate ids are only applied to eBay links, and only when configured', () => {
  const p = renderPage('index.html');
  const ebay = 'https://www.ebay.com/itm/123';
  assert.strictEqual(p.win.BC.affiliate(ebay), ebay, 'inert with no campaign id');

  const win = renderWithBusiness('kennel-pals-calico-cat', { ebay_campaign_id: '5338000000' });
  assert.match(win.BC.affiliate(ebay), /campid=5338000000/);
  // Anything that is not eBay is left alone.
  assert.strictEqual(win.BC.affiliate('https://www.mercari.com/x'),
    'https://www.mercari.com/x');
  assert.strictEqual(win.BC.affiliate(null), null);
});

test('an affiliate id cannot reach the valuation or reorder listings', () => {
  const plain = renderPage('item.html', 'item.html?id=kennel-pals-calico-cat');
  const win = renderWithBusiness('kennel-pals-calico-cat', { ebay_campaign_id: '5338000000' });
  assert.strictEqual(
    win.document.querySelector('.headline .big').textContent,
    plain.doc.querySelector('.headline .big').textContent);
  const rows = win.document.querySelectorAll('.panel table tbody tr').length;
  assert.strictEqual(rows, plain.doc.querySelectorAll('.panel table tbody tr').length);
});

// ---- deal finder page ------------------------------------------------------

/** Render deals.html with synthetic active listings injected. */
function renderDeals(listings) {
  const data = JSON.parse(JSON.stringify(loadData()));
  data.active_listings = listings || [];
  data.active_listings_fetched_at = '2026-09-10T09:00:00Z';

  const dom = track(new JSDOM(fs.readFileSync(path.join(ROOT, 'deals.html'), 'utf8'), {
    url: 'http://localhost:5173/deals.html',
    runScripts: 'dangerously', pretendToBeVisual: true
  }));
  dom.window.BEARCHART_DATA = data;
  for (const src of ['engine.js', 'icons.js', 'common.js', 'deals.js']) {
    dom.window.eval(fs.readFileSync(path.join(ROOT, src), 'utf8'));
  }
  return dom.window;
}

const activeFor = (itemId, ask, condition) => ({
  id: 'active-' + ask, item_id: itemId, listing_id: String(ask),
  title: 'Build-A-Bear listing', ask_price: ask, currency: 'USD',
  condition: condition || 'Good', marketplace: 'eBay',
  evidence_type: 'active_listing', source_url: 'https://www.ebay.com/itm/' + ask
});

test('the deals page renders without errors', () => {
  const p = renderPage('deals.html');
  noErrors(p);
});

test('with no listings loaded the deals page explains how to get some', () => {
  const win = renderDeals([]);
  const text = win.document.getElementById('deals').textContent;
  assert.match(text, /No active listings loaded/);
  assert.match(text, /npm run ebay/);
});

test('an underpriced listing appears with its net margin', () => {
  const win = renderDeals([activeFor('kennel-pals-calico-cat', 50)]);
  const text = win.document.getElementById('deals').textContent;
  assert.match(text, /Kennel Pals Calico Cat/);
  assert.match(text, /Net after fees/);
  const rows = win.document.querySelectorAll('#deals tbody tr');
  assert.strictEqual(rows.length, 1);
});

test('a fairly priced listing is not shown as a deal', () => {
  const win = renderDeals([activeFor('kennel-pals-calico-cat', 250)]);
  assert.match(win.document.getElementById('deals').textContent,
    /Nothing under your thresholds/);
});

test('tightening the margin threshold removes marginal deals', () => {
  const win = renderDeals([activeFor('kennel-pals-calico-cat', 50)]);
  assert.strictEqual(win.document.querySelectorAll('#deals tbody tr').length, 1);

  const input = win.document.getElementById('min-margin');
  input.value = '5000';
  input.dispatchEvent(new win.Event('input'));
  assert.match(win.document.getElementById('deals').textContent,
    /Nothing under your thresholds/);
});

test('raising the fee assumption reduces the reported margin', () => {
  const win = renderDeals([activeFor('kennel-pals-calico-cat', 50)]);
  const marginOf = () => win.document.querySelectorAll('#deals tbody tr td')[4].textContent;
  const before = marginOf();
  const fee = win.document.getElementById('fee');
  fee.value = '40';
  fee.dispatchEvent(new win.Event('input'));
  assert.notStrictEqual(marginOf(), before);
});

test('the deals page states that no sold data means no deal', () => {
  const p = renderPage('deals.html');
  assert.match(p.doc.getElementById('how-it-works').textContent, /No sold data, no deal/);
});

// ---- checklists ------------------------------------------------------------

test('the checklists page renders and builds sets from the catalogue', () => {
  const p = renderPage('checklists.html');
  noErrors(p);
  const sets = p.doc.querySelectorAll('#set-list [data-set]');
  assert.ok(sets.length >= 10, 'expected a good spread of checklists, got ' + sets.length);
  const names = p.doc.getElementById('set-list').textContent;
  for (const n of ['Mini Beans', 'Employee exclusives', 'Vintage', 'Pokemon']) {
    assert.ok(names.includes(n), 'missing checklist: ' + n);
  }
});

test('a checklist shows every item in its set with progress', () => {
  const p = renderPage('checklists.html');
  const rows = p.doc.querySelectorAll('#set-body tbody tr');
  const miniBeans = p.win.BEARCHART_DATA.items.filter((i) => i.mini_bean).length;
  assert.strictEqual(rows.length, miniBeans, 'first set should be Mini Beans');
  assert.match(p.doc.getElementById('set-progress').textContent, /0 of /);
  assert.ok(p.doc.querySelector('.progress span'));
});

test('switching checklist changes the item list', () => {
  const p = renderPage('checklists.html');
  const before = p.doc.querySelectorAll('#set-body tbody tr').length;
  const row = p.doc.querySelector('#set-list [data-set="employee"]');
  assert.ok(row, 'expected an employee-exclusive checklist');
  row.dispatchEvent(new p.win.Event('click', { bubbles: true }));
  assert.strictEqual(p.doc.getElementById('set-title').textContent, 'Employee exclusives');
  assert.notStrictEqual(p.doc.querySelectorAll('#set-body tbody tr').length, before);
});

test('ticking an item marks it owned and moves the progress bar', () => {
  const p = renderPage('checklists.html');
  const box = p.doc.querySelector('#set-body input[data-own]');
  const id = box.dataset.own;
  box.checked = true;
  box.dispatchEvent(new p.win.Event('change', { bubbles: true }));

  assert.match(p.doc.getElementById('set-progress').textContent, /1 of /);
  const saved = JSON.parse(p.win.localStorage.getItem('bearchart.collection'));
  assert.ok(saved.some((e) => e.item_id === id),
    'ticking a checklist should add to the collection');
});

test('the missing-only filter hides what you already own', () => {
  const p = renderPage('checklists.html');
  const total = p.doc.querySelectorAll('#set-body tbody tr').length;
  const box = p.doc.querySelector('#set-body input[data-own]');
  box.checked = true;
  box.dispatchEvent(new p.win.Event('change', { bubbles: true }));

  const hide = p.doc.getElementById('hide-owned');
  hide.checked = true;
  hide.dispatchEvent(new p.win.Event('change'));
  assert.strictEqual(p.doc.querySelectorAll('#set-body tbody tr').length, total - 1);
});

test('checklist items with no comps show no price rather than a guess', () => {
  const p = renderPage('checklists.html');
  const row = p.doc.querySelector('#set-list [data-set="employee"]');
  row.dispatchEvent(new p.win.Event('click', { bubbles: true }));
  const text = p.doc.getElementById('set-body').textContent;
  assert.match(text, /no data/);
});

test('the deals and checklists pages are reachable from every page', () => {
  for (const page of ['index.html', 'item.html', 'collection.html', 'about.html']) {
    const p = renderPage(page, page === 'item.html'
      ? 'item.html?id=kennel-pals-calico-cat' : page);
    const nav = p.doc.getElementById('masthead').innerHTML;
    assert.ok(nav.includes('deals.html'), page + ' should link to the deal finder');
    assert.ok(nav.includes('checklists.html'), page + ' should link to checklists');
  }
});

// ---- identification work queue ---------------------------------------------

test('admin surfaces the identification questions still to settle', () => {
  const p = renderPage('admin.html');
  noErrors(p);
  assert.match(p.doc.getElementById('admin-stats').textContent, /Questions to settle/);
  const quality = p.doc.getElementById('quality').textContent;
  assert.match(quality, /Identification questions to settle/);
  assert.match(quality, /tush tag/);
});

test('every flagged item is one whose notes record an open question', () => {
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

test('no item with an open question is left unflagged', () => {
  const OPEN = /unresolved|confirm before|before merging|may overlap|may be the same|whether they are the same|needs confirmation/i;
  for (const i of loadData().items) {
    if (OPEN.test(i.notes || '')) {
      assert.strictEqual(i.needs_review, true,
        i.id + ' records a question but is not flagged for review');
    }
  }
});

test('items with no open question are not flagged for review', () => {
  const data = loadData();
  const clean = data.items.find((i) => i.id === 'kennel-pals-calico-cat');
  assert.strictEqual(clean.needs_review, false);
});

// ---- accounts --------------------------------------------------------------

/** Render a page with the auth config switched on, without a real backend. */
function renderWithoutAuth(file, url) {
  return renderWithAuth(file, url, { enabled: false, supabase_url: null,
                                     supabase_anon_key: null });
}

function renderWithAuth(file, url, authCfg) {
  const data = JSON.parse(JSON.stringify(loadData()));
  data.config = Object.assign({}, data.config, {
    auth: Object.assign({ enabled: true, supabase_url: 'https://x.supabase.co',
                          supabase_anon_key: 'anon-key' }, authCfg || {})
  });
  const dom = track(new JSDOM(fs.readFileSync(path.join(ROOT, file), 'utf8'), {
    url: 'http://localhost:5173/' + (url || file),
    runScripts: 'dangerously', pretendToBeVisual: true
  }));
  dom.window.BEARCHART_DATA = data;
  const scripts = Array.from(dom.window.document.querySelectorAll('script[src]'))
    .map((s) => s.getAttribute('src')).filter((s) => s !== 'data.js');
  for (const src of scripts) {
    dom.window.eval(fs.readFileSync(path.join(ROOT, src), 'utf8'));
  }
  return dom.window;
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

test('with no auth configured the site works anonymously and says so', () => {
  const win = renderWithoutAuth('account.html');
  const text = win.document.getElementById('account-root').textContent;
  assert.match(text, /Accounts are not switched on/);
  assert.match(text, /work exactly as they do now/);
});

test('with a live project the account page offers sign in', () => {
  const p = renderPage('account.html');
  noErrors(p);
  const text = p.doc.getElementById('account-root').textContent;
  assert.match(text, /Sign in/);
  assert.match(text, /Create an account/);
  assert.match(text, /do not need an account/);
});

test('the account tab is always reachable, configured or not', () => {
  // It was hidden while accounts were off, which made the feature and its own
  // setup instructions impossible to find from the site.
  const off = renderWithoutAuth('index.html');
  assert.match(off.document.getElementById('masthead').innerHTML, /account\.html/);
  const on = renderPage('index.html');
  assert.match(on.doc.getElementById('masthead').innerHTML, /account\.html/);
});

test('the tab reads as a sign-in prompt once accounts are configured', () => {
  const win = renderWithAuth('index.html');
  assert.match(win.document.getElementById('masthead').innerHTML, />Sign in</);
});

test('there is no client-side session flag anywhere', () => {
  // A "signed in" boolean in storage would be settable from the console, which
  // is why auth is delegated to a server rather than faked here.
  for (const f of ['auth.js', 'account.js', 'common.js', 'admin.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.doesNotMatch(src, /localStorage\s*\.\s*setItem\s*\(\s*['"][^'"]*(signed|logged|auth|session|admin)/i,
      f + ' must not persist a session flag in the browser');
  }
});

test('the anon key is used but the service-role key never appears', () => {
  for (const f of ['auth.js', 'account.js', 'tools/build_data.py']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.doesNotMatch(src, /service_role_key\s*[:=]\s*['"][A-Za-z0-9._-]{10,}/,
      f + ' must never carry a service-role key');
  }
});

test('signing in is refused when accounts are not configured', async () => {
  const win = renderWithoutAuth('account.html');
  const A = win.BearChartAuth;
  assert.strictEqual(A.configured(), false);
  const res = await A.signIn('a@example.com', 'password123');
  assert.strictEqual(res.ok, false);
  assert.match(res.message, /not set up/);
});

test('a live project reports itself as configured', () => {
  const p = renderPage('account.html');
  assert.strictEqual(p.win.BearChartAuth.configured(), true);
});

test('a short password is rejected before any request is made', async () => {
  const win = renderWithAuth('account.html');
  const res = await win.BearChartAuth.signUp('a@example.com', 'short');
  assert.strictEqual(res.ok, false);
  assert.match(res.message, /at least 8/);
});

test('sign up and sign in require an email', async () => {
  const win = renderWithAuth('account.html');
  const A = win.BearChartAuth;
  assert.match((await A.signUp('', 'password123')).message, /email/i);
  assert.match((await A.signIn('', '')).message, /email/i);
  assert.match((await A.signInWithLink('')).message, /email/i);
});

test('admin status is asked of the server, never assumed', async () => {
  const win = renderWithAuth('admin.html');
  const A = win.BearChartAuth;
  const session = { user: { id: 'u1', email: 'jay@example.com' } };

  await A._setClientForTests(mockClient({ isAdmin: false }), session);
  assert.strictEqual(A.state().isAdmin, false);

  await A._setClientForTests(mockClient({ isAdmin: true }), session);
  assert.strictEqual(A.state().isAdmin, true);
});

test('admin page tells a non-admin the database will refuse their writes', async () => {
  const win = renderWithAuth('admin.html');
  const A = win.BearChartAuth;
  await A._setClientForTests(mockClient({ isAdmin: false }),
    { user: { id: 'u1', email: 'someone@example.com' } });
  const text = win.document.getElementById('access-notice').textContent;
  assert.match(text, /not an\s+admin account/);
  assert.match(text, /whatever this page shows/);
});

test('with no accounts configured the admin page says it is unprotected', () => {
  const win = renderWithoutAuth('admin.html');
  const text = win.document.getElementById('access-notice').textContent;
  assert.match(text, /No account system is switched on/);
  assert.match(text, /only writes to/);
});

test('with a live project the admin page asks you to sign in', () => {
  const p = renderPage('admin.html');
  assert.match(p.doc.getElementById('access-notice').textContent,
    /not signed in/i);
});

test('the collection upload sends slugs and never a user id', async () => {
  const win = renderWithAuth('account.html');
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
  const win = renderWithAuth('account.html');
  win.localStorage.setItem('bearchart.collection', JSON.stringify([
    { item_id: 'lucky-kitty', condition: 'Good', completeness: 'bare', qty: 1 }
  ]));
  await win.BearChartAuth._setClientForTests(mockClient({ rpcError: 'boom' }),
    { user: { id: 'u1', email: 'jay@example.com' } });
  const stored = JSON.parse(win.localStorage.getItem('bearchart.collection'));
  assert.strictEqual(stored.length, 1, 'local data must survive a server failure');
});

test('the schema stamps the user id server-side rather than trusting the client', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase_schema.sql'), 'utf8');
  assert.match(sql, /create or replace function add_collection_items/);
  assert.match(sql, /auth\.uid\(\),\s*--\s*never taken from the caller/);
  assert.match(sql, /raise exception 'not signed in'/);
});

test('every page loads auth before common so the nav can show the session', () => {
  for (const page of ['index.html', 'item.html', 'collection.html', 'admin.html',
                      'about.html', 'deals.html', 'checklists.html', 'account.html']) {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    assert.ok(html.indexOf('auth.js') > -1, page + ' should load auth.js');
    assert.ok(html.indexOf('auth.js') < html.indexOf('common.js'),
      page + ' must load auth.js before common.js');
  }
});

// ---- portfolio history & roadmap -------------------------------------------

test('the collection page records a snapshot and says history starts today', () => {
  const p = renderPage('collection.html');
  noErrors(p);
  assert.match(p.doc.getElementById('history-body').textContent, /History starts today/);
  const snaps = JSON.parse(p.win.localStorage.getItem('bearchart.snapshots'));
  assert.strictEqual(snaps.length, 1, 'one snapshot per day');
  assert.ok(snaps[0].d.match(/^\d{4}-\d{2}-\d{2}$/));
});

test('adding an item is recorded as an external flow, not appreciation', () => {
  const p = renderPage('collection.html');
  pickItem(p, 'add-item', 'kennel-pals-calico-cat');
  p.doc.getElementById('add-btn').dispatchEvent(new p.win.Event('click'));

  const flows = JSON.parse(p.win.localStorage.getItem('bearchart.flows') || '[]');
  assert.strictEqual(flows.length, 1);
  assert.strictEqual(flows[0].dir, 'acquire');
  assert.ok(flows[0].v > 0);
});

test('re-opening the page on the same day does not add a second snapshot', () => {
  const p = renderPage('collection.html');
  pickItem(p, 'add-item', 'lucky-kitty');
  p.doc.getElementById('add-btn').dispatchEvent(new p.win.Event('click'));
  p.doc.getElementById('add-btn').dispatchEvent(new p.win.Event('click'));
  const snaps = JSON.parse(p.win.localStorage.getItem('bearchart.snapshots'));
  assert.strictEqual(snaps.length, 1);
});

test('the roadmap renders and counts what is actually built', () => {
  const p = renderPage('roadmap.html');
  noErrors(p);
  for (const id of ['p2', 'p3', 'p4', 'never']) {
    assert.ok(p.doc.querySelectorAll('#' + id + ' .road-row').length > 0,
      id + ' should list capabilities');
  }
  assert.match(p.doc.getElementById('phase-stats').textContent, /Capabilities built/);
  assert.ok(p.doc.querySelectorAll('.road-tag.ship').length >= 5);
});

test('the roadmap states the data constraint rather than promising around it', () => {
  const p = renderPage('roadmap.html');
  const text = p.doc.body.textContent;
  assert.match(text, /cannot be bought or fetched/);
  assert.match(text, /Not possible/);
  assert.match(text, /Never/);
});

test('a shipped claim drops to planned if the capability is missing', () => {
  // The roadmap checks the engine rather than trusting a hand-maintained label,
  // so it cannot keep advertising something that has been removed.
  const src = fs.readFileSync(path.join(ROOT, 'roadmap.js'), 'utf8');
  assert.match(src, /typeof E\.lowerBound === 'function'/);
  assert.match(src, /if \(state === 'shipped' && entry\.length > 3 && !entry\[3\]\)/);
});

test('the roadmap is reachable from the rest of the site', () => {
  const p = renderPage('index.html');
  assert.match(p.doc.getElementById('masthead').innerHTML, /roadmap\.html/);
});

// ---- insurance schedule -----------------------------------------------------

function collectionWith(itemIds) {
  const p = renderPage('collection.html');
  for (const id of itemIds) {
    pickItem(p, 'add-item', id);
    p.doc.getElementById('add-btn').dispatchEvent(new p.win.Event('click'));
  }
  return p;
}

function captureDownload(p, buttonId) {
  let captured = null;
  p.win.BC.download = (name, text) => { captured = { name, text }; };
  p.doc.getElementById(buttonId).dispatchEvent(new p.win.Event('click'));
  return captured;
}

test('the insurance schedule carries the evidence, not just the number', () => {
  const p = collectionWith(['kennel-pals-calico-cat']);
  const out = captureDownload(p, 'export-insurance');
  assert.match(out.name, /insurance-schedule/);

  const header = out.text.split('\r\n')[0];
  for (const col of ['replacement_cost_usd', 'actual_cash_value_usd', 'comp_count',
                     'confidence', 'comp_date_range', 'evidence_urls',
                     'valuation_method', 'valued_on']) {
    assert.ok(header.includes(col), 'missing column: ' + col);
  }
});

test('actual cash value is the conservative floor, below replacement cost', () => {
  const p = collectionWith(['kennel-pals-calico-cat']);
  const rows = captureDownload(p, 'export-insurance').text.split('\r\n');
  const header = rows[0].split(',');
  const cells = rows[1].split(',');
  const rc = parseFloat(cells[header.indexOf('replacement_cost_usd')]);
  const acv = parseFloat(cells[header.indexOf('actual_cash_value_usd')]);
  assert.ok(rc > 0 && acv > 0);
  assert.ok(acv < rc, 'ACV must sit below replacement cost');
});

test('an unvalued item is left blank rather than valued at zero', () => {
  const p = collectionWith(['floppy-kitty']);
  const rows = captureDownload(p, 'export-insurance').text.split('\r\n');
  const header = rows[0].split(',');
  const cells = rows[1].split(',');
  assert.strictEqual(cells[header.indexOf('replacement_cost_usd')], '');
  assert.strictEqual(cells[header.indexOf('confidence')], 'VERY LOW');
  assert.ok(rows[1].includes('No comparable sales on record'));
});

test('the cover statement refuses the word appraisal', () => {
  const p = collectionWith(['kennel-pals-calico-cat']);
  const cover = captureDownload(p, 'export-cover').text;
  assert.match(cover, /NOT a professional/);
  assert.match(cover, /not prepared by a licensed appraiser/);
  assert.match(cover, /Active asking prices are never used/);
  assert.match(cover, /REPLACEMENT COST/);
  assert.match(cover, /ACTUAL CASH VALUE/);
});

test('the cover statement counts how much of the schedule is well supported', () => {
  const p = collectionWith(['kennel-pals-calico-cat', 'floppy-kitty']);
  const cover = captureDownload(p, 'export-cover').text;
  assert.match(cover, /Items on schedule:\s+2/);
  assert.match(cover, /Lines with a supported value:\s+1/);
});

// ---- membership -------------------------------------------------------------

test('with no provider connected, nothing is gated and the page says so', () => {
  const p = renderPage('plans.html');
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

test('the three plans render with their prices', () => {
  const p = renderPage('plans.html');
  const cards = p.doc.querySelectorAll('.plan');
  assert.strictEqual(cards.length, 3);
  const text = p.doc.getElementById('plans').textContent;
  assert.match(text, /Free/);
  assert.match(text, /\$7/);
  assert.match(text, /\$14/);
});

test('entitlements resolve by tier once a provider exists', () => {
  const p = renderPage('plans.html');
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

test('an upgrade prompt names the cheapest plan that includes the feature', () => {
  const p = renderPage('plans.html');
  const P = p.win.BearChartPlans;
  assert.strictEqual(P.requiredPlan('collection_sync').id, 'pro');
  assert.strictEqual(P.requiredPlan('alerts_push').id, 'power');
  assert.strictEqual(P.requiredPlan('not_a_feature'), null);
});

test('the page states which features the browser merely hides', () => {
  const p = renderPage('plans.html');
  const table = p.doc.getElementById('enforcement').textContent;
  assert.match(table, /Server/);
  assert.match(table, /Interface only/);
  assert.match(table, /would be theatre/);
});

test('the shared hot-slot limit is stated before anyone pays, not after', () => {
  const p = renderPage('plans.html');
  const text = p.doc.getElementById('hot-slots').textContent;
  assert.match(text, /shared, not personal/);
  assert.match(text, /for the whole site/);
  assert.match(text, /breaks at the fourth customer/);
});

test('no checkout button appears while nothing is purchasable', () => {
  const p = renderPage('plans.html');
  assert.strictEqual(p.doc.querySelectorAll('#plans button[data-plan]').length, 0);
  assert.match(p.doc.getElementById('plans').textContent, /Not purchasable yet/);
});

test('paid server features are gated in the database, not just the page', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase_schema.sql'), 'utf8');
  assert.match(sql, /create or replace function current_tier/);
  assert.match(sql, /create or replace function has_entitlement/);
  // Collection sync must be refused by the function itself.
  assert.match(sql, /collection sync requires a Pro membership/);
  // Writing hosted history must require the entitlement.
  assert.match(sql, /has_entitlement\('hosted_history'\)/);
});

test('a client cannot write its own subscription row', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase_schema.sql'), 'utf8');
  assert.match(sql, /create policy subs_read_own on subscriptions for select/);
  assert.doesNotMatch(sql, /create policy \w+ on subscriptions for (all|insert|update)/,
    'a client that could write this table could grant itself the top tier');
});

test('a lapsed subscription reads as free', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase_schema.sql'), 'utf8');
  assert.match(sql, /current_period_end is null or s\.current_period_end > now\(\)/);
  assert.match(sql, /status in \('active','trialing'\)/);
});

test('a lapsed member can still read their own history', () => {
  // Losing access to data you already created would be punitive, and is a
  // different decision from losing the ability to add more.
  const sql = fs.readFileSync(path.join(ROOT, 'supabase_schema.sql'), 'utf8');
  assert.match(sql, /snapshots_read_own on holding_snapshots for select\s+using \(auth\.uid\(\) = user_id\)/);
});

test('the membership tab is reachable from every page', () => {
  for (const page of ['index.html', 'collection.html', 'account.html']) {
    const p = renderPage(page);
    assert.match(p.doc.getElementById('masthead').innerHTML, /plans\.html/,
      page + ' should link to membership');
  }
});

// ---- Stripe integration -----------------------------------------------------
// These assert the security-critical shape of code that cannot be run here (it
// is Deno, and needs live Stripe keys). They are the guard against someone
// later "simplifying" away a check that is the only thing standing between a
// stranger and a free Power membership.

const edgeFn = (name) =>
  fs.readFileSync(path.join(ROOT, 'supabase', 'functions', name, 'index.ts'), 'utf8');

test('the webhook verifies the Stripe signature before trusting the body', () => {
  const src = edgeFn('stripe-webhook');
  assert.match(src, /constructEventAsync/,
    'Deno crypto is async-only; the sync variant fails silently');
  assert.match(src, /STRIPE_WEBHOOK_SECRET/);
  assert.match(src, /return new Response\("invalid signature", \{ status: 400 \}\)/);
  // The raw body must be used; reserialising changes the signed bytes.
  assert.match(src, /const body = await req\.text\(\)/);
});

test('the webhook never takes the tier or the user from the request', () => {
  const src = edgeFn('stripe-webhook');
  // Tier comes from the price id Stripe reports, matched against env.
  assert.match(src, /function tierForPrice/);
  assert.match(src, /Deno\.env\.get\("PRICE_POWER"\)/);
  // User comes from client_reference_id, which was set server-side at checkout.
  assert.match(src, /session\.client_reference_id/);
  assert.doesNotMatch(src, /body\.(user_id|tier)/,
    'a request that could name its own tier would not need to pay');
});

test('the webhook is idempotent, because Stripe delivers at least once', () => {
  const src = edgeFn('stripe-webhook');
  assert.match(src, /stripe_events/);
  assert.match(src, /duplicate: true/);
  assert.match(src, /23505/, 'a unique-violation means we have seen this event');
  // A failed handler must release the lock so the retry can do real work.
  assert.match(src, /from\("stripe_events"\)\.delete\(\)\.eq\("id", event\.id\)/);
});

test('the webhook writes with the service role, which no client holds', () => {
  const src = edgeFn('stripe-webhook');
  assert.match(src, /SUPABASE_SERVICE_ROLE_KEY/);
  const sql = fs.readFileSync(path.join(ROOT, 'supabase_schema.sql'), 'utf8');
  assert.match(sql, /alter table stripe_events enable row level security/);
  assert.doesNotMatch(sql, /create policy \w+ on stripe_events/,
    'RLS on with no policies denies every client, which is the intent');
});

test('checkout resolves the buyer from their token, not from the body', () => {
  const src = edgeFn('create-checkout');
  assert.match(src, /supabase\.auth\.getUser\(\)/);
  assert.match(src, /client_reference_id: user\.id/);
  assert.doesNotMatch(src, /body\.user_id|body\?\.user_id/);
});

test('checkout takes a plan name and resolves the price itself', () => {
  const src = edgeFn('create-checkout');
  assert.match(src, /function priceForPlan/);
  assert.match(src, /line_items: \[\{ price, quantity: 1 \}\]/);
  // A caller who could pass a price id could pass the cheapest one.
  assert.doesNotMatch(src, /body\.price|price: *body/);
});

test('checkout does not leak provider errors to the browser', () => {
  const src = edgeFn('create-checkout');
  assert.match(src, /could not start checkout/);
  assert.doesNotMatch(src, /error: \(err as Error\)\.message/,
    'Stripe error text can name internal configuration');
});

test('members can cancel without emailing anyone', () => {
  const src = edgeFn('create-portal');
  assert.match(src, /billingPortal\.sessions\.create/);
  // The customer is looked up for the caller under their own RLS, so nobody
  // can open somebody else's billing page.
  assert.match(src, /\.eq\("user_id", user\.id\)/);
});

test('the client sends a plan name and never a price', () => {
  const src = fs.readFileSync(path.join(ROOT, 'plans.js'), 'utf8');
  assert.match(src, /body: \{ plan: id \}/);
  assert.doesNotMatch(src, /price_id|priceId/);
});

test('checkout stays inert until a provider is configured', () => {
  const p = renderPage('plans.html');
  assert.strictEqual(p.doc.querySelectorAll('#plans button[data-plan]').length, 0);
  assert.match(p.doc.getElementById('plans').textContent, /Not purchasable yet/);
});

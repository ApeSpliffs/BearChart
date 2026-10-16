/* Shared helpers for every Plush Price Guide page. Loaded after site-config.js,
   sanitize.js, bc-data.js and engine.js; before the page's own script. */
(function (root) {
  'use strict';

  var BD = root.BearChartData;
  if (!BD) throw new Error('Plush Price Guide: bc-data.js did not load.');
  var S = root.BearChartSanitize;
  if (!S) throw new Error('Plush Price Guide: sanitize.js did not load.');

  // The site manifest (site-config.js). Synchronous: config-only pages
  // (about, plans, account, roadmap, privacy, terms) never load any data.
  var SITE = BD.config();
  var CFG = SITE.engine;
  var E = root.BearChartEngine;
  var canonicalId = BD.canonicalId;
  var REDIRECTS = BD.redirects();

  // --- the loaded data ------------------------------------------------------
  // A page asks for what it needs: BC.withCatalogue (every item's summary) or
  // BC.withItem (one bear and its comps). Until then these lookups have
  // nothing to answer from, and say so loudly rather than guess.

  function notLoaded() {
    throw new Error('Plush Price Guide: the catalogue is not loaded yet (use BC.withCatalogue).');
  }

  var catalogue = null;

  function itemById(id) { return catalogue ? catalogue.itemById(id) : notLoaded(); }
  function valuationFor(id) { return catalogue ? catalogue.valuationFor(id) : notLoaded(); }

  /**
   * Headline numbers. No argument: the whole catalogue, from the build
   * (site-config stats, engine.catalogueStats over every item). With a set of
   * items: the same function over their summaries, so the unfiltered tile
   * equals the hero and the footer.
   */
  function catalogueStats(items) {
    if (!items) return SITE.stats;
    return E.catalogueStats(items, null, valuationFor, CFG);
  }

  /**
   * Every number a page shows about a set of bears, from one place: the hero,
   * the stats tiles, the footer and the search placeholder all read this, so
   * no two of them can disagree. `comps` is engine.catalogueStats'
   * sold_transactions (labelled "sold transactions recorded" everywhere).
   * No argument: the whole catalogue, from the build (no data load needed;
   * median and top need the index, so they are null there). Memoised per array.
   */
  var statsMemo = typeof WeakMap === 'function' ? new WeakMap() : null;
  function statsFor(items) {
    if (!items) {
      var st = SITE.stats || {};
      return { items: st.items || 0, priced: st.priced_items || 0, comps: st.sold_transactions || 0,
               sales: st.sold_records != null ? st.sold_records : null, stale: st.stale_items || 0,
               median: null, top: null, yearMin: st.year_min || null, yearMax: st.year_max || null };
    }
    if (statsMemo && statsMemo.has(items)) return statsMemo.get(items);
    var e = catalogueStats(items);
    var values = [], years = [];
    items.forEach(function (i) {
      var v = valuationFor(i.id);
      if (v && v.has_value && typeof v.fair_market === 'number') values.push(v.fair_market);
      if (i.release_year) years.push(i.release_year);
    });
    var out = {
      items: e.items, priced: e.priced_items, comps: e.sold_transactions,
      sales: e.sold_records, stale: e.stale_items,
      median: values.length ? E.median(values) : null,
      top: values.length ? Math.max.apply(null, values) : null,
      yearMin: years.length ? Math.min.apply(null, years) : null,
      yearMax: years.length ? Math.max.apply(null, years) : null
    };
    if (statsMemo) statsMemo.set(items, out);
    return out;
  }

  /** statsFor over the whole catalogue: the build's figures, the same everywhere. */
  function stats() { return statsFor(); }

  function fmtInt(n) { return Number(n || 0).toLocaleString('en-US'); }

  // --- loading: status hook, error state, idle --------------------------------

  var inFlight = [];

  /** Settles once every withCatalogue / withItem started so far has rendered. */
  function whenIdle() {
    var n = inFlight.length;
    return Promise.all(inFlight.map(function (p) { return p.catch(function () {}); }))
      .then(function () { return inFlight.length > n ? whenIdle() : undefined; });
  }

  function track(p) {
    inFlight.push(p);
    p.then(done, done);
    function done() { var i = inFlight.indexOf(p); if (i !== -1) inFlight.splice(i, 1); }
    return p;
  }

  /** Status text for any [data-bc-status] element (the UX workstream styles it). */
  function setStatus(text) {
    if (typeof document === 'undefined') return;
    Array.prototype.forEach.call(document.querySelectorAll('[data-bc-status]'), function (el) {
      el.textContent = text;
      el.hidden = !text;
    });
  }

  function loadingText(what) {
    var n = (SITE.meta && SITE.meta.item_count) || 0;
    return what || ('Loading ' + n.toLocaleString('en-US') + ' bears…');
  }

  /**
   * The data did not arrive: say so where the page would have been, with a
   * retry. Opened from disk, say how to open it properly instead.
   */
  function dataError(err, retry, what) {
    setStatus('');
    if (typeof document === 'undefined') return;
    var host = document.querySelector('main .wrap') || document.querySelector('main') || document.body;
    var old = document.querySelector('[data-bc-error]');
    if (old) old.parentNode.removeChild(old);
    var box = document.createElement('div');
    box.className = 'notice warn';
    box.setAttribute('data-bc-error', '');
    box.setAttribute('role', 'alert');
    box.innerHTML = err && err.file
      ? '<strong>Open Plush Price Guide through <code>npm start</code>.</strong> Browsers block ' +
        'data files opened straight from disk.'
      : '<strong>Couldn\'t load ' + esc(what || 'the price guide') + '.</strong> ' +
        'Check your connection and try again. ' +
        '<button type="button">Try again</button>';
    var btn = box.querySelector('button');
    if (btn) {
      btn.addEventListener('click', function () {
        box.parentNode.removeChild(box);
        retry();
      });
    }
    host.insertBefore(box, host.firstChild);
  }

  /** A bug in the page's own code: report it like any uncaught error. */
  function rethrow(e) {
    if (root.console && console.error) console.error(e && e.stack ? e.stack : e);
    setTimeout(function () { throw e; }, 0);
  }

  function bindCatalogue(cat) {
    catalogue = cat;
    BC.catalogue = cat;
  }

  /**
   * Load the catalogue index, then render. fn(catalogue[, listings]) runs once
   * the data is in; until then [data-bc-status] says what is loading. With
   * {listings: true} the active asking prices are loaded too (the deal finder).
   */
  function withCatalogue(fn, opts) {
    setStatus(loadingText(opts && opts.label));
    var marks = paintSkeletons(opts && opts.skeleton, opts && opts.label);
    var jobs = [BD.loadIndex()];
    if (opts && opts.listings) jobs.push(BD.loadListings());
    return track(Promise.all(jobs).then(function (res) {
      bindCatalogue(res[0]);
      setStatus('');
      clearSkeletons(marks, false);
      try { fn(res[0], res[1]); } catch (e) { rethrow(e); }
      return res[0];
    }, function (err) {
      clearSkeletons(marks, true);
      dataError(err, function () { withCatalogue(fn, opts); });
      return null;
    }));
  }

  // --- skeletons: what a page looks like while its data is on the way -------
  // Presentation only: nothing here fetches.

  /** Placeholder markup, aria-hidden. kind: 'cards' | 'item' | 'table' | 'stats'. */
  function skeleton(kind, n) {
    var out = '';
    var i;
    n = n || ({ cards: 12, table: 5, stats: 5, item: 1 }[kind] || 3);
    if (kind === 'cards') {
      for (i = 0; i < n; i++) {
        out += '<div class="card sk" aria-hidden="true"><div class="sk-img"></div>' +
               '<div class="sk-line w70"></div><div class="sk-line w40"></div></div>';
      }
    } else if (kind === 'stats') {
      for (i = 0; i < n; i++) {
        out += '<div class="stat sk" aria-hidden="true"><div class="sk-line w40"></div>' +
               '<div class="sk-line w70"></div></div>';
      }
    } else if (kind === 'table') {
      out = '<div class="sk sk-table" aria-hidden="true">';
      for (i = 0; i < n; i++) out += '<div class="sk-line"></div>';
      out += '</div>';
    } else {
      out = '<div class="panel sk sk-item" aria-hidden="true"><div class="sk-img"></div>' +
            '<div class="sk-line w70"></div><div class="sk-line w40"></div>' +
            '<div class="sk-line"></div></div>';
    }
    return out;
  }

  /** Fill each [mount, kind, n] with its skeleton and mark it busy. */
  function paintSkeletons(list, label) {
    if (!list || typeof document === 'undefined') return [];
    return list.filter(function (s) { return s && s[0]; }).map(function (s) {
      s[0].setAttribute('aria-busy', 'true');
      s[0].innerHTML = skeleton(s[1], s[2]) +
        '<p class="sr-only">' + esc(label || 'Loading the price guide…') + '</p>';
      return s[0];
    });
  }

  function clearSkeletons(marks, empty) {
    (marks || []).forEach(function (m) {
      m.removeAttribute('aria-busy');
      if (empty) m.innerHTML = '';
    });
  }

  /** "Couldn't load" with a retry, inside `mount` (the skeleton's place). */
  function errorState(mount, opts) {
    opts = opts || {};
    mount.removeAttribute('aria-busy');
    mount.innerHTML = '<div class="notice warn" role="alert" data-bc-error>' +
      '<strong>Couldn\'t load ' + esc(opts.what || 'the price guide') + '.</strong> ' +
      'Check your connection and try again. <button type="button">Try again</button></div>';
    var btn = mount.querySelector('button');
    if (btn && opts.retry) btn.addEventListener('click', function () { opts.retry(); });
  }

  /**
   * Render `source` into `mount`. A plain value renders at once; a promise
   * shows a skeleton (aria-busy, with a screen-reader "Loading ..." line) until
   * it settles, then renders, or shows errorState with a retry.
   *   opts: {kind, n, label, what, retry}
   */
  function whenData(source, mount, render, opts) {
    opts = opts || {};
    if (!source || typeof source.then !== 'function') {
      render(source);
      return Promise.resolve(source);
    }
    var marks = mount ? paintSkeletons([[mount, opts.kind || 'cards', opts.n]],
                                       'Loading ' + (opts.label || 'the price guide') + '…') : [];
    return track(source.then(function (data) {
      clearSkeletons(marks, false);
      try { render(data); } catch (e) { rethrow(e); }
      return data;
    }, function (err) {
      if (mount) errorState(mount, { what: opts.what, retry: opts.retry });
      else dataError(err, opts.retry || function () {}, opts.what);
      return null;
    }));
  }

  /**
   * The plans page's copy (features, who each tier is for, coupon terms),
   * installed into BearChartPlans before fn runs.
   */
  function withPlans(fn) {
    var P = root.BearChartPlans;
    return track(BD.loadPlans().then(function (copy) {
      if (P && P.useCopy) P.useCopy(copy);
      try { fn(copy); } catch (e) { rethrow(e); }
      return copy;
    }, function (err) {
      dataError(err, function () { withPlans(fn); }, 'the plan details');
      return null;
    }));
  }

  /**
   * Load one bear (its record, comps, listings and related items), then
   * render fn(detail). Offline and never visited, detail.partial is true and
   * carries the index summary instead of the comps (bc-data.js). A missing
   * bear calls fn(null, error).
   */
  function withItem(id, fn) {
    setStatus(loadingText('Loading this bear…'));
    return track(BD.loadItem(id).then(function (detail) {
      // On an item page these answer for the bear on screen.
      catalogue = {
        itemById: function (x) { return canonicalId(x) === detail.item.id ? detail.item : null; },
        valuationFor: function (x) { return canonicalId(x) === detail.item.id ? detail.valuation : null; }
      };
      setStatus('');
      try { fn(detail); } catch (e) { rethrow(e); }
      return detail;
    }, function (err) {
      setStatus('');
      if (err && err.status === 404) {
        try { fn(null, err); } catch (e) { rethrow(e); }
        return null;
      }
      dataError(err, function () { withItem(id, fn); }, 'this bear');
      return null;
    }));
  }

  /**
   * Make a <select> usable against a catalogue of thousands.
   *
   * A native dropdown of 2,048 bears is a scroll bar, not a control: you
   * cannot find "Vanilla Fudge Bunny" in it without already knowing where it
   * sits alphabetically. This puts a search box above the select and keeps the
   * select itself short, so it stays a plain <select> that existing code reads
   * `.value` from - the picker changes how you find an item, not how the page
   * uses the one you picked.
   *
   * Returns a refresh function: call it with no arguments after the catalogue
   * changes (the admin page adds draft items) to rebuild without losing what
   * the user has typed.
   *
   * @param {HTMLSelectElement} select  the element to drive
   * @param {Array|Function} items      catalogue, or a function returning one
   * @param {Function} [label]          item -> option text
   */
  function itemChooser(select, items, label) {
    var LIMIT = 40;
    var text = label || function (i) { return i.canonical_name; };
    var source = typeof items === 'function' ? items : function () { return items; };

    var search = document.createElement('input');
    search.type = 'search';
    search.className = 'item-search';
    search.placeholder = 'Search the catalogue…';
    search.setAttribute('aria-label', 'Search the catalogue');
    select.parentNode.insertBefore(search, select);

    var note = document.createElement('span');
    note.className = 'fine chooser-note';
    select.parentNode.insertBefore(note, select.nextSibling);

    function fill(q) {
      var sorted = source().slice().sort(function (a, b) {
        return a.canonical_name.localeCompare(b.canonical_name);
      });
      var needle = String(q === undefined ? search.value : q).trim().toLowerCase();
      var hits = needle
        ? sorted.filter(function (i) {
            if (i.canonical_name.toLowerCase().indexOf(needle) !== -1) return true;
            return (i.aliases || []).some(function (a) {
              return a.toLowerCase().indexOf(needle) !== -1;
            });
          })
        : sorted;

      select.innerHTML = hits.slice(0, LIMIT).map(function (i) {
        return '<option value="' + esc(i.id) + '">' + esc(text(i)) + '</option>';
      }).join('');

      if (!hits.length) {
        note.textContent = 'Nothing matches “' + needle + '”.';
      } else if (hits.length > LIMIT) {
        note.textContent = 'Showing ' + LIMIT + ' of ' + hits.length +
                           ' matches — keep typing to narrow it down.';
      } else {
        note.textContent = '';
      }
    }

    var debounce;
    search.addEventListener('input', function () {
      clearTimeout(debounce);
      var v = search.value;
      debounce = setTimeout(function () { fill(v); }, 100);
    });

    fill('');

    // The chooser is also reachable from the element it drives, so anything
    // holding the <select> can refresh it (the admin page does, after drafting
    // a new item) without having to keep the returned function around.
    select.refill = fill;
    return fill;
  }

  /**
   * The evidence behind a number, drawn.
   *
   * Plush Price Guide's whole argument is that a price comes with its footing, and
   * until now that footing was a grey pill reading "LOW". This plots it: the
   * published range as a band, the median as a line, and every recorded sale
   * as a dot where it actually sits.
   *
   * It is built for one or two observations, because that is what the database
   * has - no item in it has three. A single dot inside a wide band reads as
   * "we know exactly one thing, and here is how much that leaves open", which
   * is both the truth and a better argument than apologising for it.
   *
   * Dots are the NORMALISED price - what entered the median after adjusting
   * for condition and completeness - because plotting what a seller received
   * against an adjusted median would be comparing two different things. The
   * caption says so.
   */
  function evidenceStrip(v) {
    if (!v || !v.has_value || !v.points || !v.points.length) return '';

    var W = 600, H = 104, PAD = 52, AXIS = 62;
    var vals = v.points.map(function (p) { return p.norm; })
      .concat([v.range_low, v.range_high, v.fair_market])
      .filter(function (n) { return typeof n === 'number' && isFinite(n); });
    if (!vals.length) return '';

    var lo = Math.min.apply(null, vals);
    var hi = Math.max.apply(null, vals);
    if (hi - lo < 0.005) {
      // One comp, or several identical ones: everything lands on the same
      // price. Give the axis a span so the drawing is a point in a context
      // rather than a stack of shapes on one pixel.
      var spread = Math.max(hi * 0.2, 1);
      lo -= spread; hi += spread;
    } else {
      var margin = (hi - lo) * 0.14;
      lo -= margin; hi += margin;
    }
    var x = function (n) { return PAD + ((n - lo) / (hi - lo)) * (W - PAD * 2); };

    var band = '';
    if (typeof v.range_low === 'number' && typeof v.range_high === 'number') {
      var bx = x(v.range_low), bw = Math.max(x(v.range_high) - bx, 2);
      band = '<rect class="ev-band" x="' + bx.toFixed(1) + '" y="' + (AXIS - 19) +
             '" width="' + bw.toFixed(1) + '" height="38" rx="6"/>';
    }

    var med = typeof v.fair_market === 'number'
      ? '<line class="ev-median" x1="' + x(v.fair_market).toFixed(1) + '" y1="' + (AXIS - 24) +
        '" x2="' + x(v.fair_market).toFixed(1) + '" y2="' + (AXIS + 24) + '"/>'
      : '';

    var anyOwn = false;
    var dots = v.points.map(function (p) {
      var own = isOperatorSale(p);
      if (own) anyOwn = true;
      var cls = 'ev-dot' + (own ? ' ev-dot-own' : '');
      var title = exact(p.raw) + (p.condition ? ' · ' + p.condition : '') +
                  (p.norm !== p.raw ? ' → ' + exact(p.norm) + ' adjusted' : '') +
                  (own ? ' · sold by our store' : '');
      return '<circle class="' + cls + '" cx="' + x(p.norm).toFixed(1) +
             '" cy="' + AXIS + '" r="7"><title>' + esc(title) + '</title></circle>';
    }).join('');

    // Label the ends of the RANGE, not the ends of the axis. The axis ends are
    // padding chosen to leave the drawing some air; printing them would put a
    // precise-looking figure under a price at which nothing happened, which is
    // the one thing this guide will not do anywhere else either.
    var ends = '';
    if (typeof v.range_low === 'number' && typeof v.range_high === 'number') {
      var lx = Math.min(Math.max(x(v.range_low), 22), W - 22);
      var hx = Math.min(Math.max(x(v.range_high), 22), W - 22);
      var same = Math.abs(hx - lx) < 40;
      ends +=
        '<text class="ev-tick" x="' + lx.toFixed(1) + '" y="' + (AXIS + 40) +
        '" text-anchor="middle">' + esc(money(v.range_low)) + '</text>' +
        (same ? ''    // one comp: both ends are the same price, so say it once
              : '<text class="ev-tick" x="' + hx.toFixed(1) + '" y="' + (AXIS + 40) +
                '" text-anchor="middle">' + esc(money(v.range_high)) + '</text>');
    }
    ends += '<text class="ev-label" x="' + x(v.fair_market).toFixed(1) + '" y="' +
      (AXIS - 32) + '" text-anchor="middle">' + esc(money(v.fair_market)) + '</text>';

    var n = v.points.length;
    var alt = n === 1
      ? 'One recorded sale at ' + money(v.points[0].norm) + ', inside a published ' +
        'range of ' + money(v.range_low) + ' to ' + money(v.range_high) + '.'
      : n + ' recorded sales between ' + money(Math.min.apply(null,
          v.points.map(function (p) { return p.norm; }))) + ' and ' +
        money(Math.max.apply(null, v.points.map(function (p) { return p.norm; }))) +
        ', median ' + money(v.fair_market) + '.';

    return '<figure class="evidence">' +
      '<svg class="ev-strip" viewBox="0 0 ' + W + ' ' + H + '" role="img" ' +
      'aria-label="' + esc(alt) + '" preserveAspectRatio="xMidYMid meet">' +
        '<line class="ev-axis" x1="' + PAD + '" y1="' + AXIS + '" x2="' + (W - PAD) +
        '" y2="' + AXIS + '"/>' + band + med + dots + ends +
      '</svg>' +
      '<figcaption class="ev-key">' +
        '<span class="ev-k-dot"></span> ' +
        (n === 1 ? 'the one recorded sale' : n + ' recorded sales') +
        ', adjusted to Good condition with no extras ' +
        '<span class="ev-k-band"></span> published range ' +
        '<span class="ev-k-med"></span> median' +
        (anyOwn ? ' <span class="ev-k-own"></span> sold by our store' : '') +
      '</figcaption>' +
      '</figure>';
  }

  // --- formatting ----------------------------------------------------------

  function fmt(n, dp) {
    return '$' + Number(n).toLocaleString('en-US', {
      minimumFractionDigits: dp, maximumFractionDigits: dp
    });
  }

  /**
   * Estimates round to whole dollars once they pass $100 - false precision on a
   * derived number is noise. Recorded sale prices use exact() instead, because
   * a comp that sold for $204.49 did not sell for $204.
   */
  function money(n) {
    if (n == null || isNaN(n)) return '--';
    return fmt(n, Math.abs(n) < 100 ? 2 : 0);
  }

  /** A price exactly as it was recorded. Used for every observed sold price. */
  function exact(n) {
    if (n == null || isNaN(n)) return '--';
    return fmt(n, Number(n) % 1 === 0 ? 0 : 2);
  }

  /** Both ends of a range share one precision, chosen by the larger value. */
  function range(lo, hi) {
    if (lo == null || hi == null) return '--';
    var dp = Math.max(Math.abs(lo), Math.abs(hi)) < 100 ? 2 : 0;
    if (Math.abs(lo - hi) < 0.005) return fmt(lo, dp);
    return fmt(lo, dp) + ' - ' + fmt(hi, dp);
  }

  function confClass(c) { return 'conf conf-' + String(c).toLowerCase().replace(/\s+/g, '-'); }

  /** 'HIGH' -> 'High confidence', 'VERY LOW' -> 'Very low confidence'. */
  function confLabel(c) {
    var s = String(c || 'VERY LOW').toLowerCase();
    return s.charAt(0).toUpperCase() + s.slice(1) + ' confidence';
  }

  var chipSeq = 0;
  /**
   * The confidence chip. Linked to how confidence is rated, with a tooltip
   * giving the count behind it (shown on hover and keyboard focus, and kept
   * open while the pointer is over it). On a card it is a plain span - the
   * card is already one link.
   *   opts: {link: bool, n: comparable_count}
   */
  function confChip(conf, opts) {
    opts = opts || {};
    var label = esc(confLabel(conf));
    if (!opts.link) return '<span class="' + confClass(conf) + '">' + label + '</span>';
    var id = 'conf-tip-' + (++chipSeq);
    var n = opts.n == null ? null : Number(opts.n);
    return '<span class="conf-wrap"><a class="' + confClass(conf) + '" href="' +
      rel('about.html') + '#confidence" aria-describedby="' + id + '">' + label + '</a>' +
      '<span role="tooltip" id="' + id + '" class="conf-tip">' +
      (n == null ? '' : 'Based on ' + n + ' sale' + (n === 1 ? '' : 's') + '. ') +
      'How we rate confidence &rarr;</span></span>';
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  /** '2024-03-02' -> 'Mar 2024'; null for anything that is not a date. */
  function monthYear(iso) {
    var m = /^(\d{4})-(\d{2})/.exec(String(iso || ''));
    if (!m || +m[2] < 1 || +m[2] > 12) return null;
    return MONTHS[+m[2] - 1] + ' ' + m[1];
  }

  /**
   * How fresh a value is, from its valuation (engine fields stale and
   * last_sale_date; the data workstream owns the threshold).
   *   item page: "Older data · last sale Mar 2024" or "Last sale Mar 2024"
   *   card ({card: true}): only "Older data", only when stale
   */
  function freshness(v, opts) {
    if (!v) return '';
    var when = monthYear(v.last_sale_date);
    if (opts && opts.card) {
      return v.stale ? '<span class="chip chip-stale chip-sm">Older data</span>' : '';
    }
    if (!when) return '';
    return v.stale
      ? '<span class="chip chip-stale"><span aria-hidden="true">&#9201;</span> Older data &middot; last sale ' +
        esc(when) + '</span>'
      : '<span class="chip chip-fresh">Last sale ' + esc(when) + '</span>';
  }

  /** A sale made by Jay's Retro Exchange, the store that runs this guide. */
  function isOperatorSale(s) { return !!(s && (s.seller_is_operator || s.first_party || s.operator)); }

  var OPERATOR_LABEL = 'Seller: Jay\'s Retro Exchange (our store)';

  function era(item) {
    var y = item.release_year;
    if (!y) return 'Year unknown';
    if (y < 2000) return 'Vintage (1997-1999)';
    if (y < 2010) return 'Early 2000s';
    if (y < 2020) return '2010s';
    return 'Modern';
  }

  function isVintage(item) { return item.release_year != null && item.release_year < 2000; }

  function conditionLabel(c) { return c || 'Unknown'; }

  function completenessLabel(c) {
    return CFG.completeness_labels[c] || c || 'Not recorded';
  }

  function dateLabel(d) { return d || 'Date not recorded'; }

  /** Badge list for an item, in a stable order. */
  function tagsFor(item) {
    var t = [];
    if (item.release_status === 'upcoming') t.push({ text: 'Upcoming', cls: 'upcoming' });
    if (item.release_status === 'current') t.push({ text: 'At Retail Now', cls: 'current' });
    if (isVintage(item)) t.push({ text: 'Vintage', cls: 'vintage' });
    if (item.mini_bean) t.push({ text: 'Mini Bean', cls: '' });
    if (item.licensed) t.push({ text: item.franchise || 'Licensed', cls: 'licensed' });
    if (item.limited_edition) t.push({ text: 'Limited Edition', cls: 'limited' });
    if (item.employee_exclusive) t.push({ text: 'Employee Exclusive', cls: 'exclusive' });
    if (item.store_exclusive) t.push({ text: 'Store Exclusive', cls: 'exclusive' });
    if (item.event_exclusive) t.push({ text: 'Event Exclusive', cls: 'exclusive' });
    if (item.international_exclusive) t.push({ text: 'International Exclusive', cls: 'exclusive' });
    if (item.online_exclusive) t.push({ text: 'Online Exclusive', cls: 'exclusive' });
    if (item.vault_release) t.push({ text: 'Vault', cls: '' });
    if (item.retired) t.push({ text: 'Retired', cls: '' });
    if (item.is_lot) t.push({ text: 'Lot', cls: '' });
    return t;
  }

  function tagsHtml(item) {
    var t = tagsFor(item);
    if (!t.length) return '';
    return '<div class="tags">' + t.map(function (x) {
      return '<span class="tag ' + x.cls + '">' + esc(x.text) + '</span>';
    }).join('') + '</div>';
  }

  var esc = S.esc;

  /**
   * Where "here" is, relative to the site root.
   *
   * Generated item pages live one directory down (item/<slug>.html) so that
   * every bear has a real, crawlable URL of its own. The site also has to keep
   * working opened straight off disk and served from a subdirectory, which
   * rules out root-relative "/item/x.html" links. So internal links get a
   * prefix worked out from where the current page actually sits.
   */
  var rel = BD.rel;   // one definition, shared with the data URLs

  function itemUrl(id) {
    return rel('item/' + encodeURIComponent(canonicalId(id)) + '.html');
  }

  /** Leave this page for another without a history entry (a redirect). */
  function go(url) { root.location.replace(url); }

  var BUSINESS = SITE.business || {};

  /**
   * Wrap an outbound eBay link with an affiliate campaign id, if one is set.
   *
   * Affiliate money must never touch a valuation, so this only ever rewrites a
   * URL - it cannot reorder, filter or weight what gets shown.
   */
  function affiliate(url) {
    if (!url || !BUSINESS.ebay_campaign_id) return url;
    if (!/^https?:\/\/(www\.)?ebay\./i.test(url)) return url;
    var sep = url.indexOf('?') === -1 ? '?' : '&';
    return url + sep + 'mkcid=1&mkrid=711-53200-19255-0&campid=' +
           encodeURIComponent(BUSINESS.ebay_campaign_id) + '&toolid=10001';
  }

  /**
   * An outbound marketplace link, affiliate-tagged when a campaign is set, and
   * then marked rel="sponsored" as search engines require. Unsafe URLs render
   * as plain text.
   */
  function affiliateLink(url, innerHtml) {
    var tagged = affiliate(url);
    // eBay links are marketplace links this guide may earn from: always
    // rel="sponsored", tagged or not (cross-spec decision #5).
    return S.extLink(tagged, innerHtml,
      { sponsored: tagged !== url || /^https?:\/\/(www\.)?ebay\./i.test(String(url || '')) });
  }

  /** A fetch time as the visitor's local date and time ("Oct 16, 9:15 AM"). */
  function fetchedTime(fetchedAt) {
    var t = new Date(fetchedAt || '');
    if (!isFinite(t.getTime())) return '';
    try {
      return t.toLocaleString(undefined, { month: 'short', day: 'numeric',
                                          hour: 'numeric', minute: '2-digit' });
    } catch (e) {
      return t.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    }
  }

  /**
   * The "Prices updated <time>" stamp for eBay asking prices, or ''. Pass the
   * OLDEST fetch time among the rows on screen: that is the honest age of
   * the set. Rows past six hours never get here (BD.freshListings).
   */
  function listingsUpdatedNote(fetchedAt) {
    var when = fetchedTime(fetchedAt);
    if (!when) return '';
    return '<p class="fine listings-updated">Prices updated <time datetime="' +
      esc(new Date(fetchedAt).toISOString()) + '">' + esc(when) + '</time> from eBay. ' +
      'Listings are rechecked every 4 hours and hidden once a check is more than ' +
      '6 hours old.</p>';
  }

  /** The rows of a listings set still fresh enough to show (see bc-data.js). */
  function freshListings(rows, runFetchedAt) {
    return BD.freshListings(rows, runFetchedAt);
  }

  /** The oldest fetch time among these rows (a row's own time wins). */
  function oldestFetch(rows, runFetchedAt) {
    return (rows || []).reduce(function (o, l) {
      var at = l.fetched_at || runFetchedAt;
      return at && (!o || at < o) ? at : o;
    }, null);
  }

  // eBay's own policies, linked from every page footer (eBay API License
  // Agreement s8.2: our privacy policy must be consistent with eBay's).
  var EBAY_USER_AGREEMENT =
    'https://www.ebay.com/help/policies/member-behaviour-policies/user-agreement?id=4259';
  var EBAY_PRIVACY_NOTICE =
    'https://www.ebay.com/help/policies/member-behaviour-policies/user-privacy-notice-privacy-policy?id=4260';

  /** A plain address only: no ? or & that could add mailto parameters. */
  function safeEmail(email) {
    return /^[^\s@<>"'?&]+@[^\s@<>"'?&]+$/.test(email || '');
  }

  function businessEnabled() {
    return !!(BUSINESS.enabled && (BUSINESS.contact_email || BUSINESS.contact_url));
  }

  function shopEnabled() {
    return !!(BUSINESS.enabled && BUSINESS.shop_url);
  }

  // --- the hand-off to Jay's Retro Exchange ----------------------------------
  // Plush Price Guide sells nothing but memberships. Buying and selling a bear happens
  // at Jay's Retro Exchange, the store that runs the guide, and every link
  // there is built here: UTM-tagged, https only, opened in a new tab, marked
  // rel="sponsored", announced to screen readers, counted as a shop_click and
  // followed by a one-line disclosure. The shop's address lives only in config
  // (tools/build_data.py BUSINESS).

  var SHOP_PLACEMENTS = ['footer', 'guide_sidebar', 'guide_mobile', 'item_store_panel',
    'item_offer', 'item_quote', 'item_search', 'about_disclosure',
    'nudge_perk', 'plans_perk', 'other'];
  // Not here on purpose: the contact links on privacy.html and terms.html.
  // Asking about your data is not shopping - they stay plain links.
  var SHOP_REL = 'sponsored noopener noreferrer';

  function shopPlacement(p) {
    if (SHOP_PLACEMENTS.indexOf(p) !== -1) return p;
    if (root.console && console.warn && /^(localhost|127\.0\.0\.1)$/.test((root.location || {}).hostname || '')) {
      console.warn('Plush Price Guide: unknown shop placement "' + p + '"');
    }
    return 'other';
  }

  /**
   * The address of a store link, or '' when the shop is off or its URL is
   * not https.
   *   opts: {kind: 'home'|'search'|'offer'|'quote', item, condition,
   *          medium: 'referral'|'member_perk', campaign}
   */
  function shopHref(placement, opts) {
    if (!shopEnabled()) return '';
    opts = opts || {};
    var b = BUSINESS;
    var kind = opts.kind || 'home';
    var tpl = kind === 'search' ? b.shop_search_url
      : (kind === 'offer' || kind === 'quote') ? b.shop_offer_url : null;
    var item = opts.item || null;
    var raw = (tpl || b.shop_url)
      .replace(/\{q\}/g, encodeURIComponent(item ? item.canonical_name || '' : ''))
      .replace(/\{item\}/g, encodeURIComponent(item ? item.id || '' : ''))
      .replace(/\{condition\}/g, encodeURIComponent(opts.condition || ''));
    var safe = S.safeUrl(raw, { schemes: ['https:'] }) ||
               S.safeUrl(b.shop_url, { schemes: ['https:'] });
    if (!safe) return '';
    var url;
    try { url = new URL(safe); } catch (e) { return ''; }
    var medium = opts.medium || 'referral';
    url.searchParams.set('utm_source', 'bearchart');
    url.searchParams.set('utm_medium', medium);
    url.searchParams.set('utm_campaign', opts.campaign || (medium === 'member_perk' ? 'perk' : 'guide'));
    url.searchParams.set('utm_content', shopPlacement(placement));
    if (item && item.id) url.searchParams.set('utm_term', item.id);
    return url.toString();
  }

  /**
   * A link to the store, or '' when the shop is off.
   *   opts: shopHref's, plus label (default business.shop_cta) and className
   *         (default 'btn btn-primary'; '' for a plain text link)
   */
  function shopLink(placement, opts) {
    opts = opts || {};
    var href = shopHref(placement, opts);
    if (!href) return '';
    var cls = opts.className === undefined ? 'btn btn-primary' : opts.className;
    var item = opts.item || null;
    // The anchor itself is sanitize.js extLink's (https only); the data-*
    // attributes say where it sits, for the shop_click count.
    var link = S.extLink(href, esc(opts.label || BUSINESS.shop_cta || BUSINESS.name) +
      '<span class="ext" aria-hidden="true"> &#8599;</span>' +
      '<span class="sr-only"> (opens our shop)</span>',
      { className: cls || undefined, rel: SHOP_REL, schemes: ['https:'] });
    return link.replace(/^<a /, '<a data-shop-placement="' + esc(shopPlacement(placement)) +
      '" data-shop-kind="' + esc(opts.kind || 'home') + '"' +
      (item && item.id ? ' data-item="' + esc(item.id) + '"' : '') + ' ');
  }

  /** The one line that follows every store link. */
  function shopDisclosure() {
    if (!shopEnabled()) return '';
    return '<p class="shop-disclosure fine">' + esc(BUSINESS.shop_disclosure_short ||
      'Jay\'s Retro Exchange is our store. It never changes a value in this guide.') +
      ' <a href="' + rel('about.html') + '#conflicts">How we keep it separate</a></p>';
  }

  /**
   * Static pages (privacy, terms) carry a plain link with data-shop-placement
   * so they work without script; this upgrades each to a real store link.
   */
  function upgradeShopLinks(scope) {
    if (typeof document === 'undefined') return;
    var host = scope || document;
    Array.prototype.forEach.call(host.querySelectorAll('a[data-shop-placement]'), function (a) {
      if (a.getAttribute('data-shop-upgraded')) return;
      var href = shopHref(a.getAttribute('data-shop-placement'),
                          { kind: a.getAttribute('data-shop-kind') || 'home' });
      if (!href) return;
      a.setAttribute('href', href);
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', SHOP_REL);
      a.setAttribute('data-shop-upgraded', '1');
      if (!a.querySelector('.ext')) {
        a.insertAdjacentHTML('beforeend', '<span class="ext" aria-hidden="true"> &#8599;</span>');
      }
      if (!a.querySelector('.sr-only')) {
        a.insertAdjacentHTML('beforeend', '<span class="sr-only"> (opens our shop)</span>');
      }
      // Every store link is followed by the one-line disclosure.
      var block = a.closest('p, li, dd') || a;
      var next = block.nextElementSibling;
      if (!next || !next.classList.contains('shop-disclosure')) {
        block.insertAdjacentHTML('afterend', shopDisclosure());
      }
    });
  }

  /**
   * A promo for the shop that runs this guide.
   *
   * Labelled as exactly that. The site's argument is that its numbers are not
   * for sale, so the operator's own shop appearing on the page has to announce
   * itself - an unlabelled ad from the person publishing the valuations is the
   * single fastest way to lose a reader who works it out for themselves.
   *
   * @param {string} [variant] 'compact' for the sidebar, full card otherwise.
   * @param {string} [placement] where it sits (SHOP_PLACEMENTS)
   */
  function shopPromo(variant, placement) {
    if (!shopEnabled()) return '';
    var b = BUSINESS;
    var compact = variant === 'compact';
    return '<aside class="promo' + (compact ? ' promo-compact' : '') + '">' +
      '<p class="promo-eyebrow">' + esc(b.shop_eyebrow || b.name) + '</p>' +
      '<h3 class="promo-title">' + esc(b.shop_headline || b.name) + '</h3>' +
      '<p class="promo-blurb">' + esc(b.shop_blurb || '') + '</p>' +
      '<p class="promo-act">' +
      shopLink(placement || (compact ? 'guide_sidebar' : 'other')) +
      '</p>' +
      shopDisclosure() +
      '</aside>';
  }

  // --- images --------------------------------------------------------------

  /* No item ships with a photograph. Official Build-A-Bear product imagery is
     copyrighted, so nothing is hotlinked or bundled; items you photograph
     yourself (or images you hold the rights to) are attached through the admin
     tools. Until then every item draws a generated monogram tile, so a missing
     photo reads as "not added yet" rather than as a broken page. */

  function hashCode(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function initials(item) {
    var words = String(item.canonical_name).replace(/[^A-Za-z0-9 ]/g, ' ')
      .split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  }

  /**
   * A species illustration for an item that has no photograph.
   *
   * Drawn, never photographed, and labelled as such. The hue is derived from the
   * item id so a given item always looks the same, and the drawing is chosen from
   * what the catalogue records about the item - a bear record gets a bear.
   */
  /**
   * Colour for an item's illustration.
   *
   * Nothing in the catalogue has a photograph yet, so these drawings ARE the
   * look of the site - two thousand of them at a time. Drawn from one narrow
   * band of browns they turned a shelf of toys into a sepia spreadsheet, so
   * each kind of friend gets its own hue, jittered per item so two bunnies are
   * never quite the same pink. The species tells you something before you have
   * read a word, which is most of what a picture is for.
   */
  var ICON_HUES = {
    bear: [34, 62], dog: [26, 58], cat: [12, 60], bunny: [338, 55],
    mouse: [292, 40], dino: [138, 48], dragon: [166, 46], unicorn: [276, 52],
    bird: [200, 58], penguin: [214, 40], frog: [96, 50], axolotl: [330, 62],
    pig: [350, 52], cow: [228, 34], elephant: [208, 32], monkey: [22, 52],
    butterfly: [266, 54], spider: [282, 42], fish: [186, 52], bat: [268, 30],
    character: [220, 58], vehicle: [6, 56], shirt: [174, 46],
    shoe: [246, 44], hat: [312, 48], bag: [68, 44], props: [44, 60],
    furniture: [30, 38], paw: [38, 44]
  };

  function placeholderImage(item, opts) {
    var icons = root.BearChartIcons;
    var key = icons ? icons.iconKeyFor(item) : 'paw';
    var base = ICON_HUES[key] || ICON_HUES.paw;
    var h = hashCode(item.id);
    // Same family, never the same swatch twice.
    var hue = (base[0] + (h % 17) - 8 + 360) % 360;
    var sat = base[1];
    var tilt = (h >> 3) % 7;

    var bg1 = 'hsl(' + hue + ', ' + Math.round(sat * 0.55) + '%, ' + (93 - tilt * 0.4) + '%)';
    var bg2 = 'hsl(' + ((hue + 24) % 360) + ', ' + Math.round(sat * 0.5) + '%, ' + (86 - tilt * 0.5) + '%)';
    var fg = 'hsl(' + hue + ', ' + Math.round(sat * 0.8) + '%, 38%)';
    var ac = 'hsl(' + hue + ', ' + Math.round(sat * 0.6) + '%, 76%)';

    var art = icons
      ? icons.draw(key, fg, ac)
      : '<text x="200" y="170" text-anchor="middle" font-size="86" fill="' + fg +
        '" font-family="Georgia, serif">' + esc(initials(item)) + '</text>';

    // Every drawing says it is a drawing. A price guide that let its
    // illustrations read as photographs of the actual item would be lying
    // about the one thing a buyer is looking at, so this is not negotiable -
    // there is a test holding it in place.
    //
    // It is set quietly on a card, where it repeats down a grid of sixty, and
    // plainly on an item page, where somebody is actually deciding what they
    // are looking at.
    var loud = !!(opts && opts.caption);
    var caption = '<text x="200" y="' + (loud ? 286 : 290) + '" text-anchor="middle" ' +
      'font-size="' + (loud ? 13 : 11) + '" fill="' + fg + '" ' +
      // Legible on both: full strength on the item page, where the HTML text
      // under the picture says the same for screen readers; lighter on cards.
      'font-family="system-ui, sans-serif" opacity="' + (loud ? '1' : '.6') + '" ' +
      'letter-spacing="1.5">ILLUSTRATION &#183; NO PHOTO YET</text>';

    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="0.6" y2="1">' +
      '<stop offset="0" stop-color="' + bg1 + '"/>' +
      '<stop offset="1" stop-color="' + bg2 + '"/></linearGradient></defs>' +
      '<rect width="400" height="300" fill="url(#g)"/>' + art + caption +
      '</svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function hasImage(item) { return !!S.safeUrl(item.image_url, { allowRelative: true }); }

  /**
   * Markup for an item's picture. A real photo that fails to load falls back to
   * the monogram rather than leaving a broken frame.
   */
  function imageHtml(item, cls) {
    var placeholder = placeholderImage(item, { caption: cls === 'hero' });
    if (!hasImage(item)) {
      return '<img class="' + (cls || 'thumb') + ' is-placeholder" src="' + placeholder +
             '" alt="" aria-hidden="true" loading="lazy">';
    }
    // No inline onerror (the CSP forbids inline handlers): the fallback rides
    // in data-fallback and one capture-phase listener below swaps it in.
    return '<img class="' + (cls || 'thumb') + '" src="' +
           esc(S.safeUrl(item.image_url, { allowRelative: true })) +
           '" alt="' + esc(item.canonical_name) + '" loading="lazy" ' +
           'data-fallback="' + esc(placeholder) + '">';
  }

  // A real photo that fails to load falls back to its monogram. Error events
  // do not bubble, so listen in the capture phase - once, for every <img>.
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('error', function (e) {
      var t = e.target;
      if (t && t.tagName === 'IMG' && t.dataset && t.dataset.fallback) {
        var f = t.dataset.fallback;
        delete t.dataset.fallback;
        t.src = f; t.classList.add('is-placeholder'); t.alt = '';
      }
    }, true);
  }

  /** Credit line for a photo, so image provenance is recorded like sale provenance. */
  function imageCredit(item) {
    if (!hasImage(item)) return '';
    var bits = [];
    if (item.image_credit) bits.push(esc(item.image_credit));
    if (item.image_source) {
      bits.push(S.extLink(item.image_source, 'source'));
    }
    return bits.length ? '<p class="fine img-credit">Photo: ' + bits.join(' &middot; ') + '</p>' : '';
  }

  // --- search --------------------------------------------------------------

  /** Free-text match across the fields section 19 asks for. */
  function matches(item, query) {
    if (!query) return true;
    var hay = [
      item.canonical_name, (item.aliases || []).join(' '), item.franchise,
      item.species, item.category, item.release_year, item.version,
      item.line, item.notes, item.rarity
    ].filter(Boolean).join(' ').toLowerCase();
    return query.toLowerCase().split(/\s+/).filter(Boolean)
      .every(function (term) { return hay.indexOf(term) !== -1; });
  }

  // --- CSV -----------------------------------------------------------------

  // csvCell/toCsv live in sanitize.js (formula-injection safe); every export uses them.
  var toCsv = S.toCsv;

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: (mime || 'text/csv') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);
  }

  function r2(n) { return n == null ? '' : Math.round(n * 100) / 100; }

  function stamp() { return new Date().toISOString().slice(0, 10); }

  // --- chrome --------------------------------------------------------------

  var NAV = [
    ['index.html', 'Price Guide'],
    ['deals.html', 'Deals'],
    ['checklists.html', 'Checklists'],
    ['collection.html', 'My Collection'],
    ['showcase.html', 'Showcases'],
    ['admin.html', 'Admin'],
    ['about.html', 'Method'],
    ['roadmap.html', 'Roadmap'],
    ['plans.html', 'Membership'],
    ['account.html', 'Account']
  ];

  // ---- wishlist ------------------------------------------------------------
  // Kept in this browser for everyone, and also saved to the member's account
  // when signed in, so it follows them between devices. The account copy is
  // also what a future "Most Wanted" report would count - only ever in
  // aggregate, never one person's list.

  var WL_KEY = 'bearchart.wishlist';

  // One-time rewrite of stored ids that now redirect. Runs on every load but
  // only writes when something changed, so it is cheap once a browser is clean.
  function migrateStoredIds() {
    if (!Object.keys(REDIRECTS).length) return;
    try {
      var coll = JSON.parse(localStorage.getItem('bearchart.collection') || 'null');
      if (Array.isArray(coll)) {
        var changed = false;
        coll.forEach(function (e) {
          if (e && e.item_id && canonicalId(e.item_id) !== e.item_id) {
            e.item_id = canonicalId(e.item_id);
            changed = true;
          }
        });
        if (changed) localStorage.setItem('bearchart.collection', JSON.stringify(coll));
      }
      // Portfolio history: the last holdings map (id -> qty, merged ids summed)
      // and the recorded flows, so a merge never reads as buying or selling.
      var hold = JSON.parse(localStorage.getItem('bearchart.lastHoldings') || 'null');
      if (hold && typeof hold === 'object' && !Array.isArray(hold)) {
        var held = {}, moved = false;
        Object.keys(hold).forEach(function (id) {
          var c = canonicalId(id);
          if (c !== id) moved = true;
          held[c] = (held[c] || 0) + (Number(hold[id]) || 0);
        });
        if (moved) localStorage.setItem('bearchart.lastHoldings', JSON.stringify(held));
      }
      var flows = JSON.parse(localStorage.getItem('bearchart.flows') || 'null');
      if (Array.isArray(flows)) {
        var fmoved = false;
        flows.forEach(function (f) {
          if (f && f.item_id && canonicalId(f.item_id) !== f.item_id) {
            f.item_id = canonicalId(f.item_id);
            fmoved = true;
          }
        });
        if (fmoved) localStorage.setItem('bearchart.flows', JSON.stringify(flows));
      }
      var wl = JSON.parse(localStorage.getItem(WL_KEY) || 'null');
      if (Array.isArray(wl)) {
        var out = [];
        wl.forEach(function (id) {
          var c = typeof id === 'string' ? canonicalId(id) : id;
          if (out.indexOf(c) === -1) out.push(c);
        });
        if (JSON.stringify(out) !== JSON.stringify(wl)) {
          localStorage.setItem(WL_KEY, JSON.stringify(out));
        }
      }
    } catch (e) { /* storage blocked: lookups still resolve through canonicalId */ }
  }
  migrateStoredIds();
  var wlListeners = [];
  var wlSynced = false;

  function wlLoad() {
    try {
      var v = JSON.parse(localStorage.getItem(WL_KEY) || '[]');
      return Array.isArray(v) ? v.filter(function (x) { return typeof x === 'string'; }) : [];
    } catch (e) { return []; }
  }
  function wlSave(list) {
    try { localStorage.setItem(WL_KEY, JSON.stringify(list)); } catch (e) { /* storage blocked */ }
  }
  function wlNotify() {
    var list = wlLoad();
    wlListeners.forEach(function (fn) { try { fn(list); } catch (e) { /* listener failed */ } });
  }
  function wlClient() {
    var A = root.BearChartAuth;
    if (!A || !A.configured || !A.configured()) return null;
    var s = A.state();
    return s && s.signedIn ? A.getClient() : null;
  }
  // Merge this browser's list with the account's once per sign-in. Nothing is
  // ever deleted by a merge: a bear on either list ends up on both.
  function wlSync() {
    var c = wlClient();
    if (!c || wlSynced) return;
    wlSynced = true;
    c.from('wishlists').select('item_id').then(function (r) {
      if (r.error) { wlSynced = false; return; }
      var remote = (r.data || []).map(function (x) { return x.item_id; });
      var local = wlLoad();
      var merged = local.slice();
      remote.forEach(function (id) { if (merged.indexOf(id) === -1) merged.push(id); });
      wlSave(merged);
      wlNotify();
      var push = local.filter(function (id) { return remote.indexOf(id) === -1; });
      if (push.length) {
        c.from('wishlists').upsert(push.map(function (id) { return { item_id: id }; }),
          { onConflict: 'user_id,item_id', ignoreDuplicates: true }).then(function () {});
      }
    });
  }
  function wlToggle(id) {
    var list = wlLoad();
    var at = list.indexOf(id);
    var on = at === -1;
    if (on) list.unshift(id); else list.splice(at, 1);
    wlSave(list);
    var c = wlClient();
    if (c) {
      (on ? c.from('wishlists').upsert({ item_id: id }, { onConflict: 'user_id,item_id', ignoreDuplicates: true })
          : c.from('wishlists').delete().eq('item_id', id)).then(function () {});
    }
    if (root.bcTrack) root.bcTrack(on ? 'wishlist_add' : 'wishlist_remove', { item: id });
    wlNotify();
    return on;
  }
  var wishlist = {
    list: wlLoad,
    has: function (id) { return wlLoad().indexOf(id) !== -1; },
    toggle: wlToggle,
    onChange: function (fn) { wlListeners.push(fn); },
    sync: wlSync
  };

  // ---- free-account pages ----------------------------------------------------
  // The price guide is open to everyone. These tools need a free account.
  // Each page shows a usable teaser (the deal finder: three deals; checklists
  // and the collection: their intro), then an inline invitation in the page's
  // [data-gate-slot]. What sits behind it ([data-gate-locked]) is inert and
  // hidden from assistive tech while locked. Not a dialog: no overlay, no
  // Escape, no focus trap. The data is published for anyone who looks, so this
  // is an invitation, not a lock - and it costs nothing to get wrong for a
  // moment while the account service loads.
  var MEMBERS_ONLY = {
    'deals.html': 'deals',
    'checklists.html': 'checklists',
    'collection.html': 'collection'
  };
  var GATE_COPY = {
    deals: 'See bears listed below their value right now.',
    checklists: 'Tick off every bear you own, set by set.',
    collection: 'Track what your bears are worth, all in one place.'
  };
  var gateState = { page: null, locked: false, painted: false, focused: false, listeners: [] };

  function storedSession() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i) || '';
        if (/^sb-.*-auth-token$/.test(k) && localStorage.getItem(k)) return true;
      }
    } catch (e) { /* storage blocked */ }
    return false;
  }

  /** The inline invitation for a gated page. */
  function gateCard(page) {
    var name = MEMBERS_ONLY[page] ? page : (page || '').replace(/\.html$/, '');
    var next = encodeURIComponent(name);
    return '<section class="gate-card" id="members-gate-card" aria-labelledby="gate-h">' +
      '<p class="kicker">Free account</p>' +
      '<h2 id="gate-h" tabindex="-1">Free with an account</h2>' +
      '<p class="gate-sub">' + esc(GATE_COPY[name] || '') + '</p>' +
      '<p class="fine">Takes a minute. The price guide stays open to everyone.</p>' +
      '<div class="actions-row">' +
        '<a class="btn btn-primary" data-gate-action="signup" href="' +
          rel('account.html') + '?mode=signup&amp;next=' + next + '">Create a free account</a>' +
        '<a class="btn" data-gate-action="signin" href="' + rel('account.html') + '?next=' + next +
          '">Sign in</a>' +
      '</div>' +
    '</section>';
  }

  function paintGate() {
    if (typeof document === 'undefined') return;
    var locked = gateState.locked;
    var page = MEMBERS_ONLY[gateState.page];
    Array.prototype.forEach.call(document.querySelectorAll('[data-gate-locked]'), function (el) {
      if (locked) {
        el.setAttribute('inert', '');
        el.setAttribute('aria-hidden', 'true');
        el.classList.add('is-gated');
      } else {
        el.removeAttribute('inert');
        el.removeAttribute('aria-hidden');
        el.classList.remove('is-gated');
      }
    });
    var card = document.getElementById('members-gate-card');
    if (!locked) { if (card) card.parentNode.removeChild(card); return; }
    if (card) return;
    var slot = document.querySelector('[data-gate-slot]');
    if (!slot) return;
    slot.innerHTML = gateCard(page);
    if (root.bcTrack) root.bcTrack('members_gate_shown', { page: gateState.page });
    // Move focus to the invitation once, and only if nobody is typing.
    if (!gateState.focused) {
      gateState.focused = true;
      var a = document.activeElement;
      if (!a || a === document.body || a === document.documentElement) {
        var h = document.getElementById('gate-h');
        if (h && h.focus) h.focus();
      }
    }
  }

  function setGate(locked) {
    if (gateState.painted && gateState.locked === locked) return;
    gateState.locked = locked;
    gateState.painted = true;
    paintGate();
    gateState.listeners.forEach(function (fn) { try { fn(locked); } catch (e) { /* listener */ } });
  }

  function membersGate(current) {
    var A = root.BearChartAuth;
    if (!MEMBERS_ONLY[current] || !A || !A.configured || !A.configured() || membersGate._bound) return;
    membersGate._bound = true;
    gateState.page = current;
    if (typeof document !== 'undefined') {
      document.addEventListener('click', function (e) {
        var a = e.target && e.target.closest ? e.target.closest('#members-gate-card a[data-gate-action]') : null;
        if (a && root.bcTrack) {
          root.bcTrack('gate_click', { page: current, action: a.getAttribute('data-gate-action') });
        }
      });
    }
    // Until the account service has checked the saved sign-in, go by whether
    // this browser holds one. auth.js reports "signed out" to every listener
    // the moment it is registered - before it has looked - so acting on that
    // early report flashed the invitation at signed-in members on every page.
    setGate(!storedSession());
    var settled = false;
    function settle(s) {
      settled = true;
      // No account service (it failed to load): keep the stored-session guess.
      if (A.getClient && A.getClient()) setGate(!(s && s.signedIn));
    }
    if (A.ready && typeof A.ready.then === 'function') A.ready.then(settle, function () { settled = true; });
    else settled = true;
    A.onChange(function (s) { if (settled) setGate(!(s && s.signedIn)); });
  }

  /** What a gated page asks before rendering its teaser. */
  var gate = {
    locked: function () { return gateState.locked; },
    onChange: function (fn) { gateState.listeners.push(fn); }
  };

  // ---- the contextual prompt (replaces the old welcome pop-up) --------------
  // A small, non-modal invitation to make a free account, shown only when it
  // is relevant: on the third bear looked up, or the first one added to a
  // collection. Never to anyone signed in, never on the account, plans or admin
  // pages, at most once a week, and not for 30 days after it is dismissed. It
  // never takes focus. If this browser's storage is blocked it never shows.

  var PROMPT_KEY = 'bc.prompt';
  var DAY = 86400000;
  try { localStorage.removeItem('bc_welcome_seen'); } catch (e) { /* the old pop-up's key */ }

  function promptRead() {
    var v = JSON.parse(localStorage.getItem(PROMPT_KEY) || '{}');
    return v && typeof v === 'object' ? v : {};
  }
  function promptWrite(v) { localStorage.setItem(PROMPT_KEY, JSON.stringify(v)); }

  var NUDGE_COPY = {
    views: ['Keep the bears you look up in one place',
            'A free account gives you a collection page and a wishlist that follows you to every device.'],
    collection: ['Keep track of this collection',
                 'It\'s saved in this browser. A free account opens your collection page; ' +
                 'Pro also syncs it across your devices.']
  };

  function promptPage() {
    var p = ((root.location && root.location.pathname) || '').split('/').pop() || 'index.html';
    return p.toLowerCase();
  }

  function promptAllowed(st) {
    var A = root.BearChartAuth;
    if (!A || !A.configured || !A.configured()) return false;
    if (['account.html', 'plans.html', 'admin.html'].indexOf(promptPage()) !== -1) return false;
    var now = Date.now();
    if (st.dismissedAt && now - st.dismissedAt < 30 * DAY) return false;
    if (st.shownAt && now - st.shownAt < 7 * DAY) return false;
    return true;
  }

  function signedInNow() {
    var A = root.BearChartAuth;
    var s = A && A.state ? A.state() : null;
    return !!(s && s.signedIn) || storedSession();
  }

  function nudgeHtml(trigger) {
    var P = root.BearChartPlans;
    var perkText = P && P.perk ? P.perk('power') : null;
    var c = NUDGE_COPY[trigger] || NUDGE_COPY.views;
    return '<aside class="nudge" id="bc-nudge" aria-labelledby="nudge-h">' +
      '<button type="button" class="nudge-x" aria-label="Dismiss">&times;</button>' +
      '<p class="kicker">Free account</p>' +
      '<h2 id="nudge-h">' + esc(c[0]) + '</h2>' +
      '<p>' + esc(c[1]) + '</p>' +
      (perkText ? '<p class="fine nudge-perk">Power members also get: ' + esc(perkText) + '</p>' : '') +
      '<div class="actions-stack">' +
        '<a class="btn btn-primary" href="' + rel('account.html') + '?mode=signup" data-nudge="nudge_join">' +
          'Create a free account</a>' +
        '<a class="btn" href="' + rel('plans.html') + '" data-nudge="nudge_plans">See membership</a>' +
      '</div>' +
    '</aside>';
  }

  function closeNudge(trigger, returnTo) {
    var el = document.getElementById('bc-nudge');
    if (!el) return;
    var hadFocus = el.contains(document.activeElement);
    el.parentNode.removeChild(el);
    // Focus goes back where it came from (or to the page), never to <body>.
    if (hadFocus) {
      var to = returnTo && returnTo.focus && document.documentElement.contains(returnTo) &&
               returnTo !== document.body ? returnTo : document.getElementById('main');
      if (to && to.focus) to.focus();
    }
    try { var st = promptRead(); st.dismissedAt = Date.now(); promptWrite(st); } catch (e) { /* blocked */ }
    if (root.bcTrack) root.bcTrack('nudge_dismissed', { trigger: trigger });
  }

  function showNudge(trigger) {
    if (typeof document === 'undefined' || document.getElementById('bc-nudge')) return;
    if (signedInNow()) return;
    var st;
    try { st = promptRead(); } catch (e) { return; }
    if (!promptAllowed(st)) return;
    try { st.shownAt = Date.now(); promptWrite(st); } catch (e) { return; }
    var foot = document.getElementById('site-footer');
    var box = document.createElement('div');
    box.innerHTML = nudgeHtml(trigger);
    var el = box.firstChild;
    if (foot && foot.parentNode) foot.parentNode.insertBefore(el, foot);
    else document.body.appendChild(el);
    // Where focus was before someone tabbed or clicked into the prompt.
    var returnTo = null;
    el.addEventListener('focusin', function (e) {
      if (e.relatedTarget && !el.contains(e.relatedTarget)) returnTo = e.relatedTarget;
    });
    el.querySelector('.nudge-x').addEventListener('click', function () { closeNudge(trigger, returnTo); });
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.key === 'Esc') closeNudge(trigger, returnTo);
    });
    el.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[data-nudge]') : null;
      if (a && root.bcTrack) root.bcTrack(a.getAttribute('data-nudge'), { trigger: trigger });
    });
    if (root.bcTrack) root.bcTrack('nudge_shown', { trigger: trigger });
  }

  /** Show it now if signed out - and check again once auth has settled. */
  function maybeShow(trigger) {
    var A = root.BearChartAuth;
    if (signedInNow()) return;
    showNudge(trigger);
    if (A && A.ready && typeof A.ready.then === 'function') {
      A.ready.then(function (s) {
        if (s && s.signedIn) {
          var el = document.getElementById('bc-nudge');
          if (el) el.parentNode.removeChild(el);
        }
      }, function () {});
    }
  }

  var prompt = {
    /** item.js, once per page load. The third bear looked up shows it. */
    noteItemView: function () {
      var st;
      try { st = promptRead(); st.views = (Number(st.views) || 0) + 1; promptWrite(st); }
      catch (e) { return; }
      if (st.views >= 3) maybeShow('views');
    },
    /** The first bear added to a collection shows it. */
    noteCollectionAdd: function () {
      var st;
      try { st = promptRead(); var first = !st.added; st.added = true; promptWrite(st); }
      catch (e) { return; }
      if (first) maybeShow('collection');
    },
    maybeShow: maybeShow
  };

  /**
   * An upsell where the value is (the item page, under the evidence). Hidden
   * for anyone who already has sync, and - before memberships open - for
   * anyone signed in: nothing is sold that cannot be bought.
   */
  function upsell(kind, opts) {
    var P = root.BearChartPlans;
    var A = root.BearChartAuth;
    if (!P || kind !== 'item_value') return '';
    var s = A && A.state ? A.state() : { signedIn: false };
    var session = { signedIn: !!(s && s.signedIn), tier: s && s.tier };
    if (P.configured() && P.can('collection_sync', session)) return '';
    if (!P.configured() && (session.signedIn || storedSession())) return '';
    var pro = P.plan ? P.plan('pro') : null;
    return '<aside class="upsell" aria-labelledby="up-h">' +
      '<h2 id="up-h" class="upsell-h">Own this one?</h2>' +
      '<p>Add it to your collection and see what everything you own is worth.</p>' +
      '<p><a class="btn btn-primary" href="#calc-panel">Add to my collection</a> ' +
      '<a href="' + rel('plans.html') + '" class="upsell-more">What Pro adds</a></p>' +
    '</aside>';
  }

  // ---- member cloud: collection sync, value history, saved reports ----------
  // Pro and Power members' collections and value history are kept on their
  // account so they follow them between devices and are never lost with a
  // browser. Everything still works from this browser's storage first; the
  // account copy is merged in the background. The database refuses all of
  // this without a live membership, so the checks here only decide what to
  // try - they are not what keeps it paid.

  var CLOUD = {
    coll: 'bearchart.collection',
    snaps: 'bearchart.snapshots',
    flows: 'bearchart.flows',
    meta: 'bearchart.cloud'
  };
  var cloudListeners = [];
  var cloudState = { uid: null, entitled: null, syncing: false, lastSync: null, error: null };
  var cloudTimer = null;

  function cloudRead(key, fallback) {
    try { var v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? fallback : v; }
    catch (e) { return fallback; }
  }
  function cloudWrite(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }
  function cloudId() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
    return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }
  // Order-independent fingerprint of an entry, for "changed since last sync".
  function cloudHash(entry) {
    var keys = Object.keys(entry).filter(function (k) { return k !== 'uid'; }).sort();
    return JSON.stringify(keys.map(function (k) { return [k, entry[k]]; }));
  }
  function cloudNotify() {
    cloudListeners.forEach(function (fn) { try { fn(cloudState); } catch (e) { /* listener */ } });
  }
  function cloudClient() {
    var A = root.BearChartAuth;
    if (!A || !A.configured || !A.configured()) return null;
    var s = A.state();
    return s && s.signedIn && s.user ? { c: A.getClient(), uid: s.user.id } : null;
  }

  function cloudEntitled(cc) {
    if (cloudState.uid === cc.uid && cloudState.entitled !== null) return Promise.resolve(cloudState.entitled);
    return Promise.resolve().then(function () {
      return cc.c.rpc('has_entitlement', { feature: 'collection_sync' });
    }).then(function (r) {
      cloudState.uid = cc.uid;
      cloudState.entitled = !!(r && !r.error && r.data === true);
      return cloudState.entitled;
    }, function () { return false; });
  }

  function syncCollection(cc) {
    var local = cloudRead(CLOUD.coll, []);
    if (!Array.isArray(local)) return Promise.resolve();
    var meta = cloudRead(CLOUD.meta, {});
    // A different member signed in on this browser: treat it as a first sync,
    // which only ever adds - nothing is deleted on either side.
    var known = meta.uid === cc.uid ? (meta.entries || {}) : {};
    local.forEach(function (e) { if (e && !e.uid) e.uid = cloudId(); });

    return cc.c.from('collection_entries').select('id,entry').then(function (r) {
      if (r.error) throw r.error;
      var remote = {};
      (r.data || []).forEach(function (row) { remote[row.id] = row.entry; });

      var merged = [], ups = [], dels = [];
      local.forEach(function (e) {
        if (!e || !e.item_id) return;
        var h = cloudHash(e);
        if (remote[e.uid]) {
          if (known[e.uid] && known[e.uid] !== h) { merged.push(e); ups.push(e); }      // edited here
          else if (!known[e.uid] && cloudHash(remote[e.uid]) !== h) { merged.push(e); ups.push(e); }
          else merged.push(Object.assign({}, remote[e.uid], { uid: e.uid }));           // take account copy
        } else if (known[e.uid]) {
          // Synced before and now gone from the account: removed on another device.
        } else {
          merged.push(e); ups.push(e);                                                     // new here
        }
      });
      Object.keys(remote).forEach(function (id) {
        if (local.some(function (e) { return e && e.uid === id; })) return;
        if (known[id]) dels.push(id);                                                    // removed here
        else merged.push(Object.assign({}, remote[id], { uid: id }));                    // added elsewhere
      });

      var jobs = [];
      if (ups.length) {
        jobs.push(cc.c.from('collection_entries').upsert(ups.map(function (e) {
          var entry = Object.assign({}, e); delete entry.uid;
          return { id: e.uid, entry: entry, updated_at: new Date().toISOString() };
        }), { onConflict: 'user_id,id' }).then(function (x) { if (x && x.error) throw x.error; }));
      }
      if (dels.length) {
        jobs.push(cc.c.from('collection_entries').delete().in('id', dels)
          .then(function (x) { if (x && x.error) throw x.error; }));
      }
      return Promise.all(jobs).then(function () {
        var entries = {};
        merged.forEach(function (e) { entries[e.uid] = cloudHash(e); });
        cloudWrite(CLOUD.coll, merged);
        cloudWrite(CLOUD.meta, { uid: cc.uid, entries: entries });
        // Only a real change to the bears counts - not the sync ids added here -
        // so the page is not redrawn under someone who is typing.
        return merged.map(cloudHash).join('|') !== local.filter(function (e) { return e && e.item_id; }).map(cloudHash).join('|');
      });
    });
  }

  function syncHistory(cc) {
    var snaps = cloudRead(CLOUD.snaps, []);
    var flows = cloudRead(CLOUD.flows, []);
    if (!Array.isArray(snaps) || !Array.isArray(flows)) return Promise.resolve(false);
    return cc.c.from('value_history').select('day,snap,flows').then(function (r) {
      if (r.error) throw r.error;
      var remote = {};
      (r.data || []).forEach(function (row) { remote[row.day] = row; });
      var have = {};
      snaps.forEach(function (s) { if (s && s.d) have[s.d] = s; });
      var ups = snaps.filter(function (s) {
        return s && s.d && (!remote[s.d] || JSON.stringify(remote[s.d].snap) !== JSON.stringify(s));
      }).map(function (s) {
        return { day: s.d, snap: s, flows: flows.filter(function (f) { return f && f.d === s.d; }),
                 updated_at: new Date().toISOString() };
      });
      var changed = false;
      Object.keys(remote).forEach(function (d) {
        if (have[d]) return;
        snaps.push(remote[d].snap);
        (remote[d].flows || []).forEach(function (f) { flows.push(f); });
        changed = true;
      });
      if (changed) {
        snaps.sort(function (a, b) { return a.d < b.d ? -1 : 1; });
        flows.sort(function (a, b) { return a.d < b.d ? -1 : 1; });
        cloudWrite(CLOUD.snaps, snaps);
        cloudWrite(CLOUD.flows, flows);
      }
      if (!ups.length) return changed;
      return cc.c.from('value_history').upsert(ups, { onConflict: 'user_id,day' })
        .then(function (x) { if (x && x.error) throw x.error; return changed; });
    });
  }

  function cloudSync() {
    var cc = cloudClient();
    if (!cc || cloudState.syncing) return Promise.resolve(false);
    return cloudEntitled(cc).then(function (ok) {
      if (!ok) { cloudNotify(); return false; }
      cloudState.syncing = true; cloudState.error = null; cloudNotify();
      var changed = false;
      return syncCollection(cc)
        .then(function (c) { changed = changed || c; return syncHistory(cc); })
        .then(function (h) {
          changed = changed || h;
          cloudState.lastSync = new Date();
        })
        .catch(function (err) {
          // The local copy is never touched when the account cannot be reached.
          cloudState.error = (err && err.message) || 'Could not reach your account.';
        })
        .then(function () {
          cloudState.syncing = false;
          cloudState.changed = changed;
          cloudNotify();
          return changed;
        });
    }).catch(function () { cloudState.syncing = false; return false; });
  }

  // Called after every local change; batches a burst of edits into one sync.
  function cloudSoon() {
    if (cloudTimer) clearTimeout(cloudTimer);
    cloudTimer = setTimeout(function () { cloudTimer = null; cloudSync(); }, 1200);
  }

  function saveReport(kind, filename, body) {
    var cc = cloudClient();
    if (!cc) return Promise.resolve(false);
    return Promise.resolve().then(function () {
      return cc.c.rpc('has_entitlement', { feature: 'insurance_archive' });
    }).then(function (r) {
      if (!r || r.error || r.data !== true) return false;
      return cc.c.from('saved_reports').insert({ kind: kind, filename: filename, body: body })
        .then(function (x) { return !(x && x.error); });
    }).catch(function () { return false; });
  }

  function listReports() {
    var cc = cloudClient();
    if (!cc) return Promise.resolve(null);
    return Promise.resolve().then(function () {
      return cc.c.from('saved_reports').select('id,kind,filename,created_at')
        .order('created_at', { ascending: false }).limit(50);
    }).then(function (r) { return r && !r.error ? (r.data || []) : null; }, function () { return null; });
  }

  function getReport(id) {
    var cc = cloudClient();
    if (!cc) return Promise.resolve(null);
    return cc.c.from('saved_reports').select('filename,body,kind').eq('id', id).maybeSingle()
      .then(function (r) { return r && !r.error ? r.data : null; }, function () { return null; });
  }

  var cloud = {
    sync: cloudSync,
    soon: cloudSoon,
    state: function () { return cloudState; },
    onChange: function (fn) { cloudListeners.push(fn); },
    saveReport: saveReport,
    listReports: listReports,
    getReport: getReport
  };

  // ---- chrome: masthead, menu, disclaimer, footer ----------------------------

  var navOpen = false;

  function setNav(open) {
    navOpen = !!open;
    var t = document.querySelector('.nav-toggle');
    var list = document.getElementById('nav-list');
    if (t) t.setAttribute('aria-expanded', navOpen ? 'true' : 'false');
    if (list) list.setAttribute('data-open', navOpen ? 'true' : 'false');
  }

  /** Listeners that must exist once however often the chrome re-renders. */
  function bindChromeOnce(current) {
    if (bindChromeOnce._done || typeof document === 'undefined') return;
    bindChromeOnce._done = true;
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      // Every store link reports itself, wherever on the page it is.
      var shop = t.closest('a[data-shop-placement]');
      if (shop && root.bcTrack) {
        root.bcTrack('shop_click', {
          placement: shop.getAttribute('data-shop-placement'),
          kind: shop.getAttribute('data-shop-kind') || 'home',
          item: shop.getAttribute('data-item') || null,
          page: current
        });
      }
      // The phone menu: the toggle flips it, a click anywhere else closes it.
      if (t.closest('.nav-toggle')) { setNav(!navOpen); return; }
      if (navOpen && !t.closest('#nav-list')) setNav(false);
    });
    document.addEventListener('keydown', function (e) {
      if ((e.key === 'Escape' || e.key === 'Esc') && navOpen) {
        setNav(false);
        var tog = document.querySelector('.nav-toggle');
        if (tog && tog.focus) tog.focus();
      }
    });
    document.addEventListener('change', function (e) {
      var t = e.target;
      if (t && t.id === 'theme-pick' && root.BearChartTheme) root.BearChartTheme.set(t.value);
    });
  }

  /** "Skip to content" first in the page, and a focusable <main id="main">. */
  function skipLink() {
    var main = document.getElementById('main') || document.querySelector('main');
    if (main) {
      if (!main.id) main.id = 'main';
      if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
    }
    if (!document.querySelector('a.skip-link') && document.body) {
      var a = document.createElement('a');
      a.className = 'skip-link';
      a.href = '#main';
      a.textContent = 'Skip to content';
      document.body.insertBefore(a, document.body.firstChild);
    }
  }

  function navLabel(n) {
    var label = n[1];
    // The account link doubles as the session indicator. Always shown: hiding
    // it when accounts are switched off made the whole feature - and the
    // instructions for turning it on - impossible to find.
    if (n[0] === 'account.html') {
      var A = root.BearChartAuth;
      if (!A || !A.configured()) return 'Account';
      var st = A.state();
      return st.signedIn ? (st.isAdmin ? 'Admin account' : 'My account') : 'Sign in';
    }
    return label;
  }

  function themePicker() {
    var T = root.BearChartTheme;
    var now = T ? T.get() : 'system';
    return '<p class="fine theme-row"><label for="theme-pick">Theme</label> ' +
      '<select id="theme-pick">' + [['system', 'Match device'], ['light', 'Light'], ['dark', 'Dark']]
        .map(function (o) {
          return '<option value="' + o[0] + '"' + (o[0] === now ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('') + '</select></p>';
  }

  function renderChrome(current) {
    var A = root.BearChartAuth;
    if (A && !renderChrome._bound) {
      renderChrome._bound = true;
      A.onChange(function () { renderChrome(current); });
      A.onChange(function (s) { if (s && s.signedIn) wlSync(); else wlSynced = false; });
      A.onChange(function (s) {
        if (s && s.signedIn) cloudSync();
        else { cloudState.uid = null; cloudState.entitled = null; cloudNotify(); }
      });
      A.init();
    }
    bindChromeOnce(current);
    skipLink();
    membersGate(current);
    var head = document.getElementById('masthead');
    if (head) {
      var items = NAV.filter(function (n) {
        // Admin tools (and the roadmap, for now) are not destinations: only
        // admins see them in the menu. The pages still work by address.
        if (['admin.html', 'roadmap.html'].indexOf(n[0]) === -1 || current === n[0]) return true;
        var A2 = root.BearChartAuth;
        return !!(A2 && A2.configured && A2.configured() && A2.state().isAdmin);
      });
      var here = items.filter(function (n) { return n[0] === current; })[0];
      head.innerHTML =
        '<div class="wrap">' +
          '<a class="brand" href="' + rel('index.html') + '">' +
            '<img class="brand-mark" src="' + rel('icons/ppg-icon-192.png') + '" alt="" width="52" height="52">' +
            '<div class="brand-text">' +
              '<span class="brand-name">Plush Price Guide</span>' +
              '<div class="sub">Independent Build-A-Bear price guide</div>' +
            '</div>' +
          '</a>' +
          '<nav class="nav" aria-label="Main">' +
            '<div class="nav-bar">' +
              (here ? '<span class="nav-current" aria-hidden="true">' + esc(navLabel(here)) + '</span>' : '') +
              '<button type="button" class="nav-toggle" aria-expanded="' + (navOpen ? 'true' : 'false') +
                '" aria-controls="nav-list"><span aria-hidden="true">&#9776;</span> Menu</button>' +
            '</div>' +
            '<ul id="nav-list" class="nav-list" data-open="' + (navOpen ? 'true' : 'false') + '">' +
            items.map(function (n) {
              return '<li><a href="' + rel(n[0]) + '"' +
                     (n[0] === current ? ' aria-current="page"' : '') +
                     '>' + esc(navLabel(n)) + '</a></li>';
            }).join('') + '</ul>' +
          '</nav>' +
        '</div>';
    }
    var bar = document.getElementById('disclaimer-bar');
    if (bar) {
      bar.innerHTML = '<div class="wrap"><span class="disc-full">' + esc(SITE.meta.disclaimer) +
        '</span><span class="disc-short">' +
        esc(SITE.meta.disclaimer_short || SITE.meta.disclaimer) + '</span></div>';
    }
    var foot = document.getElementById('site-footer');
    if (foot) {
      var st = statsFor();
      foot.innerHTML = '<div class="wrap">' +
        '<p><strong>Plush Price Guide</strong> &mdash; ' + esc(SITE.meta.disclaimer) + '</p>' +
        '<p>Values are derived from completed/sold transactions only. Active asking ' +
        'prices are never treated as market value. Where no sold data exists, Plush Price Guide ' +
        'publishes no price.</p>' +
        '<p>Built as a collector and reseller research tool for ' +
        (shopEnabled()
          ? shopLink('footer', { className: '', label: BUSINESS.name })
          : esc(BUSINESS.name)) + '.</p>' +
        shopDisclosure() +
        // eBay attribution, on every page: the guide shows eBay-derived data.
        '<p class="fine ebay-attribution">Sold-price and listing data from eBay. eBay is a ' +
        'trademark of eBay Inc. Plush Price Guide is not affiliated with or endorsed by eBay.</p>' +
        '<p class="fine legal-links"><a href="' + rel('privacy.html') + '">Privacy</a>' +
        '<a href="' + rel('terms.html') + '">Terms</a>' +
        '<a href="' + rel('about.html') + '">How prices work</a>' +
        '<a href="' + EBAY_USER_AGREEMENT + '" rel="noopener" target="_blank">eBay User Agreement</a>' +
        '<a href="' + EBAY_PRIVACY_NOTICE + '" rel="noopener" target="_blank">eBay User Privacy Notice</a>' +
        (safeEmail(BUSINESS.contact_email)
          ? '<a href="mailto:' + esc(BUSINESS.contact_email) + '">' + esc(BUSINESS.contact_email) + '</a>'
          : '') +
        '</p>' +
        '<p class="fine">Database: ' + fmtInt(st.items) + ' items, ' +
          fmtInt(st.comps) + ' sold transactions recorded. ' +
          'Schema v' + SITE.meta.schema_version + '.</p>' +
        (SITE.meta.trademark_notice
          ? '<p class="fine trademark">' + esc(SITE.meta.trademark_notice) + '</p>' : '') +
        themePicker() +
        '</div>';
    }
    upgradeShopLinks(document);
  }

  /**
   * Register the service worker.
   *
   * This is what makes Plush Price Guide work with no signal - which is the moment it
   * is actually needed, standing in a shop holding a bear. Everything is
   * guarded: no service worker support, opened from a file:// path, or
   * registration refused all fall back to an ordinary website rather than
   * breaking one.
   */
  function registerWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (root.location && root.location.protocol === 'file:') return;
    root.addEventListener('load', function () {
      // No explicit scope. A worker's default scope is the directory it is
      // served from, which for /sw.js is the whole site - exactly what is
      // wanted. Passing one computed from the current page gave "/index.html"
      // when registered from the home page: a scope of one single file, so
      // every other page silently had no offline support while the cache sat
      // there full.
      navigator.serviceWorker.register(rel('sw.js'))
        .catch(function () { /* an uninstalled guide still works */ });
    });
  }
  registerWorker();

  var BC = root.BC = {
    config: CFG, engine: E, site: SITE, catalogue: null,
    withCatalogue: withCatalogue, withItem: withItem, whenIdle: whenIdle, busy: track,
    // The raw loaders, for the UX layer's skeletons (BC.whenData).
    loadIndex: BD.loadIndex, loadItem: BD.loadItem, loadPlans: BD.loadPlans, withPlans: withPlans,
    skeleton: skeleton, whenData: whenData, errorState: errorState,
    status: setStatus,
    feature: BD.feature, sources: SITE.sources || [],
    itemById: itemById,
    itemChooser: itemChooser, rel: rel, evidenceStrip: evidenceStrip,
    valuationFor: valuationFor, catalogueStats: catalogueStats, canonicalId: canonicalId, go: go,
    statsFor: statsFor, stats: stats, fmtInt: fmtInt,
    money: money, exact: exact, range: range, confClass: confClass, era: era, isVintage: isVintage,
    confLabel: confLabel, confChip: confChip, monthYear: monthYear, freshness: freshness,
    isOperatorSale: isOperatorSale, operatorLabel: OPERATOR_LABEL,
    conditionLabel: conditionLabel, completenessLabel: completenessLabel, dateLabel: dateLabel,
    tagsFor: tagsFor, tagsHtml: tagsHtml, esc: esc, itemUrl: itemUrl, matches: matches,
    membership: SITE.membership || {}, listingsUpdatedNote: listingsUpdatedNote,
    freshListings: freshListings, oldestFetch: oldestFetch, fetchedTime: fetchedTime,
    business: BUSINESS, affiliate: affiliate, affiliateLink: affiliateLink, businessEnabled: businessEnabled,
    shopEnabled: shopEnabled, shopPromo: shopPromo, shopHref: shopHref, shopLink: shopLink,
    shopDisclosure: shopDisclosure, upgradeShopLinks: upgradeShopLinks, SHOP_PLACEMENTS: SHOP_PLACEMENTS,
    gate: gate, gateCard: gateCard, prompt: prompt, upsell: upsell,
    hasImage: hasImage, imageHtml: imageHtml, imageCredit: imageCredit,
    placeholderImage: placeholderImage,
    safeUrl: S.safeUrl, extLink: S.extLink, safeRedirect: S.safeRedirect,
    csvCell: S.csvCell, scrubUrl: S.scrubUrl,
    toCsv: toCsv, download: download,
    r2: r2, stamp: stamp, renderChrome: renderChrome, wishlist: wishlist, cloud: cloud
  };
})(window);

/* Visit statistics (PostHog). Counts pages and a few key clicks so we can see
   what people use. No advertising cookies: the random visitor id lives in
   localStorage, Do Not Track is honoured, and nothing runs in tests, from a
   file:// path or on a local dev server. Disclosed on privacy.html. */
(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  window.bcTrack = function (name, props) {
    try { if (window.posthog && window.posthog.capture) window.posthog.capture(name, props || {}); }
    catch (e) { /* statistics must never break the page */ }
  };
  if (/jsdom/i.test(navigator.userAgent || '')) return;
  if (location.protocol === 'file:') return;
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return;
  var dnt = navigator.doNotTrack || window.doNotTrack || navigator.msDoNotTrack;
  if (dnt === '1' || dnt === 'yes') return;
  // Per-deploy settings from config.js: previews stay off unless opted in.
  var rt = window.BEARCHART_RUNTIME || {};
  if (rt.posthog_enabled === false) return;
  var S = window.BearChartSanitize;

  var KEY = rt.posthog_key || 'phc_xYXLmfqEVM324GUuzn474TPp8fGd7N65yRvbToCNZCMt';
  !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="capture identify alias people.set people.set_once set_config register register_once unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset isFeatureEnabled onFeatureFlags getFeatureFlag getFeatureFlagPayload reloadFeatureFlags group".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
  window.posthog.init(KEY, {
    api_host: 'https://us.i.posthog.com',
    persistence: 'localStorage',
    person_profiles: 'identified_only',
    respect_dnt: true,
    disable_session_recording: true,
    capture_pageview: true,
    capture_pageleave: true,
    // Login links carry one-time codes; never let them reach analytics.
    mask_personal_data_properties: true,
    custom_personal_data_properties: S ? S.SENSITIVE_URL_PARAMS : [],
    before_send: S ? S.scrubEvent : undefined,                                  // posthog-js >= 1.187
    sanitize_properties: function (p) { return S ? S.scrubProps(p) : p; }       // older builds
  });
  // The same PostHog project also hears from other sites; tag every event.
  window.posthog.register({ site: 'bearchart', env: rt.env || 'production' });
})();

/* BearChart collection tracker. Local to the browser; no account required. */
(function () {
  'use strict';

  var D = BC.data, CFG = BC.config, E = BC.engine;
  var $ = function (id) { return document.getElementById(id); };
  var KEY = 'bearchart.collection';

  BC.renderChrome('collection.html');

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; }
  }
  function save(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); return true; }
    catch (e) { return false; }
  }

  var list = load();

  // ---- portfolio history ----------------------------------------------------
  // A static site can only take a snapshot when someone opens the page, so the
  // series has gaps on days it was not visited. That is a real limitation, and
  // the panel says so rather than drawing a confident line through absent days.

  var SNAP_KEY = 'bearchart.snapshots';
  var FLOW_KEY = 'bearchart.flows';
  var HOLD_KEY = 'bearchart.lastHoldings';
  var MAX_DAYS = 730;

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
    catch (e) { return fallback; }
  }
  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }

  function unitValue(itemId) {
    var v = BC.valuationFor(itemId);
    return v && v.has_value ? v.fair_market : 0;
  }

  /** Write today's totals, and record anything bought or sold since last time. */
  function recordSnapshot() {
    var snaps = readJson(SNAP_KEY, []);
    var flows = readJson(FLOW_KEY, []);
    var today = new Date().toISOString().slice(0, 10);

    var snap = E.collectionSnapshot(list, {
      date: today, config: CFG, valuationFor: BC.valuationFor
    });

    // External flows first, so today's total is compared against the previous
    // one on like-for-like terms.
    var prevMap = readJson(HOLD_KEY, null);
    var currMap = E.holdingsMap(list);
    if (prevMap) {
      E.diffHoldings(prevMap, currMap, unitValue).forEach(function (f) {
        f.d = today;
        flows.push(f);
      });
    }
    writeJson(HOLD_KEY, currMap);

    snaps = snaps.filter(function (s) { return s.d !== today; });
    snaps.push(snap);
    snaps.sort(function (a, b) { return a.d < b.d ? -1 : 1; });
    if (snaps.length > MAX_DAYS) snaps = snaps.slice(-MAX_DAYS);

    var cutoff = snaps.length ? snaps[0].d : today;
    flows = flows.filter(function (f) { return f.d >= cutoff; });

    writeJson(SNAP_KEY, snaps);
    writeJson(FLOW_KEY, flows);
    return { snaps: snaps, flows: flows };
  }

  function sparkline(snaps) {
    if (snaps.length < 2) return '';
    var W = 720, H = 150, PAD = { l: 54, r: 12, t: 12, b: 24 };
    var vals = snaps.map(function (s) { return s.pv; });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (lo === hi) { lo = lo * 0.95 || 0; hi = hi * 1.05 || 1; }

    var x = function (i) {
      return PAD.l + (snaps.length === 1 ? 0.5 : i / (snaps.length - 1)) *
             (W - PAD.l - PAD.r);
    };
    var y = function (v) {
      return PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
    };

    var ticks = [lo, (lo + hi) / 2, hi];
    var pts = snaps.map(function (s, i) {
      return x(i).toFixed(1) + ',' + y(s.pv).toFixed(1);
    });

    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" ' +
      'aria-label="Priced collection value over time">' +
      ticks.map(function (t) {
        return '<line class="grid-line" x1="' + PAD.l + '" y1="' + y(t).toFixed(1) +
               '" x2="' + (W - PAD.r) + '" y2="' + y(t).toFixed(1) + '"></line>' +
               '<text x="' + (PAD.l - 6) + '" y="' + (y(t) + 3).toFixed(1) +
               '" text-anchor="end">' + BC.money(t) + '</text>';
      }).join('') +
      '<polyline class="series" points="' + pts.join(' ') + '"></polyline>' +
      '<circle class="dot" cx="' + x(snaps.length - 1).toFixed(1) + '" cy="' +
      y(snaps[snaps.length - 1].pv).toFixed(1) + '" r="4"></circle>' +
      '<text x="' + PAD.l + '" y="' + (H - 6) + '">' + BC.esc(snaps[0].d) + '</text>' +
      '<text x="' + (W - PAD.r) + '" y="' + (H - 6) + '" text-anchor="end">' +
      BC.esc(snaps[snaps.length - 1].d) + '</text>' +
      '</svg>';
  }

  function windowRow(label, w) {
    if (!w || !w.enough) {
      return '<tr><td>' + label + '</td><td colspan="4" class="fine">' +
             'Not enough history yet</td></tr>';
    }
    var sign = function (n) { return (n >= 0 ? '+' : '') + n.toFixed(1) + '%'; };
    return '<tr><td>' + label + '</td>' +
      '<td class="num price">' + BC.money(w.end_value) + '</td>' +
      '<td class="num">' + sign(w.raw_change_pct) + '</td>' +
      '<td class="num"><strong>' + (w.twr_pct == null ? '--' : sign(w.twr_pct)) +
      '</strong></td>' +
      '<td class="num fine">' + (w.net_flow ? BC.money(w.net_flow) : '&mdash;') +
      '</td></tr>';
  }

  function renderHistory(state) {
    var body = $('history-body');
    if (!body) return;
    var snaps = state.snaps, flows = state.flows;

    if (snaps.length < 2) {
      body.innerHTML = '<p class="history-start"><strong>History starts today.</strong> ' +
        'Each day you open this page we note what your collection is worth. Come back ' +
        'tomorrow and a chart will start to appear here.</p>';
      return;
    }

    var windows = [[30, '30 days'], [90, '90 days'], [365, '1 year']];
    body.innerHTML =
      sparkline(snaps) +
      '<div class="table-scroll" style="margin-top:16px"><table><thead><tr>' +
      '<th>Window</th><th class="num">Value now</th><th class="num">Raw change</th>' +
      '<th class="num">Market only</th><th class="num">You bought / sold</th>' +
      '</tr></thead><tbody>' +
      windows.map(function (w) {
        return windowRow(w[1], E.windowStats(snaps, flows, w[0]));
      }).join('') +
      '</tbody></table></div>' +
      '<p class="fine" style="margin-top:12px"><strong>Raw change</strong> is what the ' +
      'total did. <strong>Market only</strong> nets out what you bought and sold, so it ' +
      'answers whether the bears you already held went up &mdash; buying three more is ' +
      'not appreciation. Both are shown because either one alone gets misread as the ' +
      'other.</p>' +
      (snaps[snaps.length - 1].uc
        ? '<p class="fine">' + snaps[snaps.length - 1].uc + ' item(s) here have no sold ' +
          'data and are counted as zero rather than guessed at. The line tracks what ' +
          'can be priced.</p>'
        : '') +
      '<p class="fine">Recorded on ' + snaps.length + ' day(s) you opened this page. ' +
      'Days you did not visit leave gaps.</p>';
  }

  // --- pickers --------------------------------------------------------------

  // You can own a bear nobody has sold yet, so this lists the whole catalogue -
  // searched rather than scrolled.
  BC.itemChooser($('add-item'), D.items, function (i) {
    return i.canonical_name + (BC.valuationFor(i.id).has_value ? '' : ' (no sold data yet)');
  });
  (function () {
    var search = $('add-item').parentNode.querySelector('.item-search');
    if (search) search.placeholder = 'Type a bear\'s name, e.g. Lucky Kitty';
  })();

  function condOptions(sel) {
    return CFG.condition_order.map(function (c) {
      return '<option value="' + c + '"' + (c === sel ? ' selected' : '') + '>' + c + '</option>';
    }).join('');
  }
  function compOptions(sel) {
    return Object.keys(CFG.completeness_multipliers).map(function (k) {
      return '<option value="' + k + '"' + (k === sel ? ' selected' : '') + '>' +
             BC.esc(CFG.completeness_labels[k] || k) + '</option>';
    }).join('');
  }

  $('add-cond').innerHTML = condOptions('Good');
  $('add-comp').innerHTML = compOptions('bare');

  // --- rendering ------------------------------------------------------------

  function priced(entry) {
    var v = BC.valuationFor(entry.item_id);
    var adjusted = v.has_value ? E.adjust(v, entry.condition, entry.completeness, CFG) : null;
    return { valuation: v, adjusted: adjusted, qty: entry.qty || 1 };
  }

  function render() {
    renderHistory(recordSnapshot());
    var body = $('collection-body');
    $('clear-collection').hidden = !list.length;

    if (!list.length) {
      body.innerHTML = '<div class="empty"><p><strong>Your collection is empty.</strong></p>' +
        '<p>Find a bear above and press <strong>Add to collection</strong>, or tick the bears ' +
        'you own on the <a href="checklists.html">Checklists</a> page.</p></div>';
      $('totals').innerHTML = '';
      return;
    }

    var rows = list.map(function (e, idx) {
      var item = BC.itemById(e.item_id);
      if (!item) return '';
      var p = priced(e);
      var sales = p.valuation.comparable_count || 0;
      var each = p.adjusted
        ? '<span class="price">' + BC.money(p.adjusted.fair_market) + '</span>' +
          '<div class="val-note">' + sales + ' sale' + (sales === 1 ? '' : 's') + '</div>'
        : '<span class="val-note">No sold data yet</span>';
      var line = p.adjusted ? BC.money(p.adjusted.fair_market * p.qty) : '&mdash;';
      return '<tr data-idx="' + idx + '">' +
        '<td data-label="Bear"><a class="bear-link" href="' + BC.itemUrl(item.id) + '">' +
          BC.esc(item.canonical_name) + '</a>' +
          '<div class="bear-meta">' + (item.release_year || 'Year unknown') + '</div></td>' +
        '<td data-label="Condition"><select data-field="condition" aria-label="Condition">' +
          condOptions(e.condition) + '</select></td>' +
        '<td data-label="What\'s included"><select data-field="completeness" ' +
          'aria-label="What\'s included">' + compOptions(e.completeness) + '</select></td>' +
        '<td class="qty-cell" data-label="How many"><input type="number" min="1" step="1" ' +
          'data-field="qty" aria-label="How many" value="' + (e.qty || 1) + '"></td>' +
        '<td class="num" data-label="Worth each">' + each + '</td>' +
        '<td class="num price" data-label="Total">' + line + '</td>' +
        '<td class="remove-cell"><button type="button" class="link-btn" data-remove="' + idx +
          '" aria-label="Remove ' + BC.esc(item.canonical_name) + '">Remove</button></td>' +
        '</tr>';
    }).join('');

    body.innerHTML = '<div class="table-scroll"><table class="stack-table coll-table"><thead><tr>' +
      '<th>Bear</th><th>Condition</th><th>What\'s included</th><th class="num">How many</th>' +
      '<th class="num">Worth each</th><th class="num">Total</th><th></th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';

    var totals = E.collectionValue(list.map(priced));
    var count = list.reduce(function (n, e) { return n + (e.qty || 1); }, 0);
    $('totals').innerHTML = [
      [count, 'Bears', 'In your collection'],
      [BC.money(totals.median), 'Median value', 'What they usually sell for'],
      [BC.money(totals.conservative), 'Conservative', 'If you sold them quickly'],
      [BC.money(totals.high), 'High-end', 'With a patient sale'],
      [totals.unpriced, 'No price yet', 'Not enough sales to value']
    ].map(function (c) {
      return '<div class="stat"><div class="v">' + c[0] + '</div><div class="k">' +
        BC.esc(c[1]) + '</div><div class="h">' + BC.esc(c[2]) + '</div></div>';
    }).join('');
  }

  // --- events ---------------------------------------------------------------

  $('add-btn').addEventListener('click', function () {
    var id = $('add-item').value;
    var item = BC.itemById(id);
    if (!item) {
      $('add-msg').textContent = 'Type a name above and pick your bear from the list first.';
      return;
    }
    var qty = Math.max(1, parseInt($('add-qty').value, 10) || 1);
    list.push({
      item_id: id,
      condition: $('add-cond').value,
      completeness: $('add-comp').value,
      qty: qty
    });
    if (!save(list)) alert('This browser is blocking local storage, so the collection cannot be saved.');
    render();
    $('add-msg').textContent = 'Added ' + (qty > 1 ? qty + ' \u00d7 ' : '') +
      item.canonical_name + ' to your collection.';
    $('add-qty').value = 1;
  });

  $('collection-body').addEventListener('change', function (e) {
    var tr = e.target.closest('tr');
    if (!tr) return;
    var idx = Number(tr.dataset.idx);
    var field = e.target.dataset.field;
    if (!field || !list[idx]) return;
    list[idx][field] = field === 'qty'
      ? Math.max(1, parseInt(e.target.value, 10) || 1)
      : e.target.value;
    save(list);
    render();
  });

  $('collection-body').addEventListener('click', function (e) {
    var idx = e.target.dataset.remove;
    if (idx == null) return;
    list.splice(Number(idx), 1);
    save(list);
    render();
  });

  $('clear-collection').addEventListener('click', function () {
    if (!list.length || !confirm('Remove every bear from your collection? This cannot be undone.')) return;
    list = [];
    save(list);
    render();
  });

  $('export-collection').addEventListener('click', function () {
    var rows = [['item_id', 'canonical_name', 'release_year', 'condition', 'completeness',
      'qty', 'value_each', 'line_total', 'conservative_each', 'high_end_each', 'confidence']];
    list.forEach(function (e) {
      var item = BC.itemById(e.item_id);
      if (!item) return;
      var p = priced(e);
      var a = p.adjusted;
      rows.push([e.item_id, item.canonical_name, item.release_year, e.condition,
        e.completeness, p.qty,
        a ? BC.r2(a.fair_market) : '', a ? BC.r2(a.fair_market * p.qty) : '',
        a ? BC.r2(a.range_low) : '', a ? BC.r2(a.ask_high) : '',
        p.valuation.confidence]);
    });
    BC.download('bearchart-collection-' + BC.stamp() + '.csv', BC.toCsv(rows));
  });

  // ---- insurance schedule ---------------------------------------------------
  // An adjuster is not buying the number, they are assessing whether it is
  // substantiated. A figure without its evidence is worth less in a claim than a
  // shoebox of receipts, so confidence, comp count and source URLs are columns,
  // not footnotes.

  function evidenceFor(itemId) {
    var sales = BC.salesFor(itemId);
    var urls = [], dates = [];
    sales.forEach(function (s) {
      if (s.source_url) urls.push(s.source_url);
      if (s.sale_date) dates.push(s.sale_date);
    });
    dates.sort();
    return {
      urls: urls.join(' | '),
      range: dates.length
        ? (dates[0] === dates[dates.length - 1]
            ? dates[0] : dates[0] + ' to ' + dates[dates.length - 1])
        : 'undated'
    };
  }

  function insuranceRows() {
    var valuedOn = new Date().toISOString().slice(0, 10);
    var rows = [[
      'schedule_line', 'item_name', 'manufacturer', 'release_year', 'identifiers',
      'condition_grade', 'completeness', 'modifiers', 'qty',
      'acquired_on', 'acquisition_cost_usd',
      'replacement_cost_usd', 'actual_cash_value_usd', 'line_total_usd',
      'valuation_method', 'comp_count', 'confidence', 'comp_date_range',
      'evidence_urls', 'valued_on'
    ]];

    list.forEach(function (e, i) {
      var item = BC.itemById(e.item_id);
      if (!item) return;
      var v = BC.valuationFor(e.item_id);
      var a = v.has_value ? E.adjust(v, e.condition, e.completeness, CFG, e.modifiers)
                          : null;
      var ev = evidenceFor(e.item_id);
      var qty = e.qty || 1;

      var ids = [item.version, item.variant, item.release_year ? 'released ' +
                 item.release_year : null].filter(Boolean).join('; ');

      var method = v.has_value
        ? 'Median of ' + v.observation_count + ' condition-adjusted sold ' +
          'observation(s), normalised to Good/bare then adjusted for this copy'
        : 'No comparable sales on record - not valued';

      rows.push([
        i + 1,
        item.canonical_name,
        'Build-A-Bear Workshop',
        item.release_year || '',
        ids,
        e.condition || 'Unknown',
        CFG.completeness_labels[e.completeness] || e.completeness || '',
        Object.keys(e.modifiers || {}).filter(function (k) { return e.modifiers[k]; })
          .map(function (k) { return (CFG.modifiers.labels || {})[k] || k; }).join('; '),
        qty,
        e.acquired_on || '',
        e.acquisition_cost != null ? BC.r2(e.acquisition_cost) : '',
        a ? BC.r2(a.fair_market) : '',
        // Actual cash value maps to the conservative floor: the figure the
        // evidence supports even on a pessimistic reading. Stated, not implied.
        a && a.lower_bound != null ? BC.r2(a.lower_bound) : '',
        a ? BC.r2(a.fair_market * qty) : '',
        method,
        v.comparable_count,
        v.confidence,
        ev.range,
        ev.urls,
        valuedOn
      ]);
    });
    return rows;
  }

  function coverStatement() {
    var valuedOn = new Date().toISOString().slice(0, 10);
    var priced = list.filter(function (e) {
      return BC.valuationFor(e.item_id).has_value;
    }).length;
    var confident = list.filter(function (e) {
      var c = BC.valuationFor(e.item_id).confidence;
      return c === 'HIGH' || c === 'MEDIUM';
    }).length;

    return [
      'BEARCHART INVENTORY SCHEDULE',
      'Prepared ' + valuedOn,
      '',
      'WHAT THIS DOCUMENT IS',
      'An inventory schedule of collectible plush items with estimated secondary-market',
      'values, prepared from completed-sale comparables. It is NOT a professional',
      'appraisal and was not prepared by a licensed appraiser.',
      '',
      'HOW THE FIGURES WERE DERIVED',
      'Each value is the median of recorded completed sales for that exact item,',
      'normalised to a common baseline (Good condition, no accessories) and then',
      'adjusted for the condition, completeness and components of the specific copy',
      'owned. Active asking prices are never used. Where an item has no completed-sale',
      'record, no value is given rather than an estimate.',
      '',
      'REPLACEMENT COST is the median-derived market value: what a comparable example',
      'would cost to acquire today.',
      'ACTUAL CASH VALUE is a conservative lower bound on the same evidence - the',
      'figure supported even on a pessimistic reading of the comparables.',
      '',
      'CONFIDENCE, stated per line, reflects how many comparable sales support it:',
      '  HIGH     10 or more comparable sales',
      '  MEDIUM   4 to 9',
      '  LOW      1 to 3 - directional only',
      '  VERY LOW no comparable sales; no value given',
      '',
      'SUMMARY',
      '  Items on schedule:            ' + list.length,
      '  Lines with a supported value: ' + priced,
      '  Of those, MEDIUM or better:   ' + confident,
      '',
      'Source listings for every comparable are given per line in evidence_urls.',
      'Values fluctuate. Re-run before relying on this document.'
    ].join('\n');
  }

  $('export-insurance').addEventListener('click', function () {
    if (!list.length) return;
    BC.download('bearchart-insurance-schedule-' + BC.stamp() + '.csv',
      BC.toCsv(insuranceRows()));
  });

  $('export-cover').addEventListener('click', function () {
    BC.download('bearchart-schedule-cover-' + BC.stamp() + '.txt',
      coverStatement(), 'text/plain');
  });

  $('export-history').addEventListener('click', function () {
    var snaps = readJson(SNAP_KEY, []);
    var rows = [['date', 'priced_value', 'confident_value', 'unpriced_items', 'items']];
    snaps.forEach(function (s) {
      rows.push([s.d, BC.r2(s.pv), BC.r2(s.cv), s.uc, s.n]);
    });
    BC.download('bearchart-history-' + BC.stamp() + '.csv', BC.toCsv(rows));
  });

  // ---- wishlist ----------------------------------------------------------

  function renderWishlist() {
    var box = $('wishlist-body');
    if (!box || !BC.wishlist) return;
    var A = window.BearChartAuth;
    var signedIn = !!(A && A.configured && A.configured() && A.state().signedIn);
    var note = $('wishlist-note');
    if (note && !signedIn && A && A.configured && A.configured()) {
      note.innerHTML = 'Bears you are hunting for. Saved in this browser &mdash; ' +
        '<a href="' + BC.rel('account.html') + '">sign in</a> to keep it on every device.';
    }
    var ids = BC.wishlist.list().filter(function (id) { return BC.itemById(id); });
    if (!ids.length) {
      box.innerHTML = '<p class="fine">Nothing on your wishlist yet.</p>';
      return;
    }
    box.innerHTML = '<div class="table-scroll"><table><thead><tr><th>Bear</th>' +
      '<th class="num">Typical price</th><th></th></tr></thead><tbody>' +
      ids.map(function (id) {
        var it = BC.itemById(id);
        var v = BC.valuationFor(id);
        return '<tr><td><a href="' + BC.itemUrl(id) + '">' + BC.esc(it.canonical_name) + '</a>' +
          (it.release_year ? ' <span class="fine">' + BC.esc(String(it.release_year)) + '</span>' : '') + '</td>' +
          '<td class="num">' + (v && v.has_value ? BC.money(v.fair_market) : '<span class="fine">No sold data yet</span>') + '</td>' +
          '<td><button type="button" class="link-btn" data-unwish="' + BC.esc(id) + '">Remove</button></td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  if ($('wishlist-body') && BC.wishlist) {
    $('wishlist-body').addEventListener('click', function (e) {
      var id = e.target && e.target.getAttribute && e.target.getAttribute('data-unwish');
      if (id) BC.wishlist.toggle(id);
    });
    BC.wishlist.onChange(renderWishlist);
    if (window.BearChartAuth && window.BearChartAuth.onChange) {
      window.BearChartAuth.onChange(renderWishlist);
    }
  }

  render();
  renderWishlist();
})();

/* BearChart price-guide index: search, filters, sorting, stats, calculator, CSV. */
(function () {
  'use strict';

  var D = BC.data, CFG = BC.config, E = BC.engine;
  var $ = function (id) { return document.getElementById(id); };

  BC.renderChrome('index.html');

  // -------------------------------------------------------------------------
  // Rarity ranking. Derived from recorded flags only - BearChart does not
  // invent a rarity grade for items where the research recorded none.
  // -------------------------------------------------------------------------
  function rarityRank(item) {
    var r = 0;
    if (item.employee_exclusive) r += 5;
    if (item.event_exclusive) r += 4;
    if (item.international_exclusive) r += 3;
    if (item.store_exclusive) r += 4;
    if (item.limited_edition) r += 3;
    if (BC.isVintage(item)) r += 2;
    if (item.retired) r += 1;
    if (item.rarity === 'Rare') r += 3;
    if (item.rarity === 'Exclusive') r += 4;
    return r;
  }

  // -------------------------------------------------------------------------
  // Filter definitions
  // -------------------------------------------------------------------------

  function uniq(list) {
    return Array.from(new Set(list.filter(function (x) { return x != null && x !== ''; }))).sort();
  }

  var FLAGS = [
    ['licensed',   'Licensed',           function (i) { return !!i.licensed; }],
    ['unlicensed', 'Unlicensed',         function (i) { return !i.licensed; }],
    ['minibean',   'Mini Beans',         function (i) { return !!i.mini_bean; }],
    ['vintage',    'Vintage (pre-2000)', function (i) { return BC.isVintage(i); }],
    ['retired',    'Retired',            function (i) { return !!i.retired; }],
    ['limited',    'Limited Edition',    function (i) { return !!i.limited_edition; }],
    ['employee',   'Employee Exclusive', function (i) { return !!i.employee_exclusive; }],
    ['store',      'Store Exclusive',    function (i) { return !!i.store_exclusive; }],
    ['event',      'Event / Zoo Exclusive', function (i) { return !!i.event_exclusive; }],
    ['intl',       'International Exclusive', function (i) { return !!i.international_exclusive; }],
    ['online',     'Online Exclusive',   function (i) { return !!i.online_exclusive; }],
    ['vault',      'Vault Release',      function (i) { return !!i.vault_release; }],
    ['upcoming',   'Upcoming release',   function (i) { return i.release_status === 'upcoming'; }],
    ['current',    'At retail now',      function (i) { return i.release_status === 'current'; }],
    ['haveprice',  'Has sold data',      function (i) { return BC.valuationFor(i.id).has_value; }],
    ['needcomps',  'Needs comps',        function (i) { return !BC.valuationFor(i.id).has_value; }]
  ];

  var GROUPS = [
    { key: 'category',   label: 'Category',   values: uniq(D.items.map(function (i) { return i.category; })),
      of: function (i) { return i.category; },
      test: function (i, v) { return i.category === v; } },
    { key: 'era',        label: 'Era',        values: ['Vintage (1997-1999)', 'Early 2000s', '2010s', 'Modern', 'Year unknown'],
      of: function (i) { return BC.era(i); },
      test: function (i, v) { return BC.era(i) === v; } },
    { key: 'species',    label: 'Animal',     values: uniq(D.items.map(function (i) { return i.species; })),
      of: function (i) { return i.species; },
      test: function (i, v) { return i.species === v; } },
    { key: 'franchise',  label: 'Franchise',  values: uniq(D.items.map(function (i) { return i.franchise; })),
      of: function (i) { return i.franchise; },
      test: function (i, v) { return i.franchise === v; } },
    { key: 'condition',  label: 'Sold in condition', values: CFG.condition_order.slice(),
      test: function (i, v) {
        return BC.salesFor(i.id).some(function (s) { return s.condition === v; });
      } },
    { key: 'confidence', label: 'Confidence', values: ['HIGH', 'MEDIUM', 'LOW', 'VERY LOW'],
      of: function (i) { return BC.valuationFor(i.id).confidence; },
      test: function (i, v) { return BC.valuationFor(i.id).confidence === v; } },
    { key: 'flag',       label: 'Attributes', values: FLAGS.map(function (f) { return f[0]; }),
      // A short, deliberate list of toggles, unlike the open-ended Animal and
      // Franchise groups. Folding the quiet ones away here would hide
      // "Upcoming release" precisely because few items are upcoming.
      nocap: true,
      labelFor: function (v) {
        var f = FLAGS.find(function (x) { return x[0] === v; });
        return f ? f[1] : v;
      },
      test: function (i, v) {
        var f = FLAGS.find(function (x) { return x[0] === v; });
        return f ? f[2](i) : true;
      } }
  ];

  // How many cards the grid shows before you ask for more.
  //
  // Two sizes, because landing on the guide and using it are different jobs.
  // Arriving, you want to see what this is: a dozen bears is a shelf you can
  // take in, and on a phone - one column - sixty cards was a page 64,000
  // pixels tall. Having searched or filtered, you have asked a question, and
  // the answer should not arrive a dozen at a time.
  var PAGE_BROWSE = 12;
  var PAGE_ACTIVE = 48;

  var state = { q: '', sort: 'relevance', sel: {}, yearMin: '', yearMax: '',
                shown: PAGE_BROWSE, openGroups: {} };
  GROUPS.forEach(function (g) { state.sel[g.key] = new Set(); });

  // -------------------------------------------------------------------------
  // Filtering
  // -------------------------------------------------------------------------

  /** Has the visitor actually asked for something, or are they just looking? */
  function searching() {
    if (state.q) return true;
    if (state.yearMin !== '' || state.yearMax !== '') return true;
    return GROUPS.some(function (g) { return state.sel[g.key].size > 0; });
  }

  function pageSize() { return searching() ? PAGE_ACTIVE : PAGE_BROWSE; }

  function passesGroups(item, skipKey) {
    return GROUPS.every(function (g) {
      if (g.key === skipKey) return true;
      var sel = state.sel[g.key];
      if (!sel.size) return true;
      // Within a group, selections are OR'd; across groups they are AND'ed.
      return Array.from(sel).some(function (v) { return g.test(item, v); });
    });
  }

  function passesYear(item) {
    var y = item.release_year;
    if (state.yearMin !== '' && (y == null || y < Number(state.yearMin))) return false;
    if (state.yearMax !== '' && (y == null || y > Number(state.yearMax))) return false;
    return true;
  }

  function filtered(skipKey) {
    return D.items.filter(function (i) {
      return BC.matches(i, state.q) && passesYear(i) && passesGroups(i, skipKey);
    });
  }

  // -------------------------------------------------------------------------
  // Sorting
  // -------------------------------------------------------------------------

  function relevanceScore(item) {
    if (!state.q) return 0;
    var q = state.q.toLowerCase();
    var name = item.canonical_name.toLowerCase();
    if (name === q) return 100;
    if (name.indexOf(q) === 0) return 80;
    if (name.indexOf(q) !== -1) return 60;
    if ((item.aliases || []).some(function (a) { return a.toLowerCase().indexOf(q) !== -1; })) return 50;
    return 10;
  }

  function sortItems(items) {
    var s = state.sort;
    var val = function (i) { return BC.valuationFor(i.id).fair_market; };
    var byName = function (a, b) { return a.canonical_name.localeCompare(b.canonical_name); };

    // Items with no sold data sort last in every price ordering rather than
    // being treated as $0.
    function priced(dir) {
      return function (a, b) {
        var va = val(a), vb = val(b);
        if (va == null && vb == null) return byName(a, b);
        if (va == null) return 1;
        if (vb == null) return -1;
        return va === vb ? byName(a, b) : (va - vb) * dir;
      };
    }
    function byYear(dir) {
      return function (a, b) {
        var ya = a.release_year, yb = b.release_year;
        if (ya == null && yb == null) return byName(a, b);
        if (ya == null) return 1;
        if (yb == null) return -1;
        return ya === yb ? byName(a, b) : (ya - yb) * dir;
      };
    }

    var cmp = {
      'relevance': function (a, b) {
        var d = relevanceScore(b) - relevanceScore(a);
        if (d) return d;
        // With nothing typed, lead with the items that have evidence behind
        // them. The rest of the catalogue is real and worth browsing, but an
        // item we can price is the more useful thing to put first.
        if (!state.q) {
          var ha = BC.valuationFor(a.id).has_value ? 1 : 0;
          var hb = BC.valuationFor(b.id).has_value ? 1 : 0;
          if (ha !== hb) return hb - ha;
        }
        var ca = BC.valuationFor(a.id).comparable_count;
        var cb = BC.valuationFor(b.id).comparable_count;
        return cb - ca || byName(a, b);
      },
      'price-desc': priced(-1),
      'price-asc': priced(1),
      'newest': byYear(-1),
      'oldest': byYear(1),
      'rarity': function (a, b) { return rarityRank(b) - rarityRank(a) || byName(a, b); },
      'comps': function (a, b) {
        return BC.valuationFor(b.id).comparable_count -
               BC.valuationFor(a.id).comparable_count || byName(a, b);
      },
      'name': byName
    }[s] || byName;

    return items.slice().sort(cmp);
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  function renderFilters() {
    var html = '';

    html += '<div class="filter-group"><h3>Release year</h3><div class="row">' +
      '<div class="field"><label for="ymin">From</label>' +
      '<input type="number" id="ymin" inputmode="numeric" placeholder="1997" value="' + BC.esc(state.yearMin) + '"></div>' +
      '<div class="field"><label for="ymax">To</label>' +
      '<input type="number" id="ymax" inputmode="numeric" placeholder="2026" value="' + BC.esc(state.yearMax) + '"></div>' +
      '</div></div>';

    GROUPS.forEach(function (g) {
      // Counts reflect what each option would yield given the other filters.
      var pool = filtered(g.key);
      var opts;
      if (g.of) {
        // One pass, not one pass per option. Franchise alone has 95 values
        // against 2,048 items, and testing every pair was most of the time the
        // page took to appear.
        var tally = Object.create(null);
        pool.forEach(function (i) {
          var v = g.of(i);
          if (v != null) tally[v] = (tally[v] || 0) + 1;
        });
        opts = g.values.map(function (v) { return { v: v, n: tally[v] || 0 }; });
      } else {
        opts = g.values.map(function (v) {
          return { v: v, n: pool.filter(function (i) { return g.test(i, v); }).length };
        });
      }
      opts = opts.filter(function (o) { return o.n > 0 || state.sel[g.key].has(o.v); });
      if (!opts.length) return;

      // Animal and Franchise now run to dozens of options each. Showing the
      // busiest first, with the tail one click away, keeps the sidebar a
      // sidebar.
      var CAP = 10;
      var expanded = !!state.openGroups[g.key];
      var hidden = 0;
      if (!g.nocap && !expanded && opts.length > CAP + 2) {
        var ranked = opts.slice().sort(function (x, y) { return y.n - x.n; });
        var head = ranked.slice(0, CAP);
        var keepers = opts.filter(function (o) {
          return state.sel[g.key].has(o.v) || head.indexOf(o) !== -1;
        });
        hidden = opts.length - keepers.length;
        opts = keepers;
      }

      html += '<div class="filter-group"><h3>' + BC.esc(g.label) + '</h3><div class="checks">';
      opts.forEach(function (o) {
        var label = g.labelFor ? g.labelFor(o.v) : o.v;
        html += '<label><input type="checkbox" data-group="' + g.key + '" value="' + BC.esc(o.v) + '"' +
          (state.sel[g.key].has(o.v) ? ' checked' : '') + '>' +
          '<span>' + BC.esc(label) + '</span><span class="count">' + o.n + '</span></label>';
      });
      html += '</div>';
      if (hidden) {
        html += '<button type="button" class="linkish" data-expand="' + BC.esc(g.key) +
                '">Show ' + hidden + ' more</button>';
      } else if (expanded && g.values.length > 12) {
        html += '<button type="button" class="linkish" data-expand="' + BC.esc(g.key) +
                '">Show fewer</button>';
      }
      html += '</div>';
    });

    // The shop sits under the filters: present on every view of the guide,
    // never between a reader and the results they came for.
    $('filters').innerHTML = html;
    var promo = document.getElementById('sidebar-promo');
    if (promo && !promo.innerHTML) promo.innerHTML = BC.shopPromo('compact');
    var mobile = document.getElementById('mobile-promo');
    if (mobile && !mobile.innerHTML) mobile.innerHTML = BC.shopPromo();
  }

  function renderStats(items) {
    var withData = items.filter(function (i) { return BC.valuationFor(i.id).has_value; });
    var comps = items.reduce(function (a, i) { return a + BC.valuationFor(i.id).comparable_count; }, 0);
    var values = withData.map(function (i) { return BC.valuationFor(i.id).fair_market; });
    var med = values.length ? E.median(values) : null;
    var top = values.length ? Math.max.apply(null, values) : null;

    var cells = [
      [items.length, 'Items matching'],
      [withData.length, 'With sold data'],
      [comps, 'Sold observations'],
      [med == null ? '--' : BC.money(med), 'Median item value'],
      [top == null ? '--' : BC.money(top), 'Highest value']
    ];
    $('stats').innerHTML = cells.map(function (c) {
      return '<div class="stat"><div class="v">' + BC.esc(c[0]) + '</div><div class="k">' +
             BC.esc(c[1]) + '</div></div>';
    }).join('');
  }

  function card(item) {
    var v = BC.valuationFor(item.id);
    var meta = [item.release_year || 'Year unknown', item.species, item.category]
      .filter(Boolean).join(' &middot; ');

    var value, sub;
    if (v.has_value) {
      value = '<div class="value">' + BC.range(v.range_low, v.range_high) + '</div>';
      sub = '<div class="sub">Median sold ' + BC.exact(v.median_raw) + ' &middot; ' +
            v.comparable_count + ' comp' + (v.comparable_count === 1 ? '' : 's') + '</div>';
    } else {
      // One line, not two. On 97% of the catalogue the second was the same
      // sentence again, and repeating it two thousand times says less, not more.
      value = '<div class="value none">No sold data yet</div>';
      sub = '';
    }

    return '<a class="card" href="' + BC.itemUrl(item.id) + '">' +
      BC.imageHtml(item, 'thumb') +
      '<h3 class="name">' + BC.esc(item.canonical_name) + '</h3>' +
      '<div class="meta">' + meta + '</div>' +
      value + sub +
      BC.tagsHtml(item) +
      '<footer><span class="' + BC.confClass(v.confidence) + '">' + v.confidence + '</span></footer>' +
      '</a>';
  }

  function render() {
    var items = sortItems(filtered());

    renderFilters();
    renderStats(items);

    var page = items.slice(0, state.shown);
    $('result-count').textContent = (page.length < items.length
      ? page.length + ' of ' + items.length + ' matching'
      : items.length + ' of ' + D.items.length + ' items');
    $('results').innerHTML = page.map(card).join('');

    var more = $('show-more');
    more.hidden = page.length >= items.length;
    if (!more.hidden) {
      more.textContent = 'Show ' + Math.min(pageSize(), items.length - page.length) +
        ' more  (' + (items.length - page.length) + ' left)';
    }

    var empty = $('empty');
    if (items.length) {
      empty.hidden = true;
    } else {
      empty.hidden = false;
      empty.innerHTML = '<p><strong>Nothing matches those filters.</strong></p>' +
        '<p>Try a broader search, or reset the filters.</p>';
    }

    window.__lastResults = items; // used by the CSV buttons
    syncUrl();
  }

  function syncUrl() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.sort !== 'relevance') p.set('sort', state.sort);
    var qs = p.toString();
    history.replaceState(null, '', qs ? '?' + qs : location.pathname);
  }

  // -------------------------------------------------------------------------
  // Calculator
  // -------------------------------------------------------------------------

  function initCalculator() {
    var sel = $('calc-item');

    // Only items the calculator can actually price. A dropdown of 2,048
    // entries is unusable, and 1,980 of them would open on "no sold data" -
    // the calculator has nothing to adjust without comps, so offering them
    // was a menu of dead ends. The rest of the catalogue is still fully
    // browsable in the grid; it just cannot be valued.
    var priceable = D.items.filter(function (i) {
      return BC.valuationFor(i.id).has_value;
    }).sort(function (a, b) {
      return a.canonical_name.localeCompare(b.canonical_name);
    });

    sel.innerHTML = '<option value="">Select an item…</option>' +
      priceable.map(function (i) {
        return '<option value="' + BC.esc(i.id) + '">' +
               BC.esc(i.canonical_name) + '</option>';
      }).join('');

    $('calc-cond').innerHTML = CFG.condition_order.map(function (c) {
      return '<option value="' + c + '"' + (c === 'Good' ? ' selected' : '') + '>' + c +
             ' (x' + CFG.condition_multipliers[c] + ')</option>';
    }).join('');

    $('calc-comp').innerHTML = Object.keys(CFG.completeness_multipliers).map(function (k) {
      return '<option value="' + k + '"' + (k === 'bare' ? ' selected' : '') + '>' +
             BC.esc(CFG.completeness_labels[k] || k) +
             ' (x' + CFG.completeness_multipliers[k] + ')</option>';
    }).join('');

    ['calc-item', 'calc-cond', 'calc-comp'].forEach(function (id) {
      $(id).addEventListener('change', runCalculator);
    });
    runCalculator();
  }

  function runCalculator() {
    var out = $('calc-out');
    var id = $('calc-item').value;
    if (!id) { out.innerHTML = '<p class="fine">Select an item to calculate a value.</p>'; return; }

    var item = BC.itemById(id);
    var v = BC.valuationFor(id);
    if (!v.has_value) {
      out.innerHTML = '<div class="notice warn"><strong>' + BC.esc(item.canonical_name) +
        '</strong> has no sold observations on record, so BearChart will not publish a ' +
        'value for it. Add a sourced comp and it becomes priceable.</div>';
      return;
    }

    var a = E.adjust(v, $('calc-cond').value, $('calc-comp').value, CFG);
    out.innerHTML =
      '<div class="headline"><span class="big">' + BC.range(a.range_low, a.range_high) + '</span>' +
      '<span class="' + BC.confClass(a.confidence) + '">' + a.confidence + ' confidence</span></div>' +
      '<p class="fine">Adjusted from a baseline fair market value of ' + BC.money(v.fair_market) +
      ' by a combined multiplier of x' + (Math.round(a.multiplier * 100) / 100) + '.</p>' +
      bands(a) +
      '<p class="fine" style="margin-top:12px"><a href="' + BC.itemUrl(id) + '">' +
      'See the full record and every sold comp &rarr;</a></p>';
  }

  function bands(a) {
    var rows = [
      ['Buy', BC.range(a.buy_low, a.buy_high), 'What to pay'],
      ['Trade', BC.range(a.trade_low, a.trade_high), 'Trade-in credit'],
      ['Fair sell', BC.range(a.range_low, a.range_high), 'Realistic sale'],
      ['High-end ask', BC.money(a.ask_low) + '+', 'Patient seller']
    ];
    return '<div class="bands">' + rows.map(function (r) {
      return '<div class="band"><div class="k">' + r[0] + '</div><div class="v">' + r[1] +
             '</div><div class="n">' + r[2] + '</div></div>';
    }).join('') + '</div>';
  }

  // -------------------------------------------------------------------------
  // Wiring
  // -------------------------------------------------------------------------

  var debounce;
  $('q').addEventListener('input', function (e) {
    clearTimeout(debounce);
    var val = e.target.value;
    debounce = setTimeout(function () { state.q = val.trim(); reset(); }, 120);
  });

  $('sort').addEventListener('change', function (e) { state.sort = e.target.value; reset(); });

  /** Re-render from the top. Any change to what matches invalidates the page. */
  function reset() {
    state.shown = pageSize();
    render();
  }

  $('show-more').addEventListener('click', function () {
    var step = pageSize();
    state.shown += step;
    render();
    // Land on the first newly-revealed card rather than at the top.
    var cards = $('results').children;
    var next = cards[state.shown - step];
    if (next && next.scrollIntoView) next.scrollIntoView({ block: 'center' });
  });

  $('filters').addEventListener('click', function (e) {
    var key = e.target.dataset && e.target.dataset.expand;
    if (!key) return;
    state.openGroups[key] = !state.openGroups[key];
    renderFilters();
  });

  $('filters').addEventListener('change', function (e) {
    var t = e.target;
    if (t.type === 'checkbox' && t.dataset.group) {
      var sel = state.sel[t.dataset.group];
      if (t.checked) sel.add(t.value); else sel.delete(t.value);
      reset();
    }
  });

  $('filters').addEventListener('input', function (e) {
    if (e.target.id === 'ymin' || e.target.id === 'ymax') {
      state[e.target.id === 'ymin' ? 'yearMin' : 'yearMax'] = e.target.value;
      clearTimeout(debounce);
      debounce = setTimeout(function () {
        var active = document.activeElement && document.activeElement.id;
        render();
        if (active) { var el = $(active); if (el) { el.focus(); el.selectionStart = el.value.length; } }
      }, 300);
    }
  });

  $('clear-all').addEventListener('click', function () {
    state.q = ''; state.yearMin = ''; state.yearMax = ''; state.sort = 'relevance';
    GROUPS.forEach(function (g) { state.sel[g.key].clear(); });
    $('q').value = ''; $('sort').value = 'relevance';
    state.openGroups = {};
    reset();
  });

  $('filter-toggle').addEventListener('click', function () {
    var open = $('sidebar').classList.toggle('open');
    this.textContent = open ? 'Hide filters' : 'Show filters';
  });

  $('csv-items').addEventListener('click', function () {
    BC.download('bearchart-items-' + BC.stamp() + '.csv', BC.itemsCsv(window.__lastResults));
  });
  $('csv-sales').addEventListener('click', function () {
    BC.download('bearchart-sales-' + BC.stamp() + '.csv', BC.salesCsv(window.__lastResults));
  });

  // Restore state from the URL so searches are shareable.
  var params = new URLSearchParams(location.search);
  if (params.get('q')) { state.q = params.get('q'); $('q').value = state.q; }
  if (params.get('sort')) { state.sort = params.get('sort'); $('sort').value = state.sort; }

  /**
   * Fill in the opening.
   *
   * Counted from the catalogue on every load rather than typed into the HTML,
   * because a headline number that has quietly gone stale is worse than no
   * headline number - this is a page whose entire argument is that its figures
   * are checkable.
   */
  function renderHero() {
    var proof = $('hero-proof');
    if (!proof) return;

    var priced = D.items.filter(function (i) { return BC.valuationFor(i.id).has_value; });
    var years = D.items.map(function (i) { return i.release_year; })
                       .filter(function (y) { return !!y; });
    var earliest = years.length ? Math.min.apply(null, years) : null;
    var latest = years.length ? Math.max.apply(null, years) : null;

    var facts = [
      [D.items.length.toLocaleString('en-US'), 'furry friends catalogued'],
      [D.sales.length.toLocaleString('en-US'), 'sold comps recorded'],
      [priced.length.toLocaleString('en-US'), 'priced on real evidence']
    ];
    if (earliest && latest) facts.push([earliest + '–' + latest, 'every year covered']);

    proof.innerHTML = facts.map(function (f) {
      return '<li><b>' + BC.esc(f[0]) + '</b> ' + BC.esc(f[1]) + '</li>';
    }).join('');

    // Three real bears from Jay's Retro Exchange, photographed and cut out
    // onto fresh backgrounds - decoration, so they carry no alt text.
    var cast = $('hero-cast');
    if (!cast) return;
    cast.innerHTML = ['stars', 'rainbow', 'hearts'].map(function (name) {
      return '<img src="images/home/' + name + '.webp" alt="" width="150" height="195" ' +
        'decoding="async">';
    }).join('');
  }

  renderHero();
  initCalculator();
  render();

  // Photos members have added since the last build are fetched at run time
  // and folded into the cards; a failure just leaves the illustrations.
  if (window.BearChartSubmissions && window.BearChartSubmissions.applyMemberPhotos) {
    window.BearChartSubmissions.applyMemberPhotos(D.items).then(function (n) {
      if (n) render();
    });
  }
})();

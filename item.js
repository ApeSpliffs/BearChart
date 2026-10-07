/* BearChart item detail page. */
(function () {
  'use strict';

  var D = BC.data, CFG = BC.config, E = BC.engine;
  BC.renderChrome('index.html');

  var root = document.getElementById('item-root');

  /* Two ways in, and both have to work.
     - item/classic-brown-teddy.html : the generated page, one real URL per
       bear, which is what a search engine can index and a person can link to.
     - item.html?id=classic-brown-teddy : the original query-string form, still
       live so older links and bookmarks do not rot. */
  function itemIdFromLocation() {
    var q = new URLSearchParams(location.search).get('id');
    if (q) return q;
    var m = /(^|\/)item\/([^/]+)\.html$/.exec(location.pathname);
    return m ? decodeURIComponent(m[2]) : null;
  }

  var id = itemIdFromLocation();
  var item = id && BC.itemById(id);

  if (!item) {
    root.innerHTML = '<div class="panel empty"><p><strong>Item not found.</strong></p>' +
      '<p><a href="' + BC.rel('index.html') + '">Back to the price guide</a></p></div>';
    return;
  }

  document.title = item.canonical_name + ' — BearChart';

  var sales = BC.salesFor(item.id).slice().sort(function (a, b) {
    if (a.sale_date && b.sale_date) return b.sale_date.localeCompare(a.sale_date);
    if (a.sale_date) return -1;
    if (b.sale_date) return 1;
    return b.sold_price - a.sold_price;
  });
  var v = BC.valuationFor(item.id);

  // --- pieces ---------------------------------------------------------------

  function priceRow(label, value, note) {
    return '<div class="band"><div class="k">' + label + '</div><div class="v">' + value +
           '</div><div class="n">' + note + '</div></div>';
  }

  function valuationPanel() {
    if (!v.has_value) {
      // This is the most-seen panel on the site: 1,974 of 2,042 items have no
      // sold data. It used to be a warning box and an apology. It is the page
      // a search lands somebody on, so it now leads with what IS known, and
      // asks for the one thing that would change it.
      var known = [
        ['Released', item.release_year || null],
        ['Line', item.variant || null],
        ['Animal', item.species || null],
        ['Franchise', item.franchise || null]
      ].filter(function (r) { return r[1]; });


      return '<div class="panel unpriced">' +
        '<p class="unpriced-eyebrow">No value published</p>' +
        '<h2 class="unpriced-head">Nobody has told us what this one sells for</h2>' +
        '<p class="unpriced-lede">BearChart has no recorded sold transactions for the ' +
        BC.esc(item.canonical_name) + ', so it publishes <strong>no price</strong>. ' +
        'An estimate with nothing behind it is a guess, and a guess printed next to a ' +
        'dollar sign gets treated as a fact.</p>' +

        (known.length
          ? '<div class="unpriced-known">' +
            '<h3>What is known</h3><dl class="kv">' +
            known.map(function (r) {
              return '<dt>' + BC.esc(r[0]) + '</dt><dd>' + BC.esc(r[1]) + '</dd>';
            }).join('') + '</dl>' +
            '</div>'
          : '') +

        (item.notes ? '<p class="fine unpriced-note">' + BC.esc(item.notes) + '</p>' : '') +

        // Only offer the jump when there is somewhere to jump to: the submit
        // panel is absent when accounts are not configured for the site.
        '<p class="unpriced-ask">One sourced sale is all it takes to change this page.' +
        ((window.BearChartSubmissions && window.BearChartSubmissions.configured())
          ? '<a class="unpriced-jump" href="#submit-panel">Know what one sold for?</a>'
          : '') + '</p>' +
        '</div>';
    }

    return '<div class="panel">' +
      '<h3>Estimated market value</h3>' +
      '<div class="headline">' +
        '<span class="big">' + BC.range(v.range_low, v.range_high) + '</span>' +
        '<span class="' + BC.confClass(v.confidence) + '">' + v.confidence + ' confidence</span>' +
        '<span class="fine">' + v.comparable_count + ' comparable sale' +
        (v.comparable_count === 1 ? '' : 's') +
        (v.aggregate_count ? ' across ' + v.observation_count + ' observations' : '') +
        '</span>' +
      '</div>' +
      '<p class="fine" style="margin-top:6px">Median sold ' + BC.exact(v.median_raw) +
      ' &middot; fair market value ' + BC.money(v.fair_market) +
      ' at Good condition with no extras.</p>' +
      // Show the footing, do not just assert it.
      BC.evidenceStrip(v) +
      '<div class="bands">' +
        priceRow('Buy', BC.range(v.buy_low, v.buy_high), 'What to pay') +
        priceRow('Trade', BC.range(v.trade_low, v.trade_high), 'Trade-in credit') +
        priceRow('Fair sell', BC.range(v.sell_low, v.sell_high), 'Realistic sale') +
        priceRow('High-end ask', BC.money(v.ask_low) + '+', 'Patient seller') +
      '</div>' +
      '</div>';
  }

  function sellPanel() {
    if (!BC.businessEnabled() || !v.has_value) return '';
    var b = BC.business;
    var contact = b.contact_url
      ? '<a class="btn btn-primary" href="' + BC.esc(b.contact_url) +
        '" target="_blank" rel="noopener">Get an offer</a>'
      : '<a class="btn btn-primary" href="mailto:' + BC.esc(b.contact_email) +
        '?subject=' + encodeURIComponent('Selling: ' + item.canonical_name) +
        '">Get an offer</a>';

    return '<div class="panel">' +
      '<h2>Sell yours to ' + BC.esc(b.name) + '</h2>' +
      '<p class="fine">' + BC.esc(b.blurb) + '</p>' +
      '<div class="headline" style="margin-top:10px">' +
        '<span class="big">' + BC.range(v.buy_low, v.buy_high) + '</span>' +
        '<span class="fine">for a copy in Good condition &mdash; more for NWT or ' +
        'complete with extras</span>' +
      '</div>' +
      '<p style="margin-top:14px">' + contact + '</p>' +
      '<div class="notice" style="margin-top:14px"><strong>Disclosure.</strong> ' +
      BC.esc(b.disclosure) + '</div>' +
      '</div>';
  }

  // --- putting something back ------------------------------------------------

  function S() { return window.BearChartSubmissions; }

  /**
   * "I know what one sold for."
   *
   * The most valuable thing a reader can give this site. The form asks for
   * provenance rather than just a number, because a price with nothing behind
   * it cannot be checked, and an unverifiable price is what this whole guide
   * exists not to publish.
   */
  function submitPanel() {
    if (!S() || !S().configured()) return '';
    var signedIn = S().signedIn();

    return '<div class="panel" id="submit-panel">' +
      '<h2>Know what one sold for?</h2>' +
      '<p class="fine">' + (v.has_value
        ? 'Every added sale narrows the range and raises the confidence on this page.'
        : 'This item has no recorded sales, so BearChart publishes no value for it. ' +
          'One sourced sale is all it takes to change that.') + '</p>' +
      (signedIn
        ? '<div class="row" style="margin-top:14px">' +
            '<div class="field"><label for="sub-price">Sold for (USD)</label>' +
              '<input type="number" id="sub-price" min="0.01" step="0.01" ' +
              'inputmode="decimal" placeholder="42.00"></div>' +
            '<div class="field"><label for="sub-date">Date sold</label>' +
              '<input type="date" id="sub-date"></div>' +
            '<div class="field"><label for="sub-market">Where</label>' +
              '<select id="sub-market">' +
                '<option value="">Choose…</option>' +
                '<option>eBay</option><option>Mercari</option>' +
                '<option>Facebook Marketplace</option><option>Etsy</option>' +
                '<option>Poshmark</option><option>In person</option>' +
                '<option>Other</option>' +
              '</select></div>' +
          '</div>' +
          '<div class="row">' +
            '<div class="field"><label for="sub-cond">Condition</label>' +
              '<select id="sub-cond"></select></div>' +
            '<div class="field"><label for="sub-comp">Completeness</label>' +
              '<select id="sub-comp"></select></div>' +
            '<div class="field" style="flex:2 1 240px">' +
              '<label for="sub-url">Listing link or id <span class="fine">(optional, ' +
              'but it is what lets a reviewer confirm it)</span></label>' +
              '<input type="url" id="sub-url" placeholder="https://www.ebay.com/itm/…"></div>' +
          '</div>' +
          '<p style="margin-top:12px">' +
            '<button type="button" class="primary" id="do-submit">Submit this sale</button>' +
          '</p>' +
          '<p id="submit-msg" class="fine" hidden></p>' +
          '<div class="notice" style="margin-top:12px"><strong>What happens next.</strong> ' +
          'Submissions go to a review queue. Nothing you enter here changes a ' +
          'published value until a reviewer has checked it &mdash; including ' +
          'submissions from the people who run this site.</div>'
        : '<p style="margin-top:12px"><a class="btn btn-primary" href="' +
          BC.rel('account.html') + '">Sign in to add a sale</a></p>' +
          '<p class="fine">An account is needed because a reviewer has to be able ' +
          'to ask you about it. An anonymous price is not evidence, it is a rumour.</p>') +
      '</div>';
  }

  /** "Something on this page is wrong." No account needed. */
  function reportPanel() {
    if (!S() || !S().configured()) return '';
    return '<details class="panel" id="report-panel">' +
      '<summary style="cursor:pointer;font-weight:700;color:var(--brown-deep)">' +
      'Something wrong on this page?</summary>' +
      '<p class="fine" style="margin-top:10px">This catalogue was assembled from ' +
      'collector records and a community wiki, and some of it is certainly wrong. ' +
      'Telling us costs you a click and saves the next person.</p>' +
      '<div class="row" style="margin-top:10px">' +
        '<div class="field" style="flex:1 1 220px"><label for="rep-reason">What is wrong</label>' +
          '<select id="rep-reason">' + S().reasons.map(function (r) {
            return '<option value="' + BC.esc(r[0]) + '">' + BC.esc(r[1]) + '</option>';
          }).join('') + '</select></div>' +
        '<div class="field" style="flex:2 1 260px"><label for="rep-note">Anything else ' +
          '<span class="fine">(optional)</span></label>' +
          '<input type="text" id="rep-note" maxlength="500" ' +
          'placeholder="e.g. this is the same bear as the 1999 one"></div>' +
      '</div>' +
      '<p style="margin-top:10px"><button type="button" id="do-report">Send report</button></p>' +
      '<p id="report-msg" class="fine" hidden></p>' +
      '</details>';
  }

  function bindSubmissions() {
    // The same vocabulary the engine normalises against, so a submission
    // arrives already speaking the language the valuation is computed in.
    var cond = document.getElementById('sub-cond');
    if (cond) {
      cond.innerHTML = CFG.condition_order.map(function (c) {
        return '<option value="' + BC.esc(c) + '"' +
               (c === 'Good' ? ' selected' : '') + '>' + BC.esc(c) + '</option>';
      }).join('');
    }
    var comp = document.getElementById('sub-comp');
    if (comp) {
      comp.innerHTML = Object.keys(CFG.completeness_multipliers).map(function (k) {
        return '<option value="' + BC.esc(k) + '"' +
               (k === 'unknown' ? ' selected' : '') + '>' +
               BC.esc(CFG.completeness_labels[k] || k) + '</option>';
      }).join('');
    }

    var submit = document.getElementById('do-submit');
    if (submit) {
      submit.addEventListener('click', function () {
        var msg = document.getElementById('submit-msg');
        var val = function (id) {
          var el = document.getElementById(id);
          return el ? el.value.trim() : '';
        };
        submit.disabled = true;
        msg.hidden = false;
        msg.textContent = 'Sending…';
        S().submitComp({
          item_slug: item.id,
          sold_price: val('sub-price'),
          sale_date: val('sub-date'),
          marketplace: val('sub-market'),
          listing_url: val('sub-url'),
          condition: val('sub-cond'),
          completeness: val('sub-comp')
        }).then(function (res) {
          submit.disabled = false;
          msg.textContent = res.ok
            ? 'Thank you — it is in the review queue. It will not change this page ' +
              'until somebody has checked it.'
            : res.message;
        });
      });
    }

    var report = document.getElementById('do-report');
    if (report) {
      report.addEventListener('click', function () {
        var msg = document.getElementById('report-msg');
        report.disabled = true;
        msg.hidden = false;
        msg.textContent = 'Sending…';
        S().reportItem({
          item_slug: item.id,
          reason: (document.getElementById('rep-reason') || {}).value,
          note: (document.getElementById('rep-note') || {}).value
        }).then(function (res) {
          report.disabled = false;
          msg.textContent = res.ok
            ? 'Thank you — logged for review.'
            : res.message;
        });
      });
    }
  }

  function releasePanel() {
    if (item.release_status === 'upcoming') {
      return '<div class="panel"><h2>Not released yet</h2>' +
        '<div class="notice warn"><strong>This item has been announced but is not out.</strong> ' +
        'There is no secondary market for it, so BearChart publishes no value. Once it ' +
        'ships, early sales will be pre-orders and scalped copies - hype, not a settled ' +
        'market. Wait for the price to calm down before trusting it.</div>' +
        (item.announcement_source
          ? '<p class="fine" style="margin-top:12px">Announcement: <a href="' +
            BC.esc(item.announcement_source) + '" target="_blank" rel="noopener">source</a>' +
            (item.expected_release ? ' &middot; expected ' + BC.esc(item.expected_release) : '') +
            '</p>'
          : '') +
        '</div>';
    }
    if (item.release_status === 'current') {
      return '<div class="panel"><h2>Available at retail now</h2>' +
        '<div class="notice">This is a current release you can still buy new. Retail ' +
        'is a ceiling on what the secondary market will bear, so check the shop price ' +
        'before paying a premium &mdash; unless it is an exclusive that is already ' +
        'selling out.</div>' +
        (item.announcement_source
          ? '<p class="fine" style="margin-top:12px"><a href="' +
            BC.esc(item.announcement_source) + '" target="_blank" rel="noopener">' +
            'Announcement source</a></p>'
          : '') +
        '</div>';
    }
    return '';
  }

  function whyPanel() {
    if (!v.why.length) return '';
    return '<div class="panel">' +
      '<h2>Why this value</h2>' +
      '<ul class="why">' + v.why.map(function (w) {
        return '<li>' + BC.esc(w) + '</li>';
      }).join('') + '</ul>' +
      (v.strong_evidence_count
        ? '<p class="fine" style="margin-top:10px">' + v.strong_evidence_count +
          ' of these comps carry full provenance (date, marketplace and listing id).</p>'
        : '') +
      '</div>';
  }

  function conditionPanel() {
    var keys = Object.keys(v.by_condition || {});
    if (keys.length < 2) return '';
    keys.sort(function (a, b) {
      return CFG.condition_order.indexOf(a) - CFG.condition_order.indexOf(b);
    });
    return '<div class="panel">' +
      '<h2>Sold price by condition</h2>' +
      '<p class="fine">Grades are reported separately. A NWT sale never sets the price of a ' +
      'played-with copy.</p>' +
      '<div class="table-scroll"><table><thead><tr><th>Condition</th>' +
      '<th class="num">Sales</th><th class="num">Median sold</th></tr></thead><tbody>' +
      keys.map(function (k) {
        var c = v.by_condition[k];
        return '<tr><td>' + BC.esc(k) + '</td><td class="num">' + c.count +
               '</td><td class="num price">' + BC.exact(c.median) + '</td></tr>';
      }).join('') +
      '</tbody></table></div></div>';
  }

  function salesPanel() {
    if (!sales.length) return '';
    var outlierIds = new Set((v.excluded_outliers || []).map(function (o) { return o.sale_id; }));

    return '<div class="panel">' +
      '<h2>Sold observations</h2>' +
      '<p class="fine">Every row is a completed or reported sale, never an asking price. ' +
      'Rows marked <em>excluded</em> fell outside the outlier fence and did not affect the value.</p>' +
      '<div class="table-scroll"><table><thead><tr>' +
      '<th>Date</th><th class="num">Price</th><th>Condition</th><th>Completeness</th>' +
      '<th>Marketplace</th><th>Evidence</th><th>Notes</th>' +
      '</tr></thead><tbody>' +
      sales.map(function (s) {
        var price = s.ranged
          ? BC.exact(s.sold_price) + '&ndash;' + BC.exact(s.price_high)
          : BC.exact(s.sold_price);
        var mkt = s.marketplace || '&mdash;';
        if (s.source_url) {
          mkt = '<a href="' + BC.esc(BC.affiliate(s.source_url)) +
                '" target="_blank" rel="noopener">' + mkt + '</a>';
        }
        var notes = [];
        if (s.first_party) {
          notes.push('<strong>Your own sale</strong>');
        }
        if (s.sample_size > 1) {
          notes.push('<strong>Average across ' + s.sample_size + ' sales</strong>');
        }
        if (s.listing_id) notes.push('<span class="mono">#' + BC.esc(s.listing_id) + '</span>');
        if (s.notes) notes.push(BC.esc(s.notes));
        if (outlierIds.has(s.id)) notes.push('<em>excluded as an outlier</em>');
        return '<tr>' +
          '<td>' + BC.esc(BC.dateLabel(s.sale_date)) + '</td>' +
          '<td class="num price">' + price + '</td>' +
          '<td>' + BC.esc(BC.conditionLabel(s.condition)) + '</td>' +
          '<td>' + BC.esc(BC.completenessLabel(s.completeness)) + '</td>' +
          '<td>' + mkt + '</td>' +
          '<td class="fine">' + BC.esc(s.evidence_type.replace(/_/g, ' ')) + '</td>' +
          '<td class="fine">' + (notes.join('<br>') || '&mdash;') + '</td>' +
          '</tr>';
      }).join('') +
      '</tbody></table></div>' +
      '<p style="margin-top:14px"><button type="button" id="export-item">Export this item to CSV</button></p>' +
      '</div>';
  }

  function historyPanel() {
    var h = E.priceHistory(sales, CFG);
    if (h.length < 2) {
      if (!sales.length) return '';
      return '<div class="panel"><h2>Price history</h2>' +
        '<p class="fine">' + (h.length ? 'Only one sold observation carries a date' :
        'None of the sold observations for this item carry a date') +
        ', so there is no trend to chart yet. Dated comps are what make a price ' +
        'history possible &mdash; add them as you find them.</p></div>';
    }

    var W = 640, H = 220, PAD = { l: 46, r: 14, t: 14, b: 28 };
    var ys = h.map(function (p) { return p.median; });
    var lo = Math.min.apply(null, ys), hi = Math.max.apply(null, ys);
    if (lo === hi) { lo = lo * 0.9; hi = hi * 1.1; }
    var x0 = h[0].year, x1 = h[h.length - 1].year;
    var sx = function (yr) {
      return PAD.l + (x1 === x0 ? 0.5 : (yr - x0) / (x1 - x0)) * (W - PAD.l - PAD.r);
    };
    var sy = function (val) {
      return PAD.t + (1 - (val - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
    };

    var ticks = [lo, (lo + hi) / 2, hi];
    var svg = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" ' +
      'aria-label="Median sold price by year">' +
      ticks.map(function (t) {
        return '<line class="grid-line" x1="' + PAD.l + '" y1="' + sy(t).toFixed(1) +
               '" x2="' + (W - PAD.r) + '" y2="' + sy(t).toFixed(1) + '"></line>' +
               '<text x="' + (PAD.l - 6) + '" y="' + (sy(t) + 3).toFixed(1) +
               '" text-anchor="end">' + BC.money(t) + '</text>';
      }).join('') +
      '<polyline class="series" points="' + h.map(function (p) {
        return sx(p.year).toFixed(1) + ',' + sy(p.median).toFixed(1);
      }).join(' ') + '"></polyline>' +
      h.map(function (p) {
        return '<circle class="dot" cx="' + sx(p.year).toFixed(1) + '" cy="' +
               sy(p.median).toFixed(1) + '" r="3.5"><title>' + p.year + ': ' +
               BC.money(p.median) + ' (' + p.count + ' sale' + (p.count === 1 ? '' : 's') +
               ')</title></circle>' +
               '<text x="' + sx(p.year).toFixed(1) + '" y="' + (H - 8) +
               '" text-anchor="middle">' + p.year + '</text>';
      }).join('') +
      '</svg>';

    var first = h[0], last = h[h.length - 1];
    var change = ((last.median - first.median) / first.median) * 100;

    return '<div class="panel"><h2>Price history</h2>' + svg +
      '<p class="fine">Median sold price by year, from dated observations only. ' +
      first.year + ' to ' + last.year + ': ' + (change >= 0 ? '+' : '') +
      change.toFixed(0) + '%. Based on ' +
      h.reduce(function (a, p) { return a + p.count; }, 0) + ' dated sales &mdash; ' +
      'treat a sparse series as directional, not precise.</p></div>';
  }

  function askingPanel() {
    var listings = BC.activeFor(item.id);
    if (!listings.length) return '';
    var spread = E.askSpread(v, listings);

    var reading = '';
    if (spread) {
      var pct = Math.round(spread.premium_pct);
      var words = {
        'asking-above-market': 'Sellers are asking <strong>' + Math.abs(pct) +
          '% above</strong> what this item actually sells for. Asking prices are not ' +
          'market value - price against the sold comps, not against these.',
        'asking-below-market': 'Sellers are asking <strong>' + Math.abs(pct) +
          '% below</strong> the sold-data value. That usually means the market has ' +
          'moved and the sold comps above are getting stale.',
        'in-line': 'Asking prices are broadly in line with the sold data ' +
          '(' + (pct >= 0 ? '+' : '') + pct + '%).'
      };
      reading = '<p class="fine" style="margin-top:10px">' + words[spread.reading] + '</p>';
    }

    return '<div class="panel">' +
      '<h2>Current asking prices</h2>' +
      '<div class="notice warn"><strong>These are not sales.</strong> They are what ' +
      'sellers are currently asking on eBay. BearChart does not price from asking ' +
      'prices and none of these affect the valuation above.</div>' +
      (spread
        ? '<div class="bands" style="margin-top:14px">' +
            priceRow('Median ask', BC.money(spread.median_ask), spread.count + ' live listing' +
                     (spread.count === 1 ? '' : 's')) +
            priceRow('Ask range', BC.range(spread.low_ask, spread.high_ask), 'Low to high') +
            priceRow('Sold-data value', BC.money(spread.fair_market), 'What it actually sells for') +
            priceRow('Spread', (spread.premium_pct >= 0 ? '+' : '') +
                     Math.round(spread.premium_pct) + '%', 'Ask vs sold') +
          '</div>'
        : '') +
      reading +
      '<div class="table-scroll" style="margin-top:14px"><table><thead><tr>' +
      '<th class="num">Asking</th><th>Title</th><th>Condition</th>' +
      '</tr></thead><tbody>' +
      listings.slice(0, 25).map(function (l) {
        var title = BC.esc(l.title || '');
        if (l.source_url) {
          title = '<a href="' + BC.esc(BC.affiliate(l.source_url)) +
                  '" target="_blank" rel="noopener">' + title + '</a>';
        }
        return '<tr><td class="num price">' + BC.exact(l.ask_price) + '</td><td>' + title +
               '</td><td>' + BC.esc(l.condition || 'Unknown') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      (BC.data.active_listings_fetched_at
        ? '<p class="fine" style="margin-top:10px">Fetched ' +
          BC.esc(BC.data.active_listings_fetched_at) + ' via the eBay Browse API.</p>'
        : '') +
      '</div>';
  }

  function identityPanel() {
    var rows = [
      ['Category', item.category],
      ['Animal / species', item.species],
      ['Released', item.release_year
        ? (item.release_month ? monthName(item.release_month) + ' ' : '') + item.release_year
        : 'Not recorded'],
      ['Era', BC.era(item)],
      ['Release status', item.release_status === 'upcoming' ? 'Announced, not yet released'
        : item.release_status === 'current' ? 'Currently available at retail' : null],
      ['Expected', item.expected_release],
      ['Announced retail', item.announced_msrp != null ? BC.money(item.announced_msrp) : null],
      ['Version', item.version],
      ['Variant', item.variant],
      ['Licensed', item.licensed ? 'Yes' + (item.franchise ? ' — ' + item.franchise : '') : 'No'],
      ['Limited edition', item.limited_edition ? 'Yes' : 'No'],
      ['Edition size', item.edition_size],
      ['Original release', item.original_release ? 'Yes' : 'No'],
      ['Vault reissue', item.vault_release ? 'Yes' : 'No'],
      ['Employee exclusive', item.employee_exclusive ? 'Yes' : null],
      ['Store exclusive', item.store_exclusive ? 'Yes' : null],
      ['Event / zoo exclusive', item.event_exclusive ? 'Yes' : null],
      ['International exclusive', item.international_exclusive ? 'Yes' : null],
      ['Online exclusive', item.online_exclusive ? 'Yes' : null],
      ['Mini Bean', item.mini_bean ? 'Yes' : null],
      ['Retired', item.retired == null ? 'Not recorded' : (item.retired ? 'Yes' : 'No')],
      ['Sound', item.sound],
      ['Scent', item.scent],
      ['Rarity', item.rarity || 'Not graded'],
      ['Also known as', (item.aliases || []).join(', ')]
    ].filter(function (r) { return r[1] != null && r[1] !== ''; });

    return '<div class="panel"><h2>Identification</h2>' +
      '<dl class="kv">' + rows.map(function (r) {
        return '<dt>' + BC.esc(r[0]) + '</dt><dd>' + BC.esc(r[1]) + '</dd>';
      }).join('') + '</dl>' +
      (item.notes ? '<div class="notice" style="margin-top:14px">' + BC.esc(item.notes) + '</div>' : '') +
      '</div>';
  }

  function monthName(m) {
    return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
      'September', 'October', 'November', 'December'][m - 1] || '';
  }

  function retailPanel() {
    var r = D.retail_reference;
    return '<div class="panel"><h2>Retail reference</h2>' +
      '<p class="fine">Current official retail as of ' + BC.esc(r.as_of) + '. ' +
      BC.esc(r.warning) + '</p>' +
      '<dl class="kv">' + r.bands.map(function (b) {
        return '<dt>' + BC.esc(b.label) + '</dt><dd>' + BC.money(b.low) + ' – ' +
               BC.money(b.high) + '</dd>';
      }).join('') + '</dl></div>';
  }

  function calcPanel() {
    if (!v.has_value) return '';
    return '<div class="panel"><h2>Value your copy</h2>' +
      '<div class="row">' +
        '<div class="field"><label for="c-cond">Condition</label><select id="c-cond">' +
        CFG.condition_order.map(function (c) {
          return '<option value="' + c + '"' + (c === 'Good' ? ' selected' : '') + '>' + c + '</option>';
        }).join('') + '</select></div>' +
        '<div class="field"><label for="c-comp">Completeness</label><select id="c-comp">' +
        Object.keys(CFG.completeness_multipliers).map(function (k) {
          return '<option value="' + k + '"' + (k === 'bare' ? ' selected' : '') + '>' +
                 BC.esc(CFG.completeness_labels[k] || k) + '</option>';
        }).join('') + '</select></div>' +
      '</div>' +
      '<div id="c-out" style="margin-top:16px"></div>' +
      '<p style="margin-top:14px"><button type="button" id="add-collection">Add to my collection</button> ' +
      '<span class="fine" id="add-note"></span></p>' +
      '</div>';
  }

  function relatedPanel() {
    var rel = D.items.filter(function (i) {
      if (i.id === item.id) return false;
      if (item.franchise && i.franchise === item.franchise) return true;
      if (item.species && i.species === item.species) return true;
      return false;
    }).slice(0, 8);
    if (!rel.length) return '';
    return '<div class="panel"><h2>Related items</h2><div class="tags">' +
      rel.map(function (i) {
        return '<a class="tag" href="' + BC.itemUrl(i.id) + '" style="text-transform:none;' +
               'font-size:12px;letter-spacing:0;text-decoration:none">' +
               BC.esc(i.canonical_name) + '</a>';
      }).join('') + '</div></div>';
  }

  // --- render ---------------------------------------------------------------

  root.innerHTML =
    '<p class="fine" style="margin:0 0 12px"><a href="' + BC.rel('index.html') + '">&larr; Price guide</a></p>' +
    '<div class="panel item-head">' +
      '<div class="item-hero">' + BC.imageHtml(item, 'hero') + BC.imageCredit(item) +
        (BC.hasImage(item) ? '' :
          '<p class="fine img-credit">No photo on file yet.</p>' +
          '<div id="photo-add" class="photo-add"></div>') +
      '</div>' +
      '<div class="item-headtext">' +
        '<h1>' + BC.esc(item.canonical_name) + '</h1>' +
        '<p class="fine" style="margin:0 0 10px">' +
        [item.release_year || 'Year unknown', BC.era(item), item.species, item.category]
          .filter(function (v, i, all) { return v && all.indexOf(v) === i; }).map(BC.esc).join(' &middot; ') + '</p>' +
        BC.tagsHtml(item) +
        // What collectors and sellers actually call it. This is identification
        // data a price guide should lead with - the same bear is listed under
        // three names, and knowing that is half of finding a comp.
        ((item.aliases && item.aliases.length)
          ? '<p class="fine" style="margin:10px 0 0">Also listed as ' +
            item.aliases.map(BC.esc).join(', ') + '</p>'
          : '') +
      '</div>' +
    '</div>' +
    releasePanel() +
    valuationPanel() +
    // An item with no comps has nothing else useful on it. An item with comps
    // gets the "sell yours" panel further down instead, so nobody is shown
    // both - one shop pitch per page is a promo, two is an advert.
    (v.has_value ? '' : BC.shopPromo()) +
    whyPanel() +
    calcPanel() +
    sellPanel() +
    conditionPanel() +
    salesPanel() +
    historyPanel() +
    askingPanel() +
    // Straight after the recorded sales, where a reader has just seen how thin
    // the evidence is and is best placed to add to it.
    submitPanel() +
    identityPanel() +
    retailPanel() +
    relatedPanel() +
    reportPanel();

  bindSubmissions();

  // --- member photos --------------------------------------------------------
  // A signed-in member can send the first photo of a bear that has none. It is
  // reviewed before it appears; see submissions.js and migration 03.

  var photoBusy = false, photoSent = false;

  function renderPhotoAdd() {
    var box = document.getElementById('photo-add');
    if (!box || photoBusy || photoSent) return;
    var Sub = S();
    if (!Sub || !Sub.configured() || !Sub.submitPhoto) { box.innerHTML = ''; return; }
    if (!Sub.signedIn()) {
      box.innerHTML = '<a class="btn photo-btn" href="' + BC.rel('account.html') + '">' +
        'Sign in to add a photo</a>' +
        '<p class="fine">Have this bear? Members can add the first photo.</p>';
      return;
    }
    box.innerHTML = '<label class="btn btn-primary photo-btn" for="photo-file">' +
      'Add a photo of this bear</label>' +
      '<input type="file" id="photo-file" accept="image/*" class="sr-only">' +
      '<p class="fine" id="photo-msg">Photos are checked before they appear. Only send a photo you ' +
        'took yourself (<a href="' + BC.rel('terms.html') + '">terms</a>).</p>';
    document.getElementById('photo-file').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      var msg = document.getElementById('photo-msg');
      photoBusy = true;
      msg.textContent = 'Uploading\u2026';
      S().submitPhoto(item.id, file).then(function (res) {
        photoBusy = false;
        if (res.ok) {
          photoSent = true;
          box.innerHTML = '<p class="photo-thanks"><strong>Thanks!</strong> Your photo is ' +
            'waiting for review and will appear here once it is approved.</p>';
        } else {
          msg.textContent = res.message;
          e.target.value = '';
        }
      });
    });
  }

  renderPhotoAdd();
  if (window.BearChartAuth && window.BearChartAuth.onChange) {
    window.BearChartAuth.onChange(renderPhotoAdd);
  }

  // An approved member photo is not in the static catalogue until the next
  // build, so it is asked for at run time.
  if (!BC.hasImage(item) && S() && S().applyMemberPhotos) {
    S().applyMemberPhotos([item]).then(function (n) {
      if (!n) return;
      var hero = document.querySelector('.item-hero');
      if (hero) {
        hero.innerHTML = BC.imageHtml(item, 'hero') +
          '<p class="fine img-credit">' + BC.esc(S().photoCredit) + '</p>';
      }
    });
  }

  // --- behaviour ------------------------------------------------------------

  function runCalc() {
    var a = E.adjust(v, document.getElementById('c-cond').value,
                     document.getElementById('c-comp').value, CFG);
    document.getElementById('c-out').innerHTML =
      '<div class="headline"><span class="big">' + BC.range(a.range_low, a.range_high) +
      '</span><span class="' + BC.confClass(a.confidence) + '">' + a.confidence + '</span></div>' +
      '<p class="fine">Combined multiplier x' + (Math.round(a.multiplier * 100) / 100) +
      ' applied to a ' + BC.money(v.fair_market) + ' baseline.</p>' +
      '<div class="bands">' +
        priceRow('Buy', BC.range(a.buy_low, a.buy_high), 'What to pay') +
        priceRow('Trade', BC.range(a.trade_low, a.trade_high), 'Trade-in credit') +
        priceRow('Fair sell', BC.range(a.range_low, a.range_high), 'Realistic sale') +
        priceRow('High-end ask', BC.money(a.ask_low) + '+', 'Patient seller') +
      '</div>';
  }

  if (v.has_value) {
    document.getElementById('c-cond').addEventListener('change', runCalc);
    document.getElementById('c-comp').addEventListener('change', runCalc);
    runCalc();

    document.getElementById('add-collection').addEventListener('click', function () {
      var entry = {
        item_id: item.id,
        condition: document.getElementById('c-cond').value,
        completeness: document.getElementById('c-comp').value,
        qty: 1
      };
      var key = 'bearchart.collection';
      var list = [];
      try { list = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { list = []; }
      list.push(entry);
      try {
        localStorage.setItem(key, JSON.stringify(list));
        document.getElementById('add-note').innerHTML =
          'Added. <a href="' + BC.rel('collection.html') + '">View my collection &rarr;</a>';
      } catch (e) {
        document.getElementById('add-note').textContent =
          'Could not save — this browser is blocking local storage.';
      }
    });
  }

  var exportBtn = document.getElementById('export-item');
  if (exportBtn) {
    exportBtn.addEventListener('click', function () {
      BC.download('bearchart-' + item.id + '-' + BC.stamp() + '.csv', BC.salesCsv([item]));
    });
  }
})();

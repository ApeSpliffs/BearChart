/* BearChart deal finder: active listings priced below their sold-data value. */
(function () {
  'use strict';

  var D = BC.data, E = BC.engine;
  var $ = function (id) { return document.getElementById(id); };

  BC.renderChrome('deals.html');

  // A working copy of the reseller assumptions, so they can be tuned on the page
  // without editing the config. Persisted per browser.
  var KEY = 'bearchart.reseller';
  var base = D.config.reseller || {};
  var tuned = load();

  function load() {
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { saved = {}; }
    return {
      marketplace_fee_pct: num(saved.marketplace_fee_pct, base.marketplace_fee_pct),
      payment_fee_fixed: num(saved.payment_fee_fixed, base.payment_fee_fixed),
      shipping_cost: num(saved.shipping_cost, base.shipping_cost),
      min_net_margin: num(saved.min_net_margin, base.min_net_margin),
      min_discount_pct: num(saved.min_discount_pct, base.min_discount_pct),
      min_confidence: atLeastMedium(saved.min_confidence || base.min_confidence)
    };
  }

  // Deals only lean on sold records we trust. A bear with one or two recorded
  // sales can look 70% off when it is just thinly traded, so Medium is the
  // floor on this page whatever was saved before.
  function atLeastMedium(level) {
    return level === 'HIGH' ? 'HIGH' : 'MEDIUM';
  }

  function num(v, fallback) {
    return (typeof v === 'number' && isFinite(v)) ? v : fallback;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(tuned)); } catch (e) { /* blocked */ }
  }

  /** Config with the page's tuned economics swapped in. */
  function config() {
    var c = {};
    Object.keys(D.config).forEach(function (k) { c[k] = D.config[k]; });
    c.reseller = tuned;
    return c;
  }

  function findDeals() {
    return E.findDeals({
      config: config(),
      listings: D.active_listings || [],
      itemById: BC.itemById,
      valuationFor: BC.valuationFor
    });
  }

  // ---- rendering ------------------------------------------------------------

  function renderInputs() {
    $('fee').value = Math.round(tuned.marketplace_fee_pct * 1000) / 10;
    $('ship').value = tuned.shipping_cost;
    $('min-margin').value = tuned.min_net_margin;
    $('min-disc').value = tuned.min_discount_pct;
    $('min-conf').value = tuned.min_confidence;
  }

  function renderStats(deals) {
    var listings = (D.active_listings || []).length;
    var best = deals.length ? deals[0].margin : null;
    var asOf = D.active_listings_fetched_at ? D.active_listings_fetched_at.slice(0, 10) : '--';

    $('deal-stats').innerHTML = [
      [listings, 'Listings checked'],
      [deals.length, 'Deals found'],
      [best == null ? '--' : BC.money(best), 'Best profit'],
      [BC.esc(asOf), 'Last checked']
    ].map(function (c) {
      return '<div class="stat"><div class="v">' + c[0] + '</div><div class="k">' +
        BC.esc(c[1]) + '</div></div>';
    }).join('');
  }

  function emptyState() {
    if (!(D.active_listings || []).length) {
      return '<div class="empty">' +
        '<p><strong>No active listings loaded yet.</strong></p>' +
        '<p>Deals appear here once today\'s eBay listings have been checked. ' +
        'Check back soon.</p>' +
        '<details class="owner-help"><summary>Site owner: how to turn this on</summary>' +
        '<p class="fine">Add <span class="mono">EBAY_CLIENT_ID</span> and ' +
        '<span class="mono">EBAY_CLIENT_SECRET</span> as repository secrets on GitHub and ' +
        'the daily refresh fetches listings automatically. To fetch them by hand:</p>' +
        '<p class="mono">export EBAY_CLIENT_ID=\u2026 EBAY_CLIENT_SECRET=\u2026<br>' +
        'npm run ebay -- --priced-only --limit 40<br>npm run build</p>' +
        '<p class="fine">A free key takes a few minutes at developer.ebay.com.</p>' +
        '</details></div>';
    }
    return '<div class="empty">' +
      '<p><strong>Nothing under your thresholds right now.</strong></p>' +
      '<p class="fine">Nobody is underselling a bear we have prices for at the moment. ' +
      'To see closer calls, lower the minimum profit under ' +
      '\u201cAdjust fees and filters\u201d.</p></div>';
  }

  function render() {
    var deals = findDeals();
    renderStats(deals);
    $('deal-count').textContent = deals.length
      ? deals.length + ' deal' + (deals.length === 1 ? '' : 's')
      : '';

    if (!deals.length) {
      $('deals').innerHTML = emptyState();
      window.__deals = [];
      return;
    }

    // Column order matters to the tests: the fifth cell is the profit, which
    // moves when the fee assumption does.
    $('deals').innerHTML = '<div class="table-scroll"><table class="stack-table deal-table">' +
      '<thead><tr>' +
      '<th>Listing</th><th class="num">Asking</th><th class="num">Usually sells for</th>' +
      '<th class="num">Net after fees</th><th class="num">Your profit</th>' +
      '<th>How sure</th>' +
      '</tr></thead><tbody>' +
      deals.map(function (d) {
        var title = BC.esc(d.listing.title || d.item_name);
        if (d.listing.source_url) {
          title = '<a href="' + BC.esc(BC.affiliate(d.listing.source_url)) +
            '" target="_blank" rel="noopener">' + title + '</a>';
        }
        return '<tr>' +
          '<td data-label="Listing"><div class="deal-title">' + title + '</div>' +
            '<div class="fine">Matched to <a href="' + BC.itemUrl(d.item_id) + '">' +
            BC.esc(d.item_name) + '</a> &middot; ' + BC.esc(d.condition) + '</div>' +
            (d.risks.length
              ? '<div class="risk">Watch out: ' + d.risks.map(BC.esc).join('; ') + '</div>'
              : '') +
          '</td>' +
          '<td class="num price" data-label="Asking">' + BC.exact(d.ask) + '</td>' +
          '<td class="num" data-label="Usually sells for">' + BC.money(d.gross_value) +
            '<div class="fine">safe value ' + BC.money(d.floor_value) + '</div></td>' +
          '<td class="num" data-label="Net after fees">' + BC.money(d.net_proceeds) + '</td>' +
          '<td class="num price" data-label="Your profit"><strong class="profit">' +
            BC.money(d.margin) + '</strong>' +
            '<div class="fine">' + Math.round(d.margin_pct) + '% on cost &middot; ' +
            Math.round(d.discount_pct) + '% below value</div></td>' +
          '<td data-label="How sure"><span class="' + BC.confClass(d.confidence) + '">' +
            d.confidence + '</span><div class="fine">' + d.comparable_count + ' sale' +
            (d.comparable_count === 1 ? '' : 's') + ' on record</div></td>' +
          '</tr>';
      }).join('') + '</tbody></table></div>';

    window.__deals = deals;
  }

  // ---- events ---------------------------------------------------------------

  function bind(id, key, transform) {
    $(id).addEventListener('input', function (e) {
      var v = parseFloat(e.target.value);
      if (!isFinite(v) || v < 0) return;
      tuned[key] = transform ? transform(v) : v;
      save();
      render();
    });
  }

  bind('fee', 'marketplace_fee_pct', function (v) { return v / 100; });
  bind('ship', 'shipping_cost');
  bind('min-margin', 'min_net_margin');
  bind('min-disc', 'min_discount_pct');

  $('min-conf').addEventListener('change', function (e) {
    tuned.min_confidence = atLeastMedium(e.target.value);
    save();
    render();
  });

  $('export-deals').addEventListener('click', function () {
    var rows = [['item_id', 'item_name', 'listing_title', 'ask', 'condition',
      'gross_value', 'net_after_fees', 'margin', 'margin_pct_on_cost',
      'discount_pct', 'confidence', 'comparable_sales', 'listing_url', 'risks']];
    (window.__deals || []).forEach(function (d) {
      rows.push([d.item_id, d.item_name, d.listing.title, BC.r2(d.ask), d.condition,
        BC.r2(d.gross_value), BC.r2(d.net_proceeds), BC.r2(d.margin),
        Math.round(d.margin_pct), Math.round(d.discount_pct), d.confidence,
        d.comparable_count, d.listing.source_url, d.risks.join(' | ')]);
    });
    BC.download('bearchart-deals-' + BC.stamp() + '.csv', BC.toCsv(rows));
  });

  renderInputs();
  render();
})();

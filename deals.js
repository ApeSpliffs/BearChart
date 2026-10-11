/* BearChart deal finder: active listings priced below their sold-data value. */
(function () {
  'use strict';

  var CFG = BC.config, E = BC.engine;
  // Today's asking prices, once loaded (data/h/listings.<hash>.json).
  var L = null;
  var $ = function (id) { return document.getElementById(id); };

  BC.renderChrome('deals.html');

  // A working copy of the reseller assumptions, so they can be tuned on the page
  // without editing the config. Persisted per browser.
  var KEY = 'bearchart.reseller';
  var base = CFG.reseller || {};
  var tuned = load();

  function load() {
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { saved = {}; }
    saved = migrate(saved);
    return {
      platform: platformOr(saved.platform, base.platform),
      // null = use the published fee schedule for the platform.
      fee_pct_override: num(saved.fee_pct_override, null),
      shipping_cost: num(saved.shipping_cost, base.shipping_cost),
      shipping_charged: num(saved.shipping_charged, base.shipping_charged),
      min_net_margin: num(saved.min_net_margin, base.min_net_margin),
      min_discount_pct: num(saved.min_discount_pct, base.min_discount_pct),
      min_confidence: atLeastMedium(saved.min_confidence || base.min_confidence)
    };
  }

  // Settings saved before fees became a per-platform schedule carried a flat
  // percentage. The old default is dropped so the schedule applies; anything
  // the reader typed themselves is kept as their override.
  function migrate(saved) {
    if (saved && typeof saved.marketplace_fee_pct === 'number') {
      if (saved.fee_pct_override == null && saved.marketplace_fee_pct !== 0.1325) {
        saved.fee_pct_override = saved.marketplace_fee_pct;
      }
      delete saved.marketplace_fee_pct;
    }
    if (saved) delete saved.payment_fee_fixed;
    return saved || {};
  }

  function platformOr(p, fallback) {
    var platforms = (CFG.fees && CFG.fees.platforms) || {};
    return (p && platforms[p]) ? p : fallback;
  }

  /** The fee schedule entry in force: the platform's, or the reader's override. */
  function schedule() {
    var platforms = (CFG.fees && CFG.fees.platforms) || {};
    return platforms[tuned.platform] || {};
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
    Object.keys(CFG).forEach(function (k) { c[k] = CFG[k]; });
    var r = {};
    Object.keys(base).forEach(function (k) { r[k] = base[k]; });
    Object.keys(tuned).forEach(function (k) { r[k] = tuned[k]; });
    c.reseller = r;
    if (tuned.fee_pct_override != null && CFG.fees) {
      var fees = JSON.parse(JSON.stringify(CFG.fees));
      if (fees.platforms && fees.platforms[tuned.platform]) {
        fees.platforms[tuned.platform].pct = tuned.fee_pct_override;
      }
      c.fees = fees;
    }
    return c;
  }

  function findDeals() {
    return E.findDeals({
      config: config(),
      listings: L.listings,
      itemById: BC.itemById,
      valuationFor: BC.valuationFor
    });
  }

  // ---- rendering ------------------------------------------------------------

  function renderInputs() {
    var pct = tuned.fee_pct_override != null ? tuned.fee_pct_override : (schedule().pct || 0);
    $('fee').value = Math.round(pct * 1000) / 10;
    var plat = $('platform');
    if (plat) {
      var platforms = (CFG.fees && CFG.fees.platforms) || {};
      plat.innerHTML = Object.keys(platforms).map(function (k) {
        return '<option value="' + BC.esc(k) + '"' + (k === tuned.platform ? ' selected' : '') +
          '>' + BC.esc(platforms[k].label || k) + '</option>';
      }).join('');
    }
    $('ship').value = tuned.shipping_cost;
    $('min-margin').value = tuned.min_net_margin;
    $('min-disc').value = tuned.min_discount_pct;
    $('min-conf').value = tuned.min_confidence;
  }

  function renderStats(deals) {
    var listings = L.listings.length;
    var best = deals.length ? deals[0].margin : null;
    var asOf = L.fetched_at ? L.fetched_at.slice(0, 10) : '--';
    if ($('deal-age')) $('deal-age').innerHTML = L.listings.length ? BC.listingsAgeNote(L.fetched_at) : '';

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
    if (!L.listings.length) {
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
    if (!L) return;   // the catalogue and listings are still loading
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
          title = BC.affiliateLink(d.listing.source_url, title);
        }
        return '<tr>' +
          '<td data-label="Listing"><div class="deal-title">' + title + '</div>' +
            '<div class="fine">Matched to <a href="' + BC.itemUrl(d.item_id) + '">' +
            BC.esc(d.item_name) + '</a> &middot; ' + BC.esc(d.condition) + '</div>' +
            (d.risks.length
              ? '<div class="risk">Watch out: ' + d.risks.map(BC.esc).join('; ') + '</div>'
              : '') +
          '</td>' +
          '<td class="num price" data-label="Asking">' + BC.exact(d.ask) +
            '<div class="fine buyer-pays">' + (d.ship_assumed
              ? '+ ' + BC.exact(d.buyer_total - d.ask) + ' shipping (assumed)'
              : (d.ship_price ? '+ ' + BC.exact(d.ship_price) + ' shipping' : 'free shipping')) +
            '<br>Buyer pays ' + BC.exact(d.buyer_total) + '</div></td>' +
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

  bind('fee', 'fee_pct_override', function (v) { return v / 100; });
  if ($('platform')) {
    $('platform').addEventListener('change', function (e) {
      tuned.platform = platformOr(e.target.value, base.platform);
      // A typed percentage belonged to the old platform.
      tuned.fee_pct_override = null;
      save();
      renderInputs();
      render();
    });
  }
  bind('ship', 'shipping_cost');
  bind('min-margin', 'min_net_margin');
  bind('min-disc', 'min_discount_pct');

  $('min-conf').addEventListener('change', function (e) {
    tuned.min_confidence = atLeastMedium(e.target.value);
    save();
    render();
  });

  $('export-deals').addEventListener('click', function () {
    var rows = [['item_id', 'item_name', 'listing_title', 'ask', 'shipping', 'buyer_total', 'condition',
      'gross_value', 'net_after_fees', 'margin', 'margin_pct_on_cost',
      'discount_pct', 'confidence', 'comparable_sales', 'listing_url', 'risks']];
    (window.__deals || []).forEach(function (d) {
      rows.push([d.item_id, d.item_name, d.listing.title, BC.r2(d.ask),
        d.ship_assumed ? '' : BC.r2(d.ship_price || 0), BC.r2(d.buyer_total), d.condition,
        BC.r2(d.gross_value), BC.r2(d.net_proceeds), BC.r2(d.margin),
        Math.round(d.margin_pct), Math.round(d.discount_pct), d.confidence,
        d.comparable_count, d.listing.source_url, d.risks.join(' | ')]);
    });
    BC.download('bearchart-deals-' + BC.stamp() + '.csv', BC.toCsv(rows));
  });

  renderInputs();
  BC.withCatalogue(function (cat, listings) {
    L = listings;
    render();
  }, { listings: true });
})();

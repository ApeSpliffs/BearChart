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
      min_confidence: saved.min_confidence || base.min_confidence || 'LOW'
    };
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
    var totalMargin = deals.reduce(function (a, d) { return a + d.margin; }, 0);
    var best = deals.length ? deals[0].margin : null;

    $('deal-stats').innerHTML = [
      [listings, 'Listings scanned'],
      [deals.length, 'Worth a look'],
      [best == null ? '--' : BC.money(best), 'Best single margin'],
      [deals.length ? BC.money(totalMargin) : '--', 'Combined margin'],
      [BC.esc(D.active_listings_fetched_at ? D.active_listings_fetched_at.slice(0, 10) : '--'),
        'Listings as of']
    ].map(function (c) {
      return '<div class="stat"><div class="v">' + c[0] + '</div><div class="k">' +
             BC.esc(c[1]) + '</div></div>';
    }).join('');
  }

  function emptyState() {
    if (!(D.active_listings || []).length) {
      return '<div class="empty">' +
        '<p><strong>No active listings loaded yet.</strong></p>' +
        '<p class="fine">The deal finder compares live asking prices against your sold ' +
        'data. Fetch some listings first:</p>' +
        '<p class="mono" style="margin-top:12px">export EBAY_CLIENT_ID=…  EBAY_CLIENT_SECRET=…<br>' +
        'npm run ebay -- --priced-only --limit 40<br>npm run build</p>' +
        '<p class="fine">A free key takes a few minutes at developer.ebay.com — the ' +
        'Browse API is general release.</p></div>';
    }
    return '<div class="empty">' +
      '<p><strong>Nothing under your thresholds right now.</strong></p>' +
      '<p class="fine">That is a normal answer, and a useful one — it means nobody is ' +
      'currently underselling an item you have data on. Loosen the numbers above to ' +
      'see marginal candidates.</p></div>';
  }

  function render() {
    var deals = findDeals();
    renderStats(deals);
    $('deal-count').textContent = deals.length
      ? deals.length + ' candidate' + (deals.length === 1 ? '' : 's')
      : '';

    if (!deals.length) {
      $('deals').innerHTML = emptyState();
      window.__deals = [];
      return;
    }

    $('deals').innerHTML = '<div class="table-scroll"><table><thead><tr>' +
      '<th>Item</th><th class="num">Ask</th><th class="num">Median</th>' +
      '<th class="num">Conservative</th><th class="num">Net after fees</th>' +
      '<th class="num">Margin</th><th class="num">Below floor</th>' +
      '<th>Confidence</th><th>Watch out for</th>' +
      '</tr></thead><tbody>' +
      deals.map(function (d) {
        var title = BC.esc(d.listing.title || d.item_name);
        if (d.listing.source_url) {
          title = '<a href="' + BC.esc(BC.affiliate(d.listing.source_url)) +
                  '" target="_blank" rel="noopener">' + title + '</a>';
        }
        return '<tr>' +
          '<td>' + title +
          '<div class="fine"><a href="' + BC.itemUrl(d.item_id) + '">' +
          BC.esc(d.item_name) + '</a> &middot; ' + BC.esc(d.condition) + '</div></td>' +
          '<td class="num price">' + BC.exact(d.ask) + '</td>' +
          '<td class="num" style="color:var(--ink-faint)">' + BC.money(d.gross_value) +
          '</td>' +
          '<td class="num">' + BC.money(d.floor_value) +
          '<div class="fine">' + BC.esc(d.floor_basis || '') + '</div></td>' +
          '<td class="num">' + BC.money(d.net_proceeds) + '</td>' +
          '<td class="num price"><strong>' + BC.money(d.margin) + '</strong>' +
          '<div class="fine">' + Math.round(d.margin_pct) + '% on cost</div></td>' +
          '<td class="num">' + Math.round(d.discount_pct) + '%</td>' +
          '<td><span class="' + BC.confClass(d.confidence) + '">' + d.confidence +
          '</span><div class="fine">' + d.comparable_count + ' comp' +
          (d.comparable_count === 1 ? '' : 's') + '</div></td>' +
          '<td class="fine">' + (d.risks.length
            ? d.risks.map(BC.esc).join('<br>')
            : '&mdash;') + '</td>' +
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
    tuned.min_confidence = e.target.value;
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

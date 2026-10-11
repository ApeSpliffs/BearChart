/* about.html: the methodology tables, disclosures and sources. (Was an inline
   script; the CSP allows no inline scripts.) */
(function () {
  BC.renderChrome('about.html');
  var CFG = BC.config;

  document.getElementById('cond-table').innerHTML =
    '<thead><tr><th>Grade</th><th class="num">Multiplier</th></tr></thead><tbody>' +
    CFG.condition_order.map(function (c) {
      return '<tr><td>' + c + '</td><td class="num">&times;' +
             CFG.condition_multipliers[c] + '</td></tr>';
    }).join('') + '</tbody>';

  document.getElementById('comp-table').innerHTML =
    '<thead><tr><th>State</th><th class="num">Multiplier</th></tr></thead><tbody>' +
    Object.keys(CFG.completeness_multipliers).map(function (k) {
      return '<tr><td>' + BC.esc(CFG.completeness_labels[k] || k) + '</td><td class="num">&times;' +
             CFG.completeness_multipliers[k] + '</td></tr>';
    }).join('') + '</tbody>';

  // Only shown once something is actually earning - no point disclosing nothing.
  var b = BC.business || {};
  if (b.enabled || b.ebay_campaign_id) {
    var bits = [];
    if (b.enabled) {
      bits.push('<p><strong>' + BC.esc(b.name) + ' buys and sells Build-A-Bear items, ' +
        'and offers to buy the items this guide values.</strong></p><p>' +
        BC.esc(b.disclosure) + '</p>');
    }
    if (b.ebay_campaign_id) {
      bits.push('<p>' + BC.esc(b.affiliate_disclosure) + '</p>');
    }
    if (b.enabled && BC.shopEnabled()) {
      bits.push('<p>' + BC.shopLink('about_disclosure', { className: '' }) + '</p>' + BC.shopDisclosure());
    }
    bits.push('<p class="fine">Neither affects a valuation. Every price on this site ' +
      'comes from the sold data on the item page and nothing else, and there are tests ' +
      'that fail the build if a valuation ever moves because of them.</p>');
    document.getElementById('conflicts').innerHTML = bits.join('');
    document.getElementById('conflicts-panel').hidden = false;
  }

  document.getElementById('sources').innerHTML = '<dl class="kv">' +
    BC.sources.map(function (s) {
      return '<dt>' + BC.extLink(s.url, BC.esc(s.name)) + '</dt><dd>' + BC.esc(s.role) + '</dd>';
    }).join('') + '</dl>';
})();

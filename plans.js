/* BearChart membership page. Driven by the same config the gates read, so the
   pricing table cannot drift away from what is actually enforced. */
(function () {
  'use strict';

  var P = window.BearChartPlans;
  var A = window.BearChartAuth;
  var $ = function (id) { return document.getElementById(id); };

  BC.renderChrome('plans.html');

  function session() {
    var s = A ? A.state() : { signedIn: false };
    return { signedIn: s.signedIn, tier: s.tier };
  }

  function renderStatus() {
    var el = $('status-notice');
    if (!P.configured()) {
      el.className = 'notice';
      el.innerHTML = '<strong>Nothing is for sale yet.</strong> Memberships open soon. ' +
        'Until then, the price guide is free for everyone, and the deal finder, checklists ' +
        'and collection tracker are free with an account.';
      return;
    }
    var s = session();
    el.className = 'notice';
    el.innerHTML = s.signedIn
      ? 'You are on the <strong>' + BC.esc(P.plan(P.currentTier(s)).name) +
        '</strong> plan.'
      : '<a href="account.html">Sign in</a> to manage your membership.';
  }

  // "Everything in Pro" heads a higher tier's list, styled as the line it
  // builds on rather than as one more tick.
  function featureItem(f) {
    var inherit = /^Everything in /.test(f);
    return '<li' + (inherit ? ' class="plan-inherit"' : '') + '>' + BC.esc(f) + '</li>';
  }

  function renderPlans() {
    var current = P.currentTier(session());
    $('plans').innerHTML = P.plans().map(function (p) {
      var isCurrent = P.configured() && p.id === current;
      var cls = 'plan' + (p.badge ? ' is-featured' : '') + (isCurrent ? ' is-current' : '');
      return '<div class="' + cls + '">' +
        (p.badge ? '<span class="plan-badge">' + BC.esc(p.badge) + '</span>' : '') +
        (p.audience ? '<p class="plan-audience">' + BC.esc(p.audience) + '</p>' : '') +
        '<h3 class="plan-name">' + BC.esc(p.name) + '</h3>' +
        '<div class="plan-price">' +
          (p.price_monthly === 0
            ? '<span class="amount">Free</span>'
            : '<span class="amount">$' + p.price_monthly + '</span>' +
              '<span class="per">/month</span>') +
        '</div>' +
        '<p class="plan-blurb">' + BC.esc(p.blurb) + '</p>' +
        (p.perk
          ? '<div class="plan-perk"><strong>Member perk</strong>' + BC.esc(p.perk) + '</div>'
          : '') +
        '<ul class="plan-features">' + p.features.map(featureItem).join('') + '</ul>' +
        (p.price_monthly === 0
          ? '<p class="fine plan-foot">Always free. No sign-up.</p>'
          : (P.configured()
              ? '<button type="button" class="primary" data-plan="' + BC.esc(p.id) +
                '">' + (isCurrent ? 'Current plan' : 'Choose ' + BC.esc(p.name)) +
                '</button>'
              : '<p class="fine plan-foot">Not purchasable yet &mdash; opening soon.</p>')) +
      '</div>';
    }).join('');
  }

  function renderHotSlots() {
    // Still stated before anyone pays - just in the fine print rather than
    // ahead of the plans.
    $('hot-slots').innerHTML =
      '<strong>Alert speed is shared, not personal.</strong> ' +
      'Scanning eBay for new listings costs API quota, and the budget covers about ' +
      '<strong>' + P.hotSlots + ' continuously-scanned searches for the whole site</strong> ' +
      '&mdash; not ' + P.hotSlots + ' each. So Power cannot promise 60-second checks on ' +
      'anything you like; that is a promise that breaks at the fourth customer.' +
      '<br><br>' + BC.esc(P.hotSlotNote) +
      '<br><br>In practice this works in your favour on the bears people chase: everyone ' +
      'watching the same bear shares one fast search and hears about a deal at the same ' +
      'moment.';
  }

  var ENFORCED = {
    server: ['vintage', 'Server',
      'The database refuses this without a live membership, however the request is made.'],
    ux: ['limited', 'Interface only',
      'The page hides it. Nothing stops a determined person doing the same sum ' +
      'themselves, and pretending otherwise would be theatre.'],
    shop: ['current', "Jay's Retro Exchange",
      'The shop checks your membership when you order. Nothing on this site applies it.']
  };

  function renderEnforcement() {
    var rows = [];
    P.plans().forEach(function (p) {
      p.entitlements.forEach(function (e) {
        if (rows.some(function (r) { return r.key === e; })) return;
        rows.push({ key: e, label: P.label(e), where: P.enforcedAt(e), plan: p.name });
      });
    });

    $('enforcement').innerHTML = '<div class="table-scroll"><table><thead><tr>' +
      '<th>Feature</th><th>From</th><th>Checked by</th><th>Meaning</th>' +
      '</tr></thead><tbody>' +
      rows.map(function (r) {
        var kind = ENFORCED[r.where] || ENFORCED.ux;
        return '<tr><td>' + BC.esc(r.label) + '</td>' +
          '<td>' + BC.esc(r.plan) + '</td>' +
          '<td><span class="tag ' + kind[0] + '">' + BC.esc(kind[1]) + '</span></td>' +
          '<td class="fine">' + BC.esc(kind[2]) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  $('plans').addEventListener('click', function (e) {
    var btn = e.target;
    var id = btn.dataset && btn.dataset.plan;
    if (!id) return;

    var s = session();
    if (!s.signedIn) {
      window.location.href = 'account.html';
      return;
    }

    var client = A && A.getClient();
    if (!client) {
      note('Could not reach the account service. Try again in a moment.', true);
      return;
    }

    // The plan NAME goes to the server, never a price. The function resolves the
    // price and the buyer's identity itself, so a caller cannot buy Power at the
    // Pro price or attach a payment to somebody else's account.
    btn.disabled = true;
    btn.textContent = 'Opening checkout…';
    client.functions
      .invoke((BC.data.membership || {}).checkout_function || 'create-checkout',
              { body: { plan: id } })
      .then(function (res) {
        if (res.error) throw new Error(res.error.message);
        if (!res.data || !res.data.url) throw new Error('no checkout url returned');
        window.location.href = res.data.url;
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = 'Choose ' + BC.esc(P.plan(id).name);
        note('Could not start checkout: ' + err.message, true);
      });
  });

  function note(text, warn) {
    var el = $('status-notice');
    el.className = 'notice' + (warn ? ' warn' : '');
    el.textContent = text;
  }

  function renderAll() {
    renderStatus();
    renderPlans();
    renderHotSlots();
    renderEnforcement();
  }

  if (A) A.onChange(renderAll);
  renderAll();
})();

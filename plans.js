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
      el.innerHTML = '<strong>Nothing is for sale yet.</strong> No payment provider is ' +
        'connected, so every feature that can run in your browser is simply on, for ' +
        'everyone, with no account needed. The plans below are what would be offered ' +
        'once a provider is wired up &mdash; they are shown now so the pricing can be ' +
        'argued with before anybody is charged.';
      return;
    }
    var s = session();
    el.className = 'notice';
    el.innerHTML = s.signedIn
      ? 'You are on the <strong>' + BC.esc(P.plan(P.currentTier(s)).name) +
        '</strong> plan.'
      : '<a href="account.html">Sign in</a> to manage your membership.';
  }

  function renderPlans() {
    var current = P.currentTier(session());
    $('plans').innerHTML = P.plans().map(function (p) {
      var isCurrent = P.configured() && p.id === current;
      return '<div class="plan' + (isCurrent ? ' is-current' : '') + '">' +
        '<h3 class="plan-name">' + BC.esc(p.name) + '</h3>' +
        '<div class="plan-price">' +
          (p.price_monthly === 0
            ? '<span class="amount">Free</span>'
            : '<span class="amount">$' + p.price_monthly + '</span>' +
              '<span class="per">/month</span>') +
        '</div>' +
        '<p class="fine">' + BC.esc(p.blurb) + '</p>' +
        '<ul class="plan-features">' +
          p.features.map(function (f) {
            return '<li>' + BC.esc(f) + '</li>';
          }).join('') +
        '</ul>' +
        (p.price_monthly === 0
          ? '<p class="fine plan-foot">Always available. No sign-up.</p>'
          : (P.configured()
              ? '<button type="button" class="primary" data-plan="' + BC.esc(p.id) +
                '">' + (isCurrent ? 'Current plan' : 'Choose ' + BC.esc(p.name)) +
                '</button>'
              : '<p class="fine plan-foot">Not purchasable yet.</p>')) +
        '</div>';
    }).join('');
  }

  function renderHotSlots() {
    // The honest version of the headline feature, stated where somebody deciding
    // whether to pay will read it rather than in a footnote after they have.
    $('hot-slots').innerHTML =
      '<strong>Polling priority is shared, not personal.</strong> ' +
      'Finding new listings costs API quota, and the budget affords about ' +
      '<strong>' + P.hotSlots + ' continuously-polled searches for the whole site</strong> ' +
      '&mdash; not three each. So a Power membership does not buy 60-second polling on ' +
      'anything you like; that is a promise that breaks at the fourth customer. ' +
      '<br><br>' + BC.esc(P.hotSlotNote) +
      '<br><br>In practice this works in your favour on the items people actually chase: ' +
      'a hundred members watching the same bear share one fast query and all get told at ' +
      'once. It works against you on something obscure that only you want.';
  }

  function renderEnforcement() {
    var rows = [];
    P.plans().forEach(function (p) {
      p.entitlements.forEach(function (e) {
        if (rows.some(function (r) { return r.key === e; })) return;
        rows.push({ key: e, label: P.label(e), where: P.enforcedAt(e), plan: p.name });
      });
    });

    $('enforcement').innerHTML = '<div class="table-scroll"><table><thead><tr>' +
      '<th>Feature</th><th>From</th><th>Enforced by</th><th>Meaning</th>' +
      '</tr></thead><tbody>' +
      rows.map(function (r) {
        var server = r.where === 'server';
        return '<tr><td>' + BC.esc(r.label) + '</td>' +
          '<td>' + BC.esc(r.plan) + '</td>' +
          '<td><span class="tag ' + (server ? 'vintage' : 'limited') + '">' +
          (server ? 'Server' : 'Interface only') + '</span></td>' +
          '<td class="fine">' + (server
            ? 'The database refuses this without a live membership, however the ' +
              'request is made.'
            : 'The page hides it. Nothing stops a determined person doing the same ' +
              'sum themselves, and pretending otherwise would be theatre.') +
          '</td></tr>';
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

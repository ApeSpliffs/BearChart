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

  // Each card lists what starts at its tier, under "Included"; a higher tier
  // opens with the tier it builds on. Features still being built sit under
  // "On the way" with no tick: they are not part of what anyone pays for.
  function featureList(items) {
    return items.map(function (f) { return '<li>' + BC.esc(f.text) + '</li>'; }).join('');
  }

  function renderPlans() {
    var current = P.currentTier(session());
    var all = P.plans();
    $('plans').innerHTML = all.map(function (p, i) {
      var isCurrent = P.configured() && p.id === current;
      var cls = 'plan' + (p.badge ? ' is-featured' : '') + (isCurrent ? ' is-current' : '');
      var f = P.featuresFor(p.id);
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
        '<h4 class="plan-list-h">Included</h4>' +
        '<ul class="plan-features">' +
          (i > 0 ? '<li class="plan-inherit">Everything in ' + BC.esc(all[i - 1].name) + '</li>' : '') +
          featureList(f.included) +
        '</ul>' +
        (f.soon.length
          ? '<h4 class="plan-list-h plan-soon-h">On the way</h4>' +
            '<ul class="plan-soon">' + f.soon.map(function (x) {
              return '<li><span class="sr-only">On the way: </span>' + BC.esc(x.text) + '</li>';
            }).join('') + '</ul>'
          : '') +
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
      'The shop checks your monthly coupon code when you order. Nothing on this site applies it.']
  };

  function renderEnforcement() {
    var rows = [];
    P.plans().forEach(function (p) {
      p.entitlements.forEach(function (e) {
        if (rows.some(function (r) { return r.key === e; })) return;
        // Defined but not built: not sold, so not listed as enforced.
        if (P.status(e) === 'planned') return;
        rows.push({ key: e, label: P.label(e), where: P.enforcedAt(e), plan: p.name,
                    soon: P.soon(e) });
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
          '<td class="fine">' + (r.soon ? '<strong>Not built yet.</strong> ' : '') +
          BC.esc(kind[2]) + '</td></tr>';
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
        // Only ever navigate to Stripe's own hosts, whatever the response says.
        var to = BC.safeRedirect(res.data.url, ['checkout.stripe.com', 'billing.stripe.com']);
        if (!to) throw new Error('unexpected billing address');
        // A live member is sent to the billing portal instead of a second checkout.
        if (res.data.portal) note('You already have a membership. Opening billing to change it\u2026');
        window.location.href = to;
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

/* BearChart membership page. Driven by the same config the gates read, so the
   pricing table cannot drift away from what is actually enforced.

   Four tiers in tiers_order (Free, no account / Free account / Pro / Power),
   each card listing what starts at that tier: what works today under
   "Included" (ticked), what is being built under "On the way" (never ticked,
   never sold). The comparison table and the coupon answer in the FAQ come from
   the same config. The card copy (features, who each tier is for, the coupon
   terms) is in the plans file BC.withPlans loads; perks and prices are in
   site-config.js. */
(function () {
  'use strict';

  var P = window.BearChartPlans;
  var A = window.BearChartAuth;
  var $ = function (id) { return document.getElementById(id); };
  var copyReady = false;

  BC.renderChrome('plans.html');

  function session() {
    var s = A ? A.state() : { signedIn: false };
    return { signedIn: !!s.signedIn, tier: s.tier, email: s.email || (s.user && s.user.email) || '' };
  }

  // --- status: the waitlist before launch, the member's plan after ----------

  function waitlistHtml() {
    return '<form id="waitlist" class="waitlist" novalidate>' +
      '<p class="waitlist-h"><strong>Memberships aren\'t open yet.</strong> Get one email when ' +
      'they are. Nothing else.</p>' +
      '<div class="row">' +
        '<div class="field"><label for="wl-email">Email</label>' +
          '<input id="wl-email" type="email" autocomplete="email" required ' +
          'aria-describedby="wl-msg wl-privacy"></div>' +
        '<div class="field"><label for="wl-plan">Interested in</label>' +
          '<select id="wl-plan"><option value="any">Either</option><option value="pro">Pro</option>' +
          '<option value="power">Power</option></select></div>' +
        '<div class="field add-go"><button type="submit" class="primary">Notify me</button></div>' +
      '</div>' +
      '<p id="wl-privacy" class="fine">We use it once, to tell you memberships are open. ' +
      '<a href="privacy.html#waitlist">Privacy</a></p>' +
      '<p id="wl-msg" class="fine" role="status" aria-live="polite"></p>' +
      '</form>';
  }

  function prelaunchNotice() {
    return '<strong>Nothing is for sale yet.</strong> Memberships open soon. ' +
      'Until then, the price guide is free for everyone, and the deal finder, checklists ' +
      'and collection tracker are free with an account.';
  }

  function canWaitlist() {
    // Accounts switched off, or the account library failed to load: there is
    // nowhere to save an address, so say what is true instead.
    return !!(A && A.configured && A.configured() && (!A.getClient || A.getClient() || !authSettled));
  }

  var authSettled = false;

  function renderStatus() {
    var el = $('status-notice');
    if (!P.configured()) {
      if (canWaitlist()) {
        if (!$('waitlist')) {
          el.className = '';
          el.innerHTML = waitlistHtml();
          var em = $('wl-email');
          var s = session();
          if (s.signedIn && s.email && em && !em.value) em.value = s.email;
        }
      } else {
        el.className = 'notice';
        el.innerHTML = prelaunchNotice();
      }
      return;
    }
    var st = session();
    el.className = 'notice';
    el.innerHTML = st.signedIn
      ? 'You are on the <strong>' + BC.esc((P.plan(P.currentTier(st)) || { name: 'Free account' }).name) +
        '</strong> plan.'
      : '<a href="account.html">Sign in</a> to manage your membership.';
  }

  function waitMsg(text) { var m = $('wl-msg'); if (m) m.textContent = text; }

  function joinWaitlist(e) {
    e.preventDefault();
    var input = $('wl-email');
    var plan = ($('wl-plan') || {}).value || 'any';
    var email = (input.value || '').trim();
    input.value = email;
    if (!email || !input.checkValidity()) {
      input.setAttribute('aria-invalid', 'true');
      waitMsg('Enter an email address, like name@example.com.');
      input.focus();
      return;
    }
    input.removeAttribute('aria-invalid');
    var client = A && A.getClient ? A.getClient() : null;
    if (!client) { waitMsg('Couldn\'t save that. Try again in a moment.'); return; }
    var btn = e.target.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    waitMsg('Saving…');
    Promise.resolve().then(function () {
      return client.rpc('join_waitlist', { p_email: email, p_plan: plan, p_source: 'plans' });
    }).then(function (r) {
      if (btn) btn.disabled = false;
      if (r && r.error) {
        waitMsg(/rate_limited/.test(r.error.message || '')
          ? 'Too many tries from here. Please try again in an hour.'
          : 'Couldn\'t save that. Try again in a moment.');
        return;
      }
      // The same answer whether or not the address was already on the list.
      waitMsg('You\'re on the list. We\'ll email you once.');
      if (window.bcTrack) window.bcTrack('waitlist_join', { plan: plan });
    }, function () {
      if (btn) btn.disabled = false;
      waitMsg('Couldn\'t save that. Try again in a moment.');
    });
  }

  // --- the cards ------------------------------------------------------------------

  function priceHtml(p) {
    // The tier name above already says "Free"; the price says $0, never "Free" twice.
    return '<div class="plan-price"><span class="amount">$' + p.price_monthly + '</span>' +
      (p.price_monthly ? '<span class="per">/month</span>' : '') +
      (typeof p.price_annual === 'number' ? '<span class="per">or $' + p.price_annual + '/year</span>' : '') +
      '</div>';
  }

  function footHtml(p, isCurrent) {
    var s = session();
    if (p.id === 'guest') {
      return '<p class="fine plan-foot">No sign-up. Just search.</p>' +
        '<p><a href="index.html">Open the price guide</a></p>';
    }
    if (p.price_monthly === 0) {
      return s.signedIn
        ? '<p class="fine plan-foot">You have this.</p>'
        : '<p class="plan-foot"><a class="btn" href="account.html?mode=signup">Create a free account</a></p>';
    }
    if (P.configured()) {
      return '<button type="button" class="primary" data-plan="' + BC.esc(p.id) + '">' +
        (isCurrent ? 'Current plan' : 'Choose ' + BC.esc(p.name)) + '</button>';
    }
    return '<p class="fine plan-foot">Not open yet.</p>' +
      (canWaitlist()
        ? '<button type="button" class="btn" data-waitlist="' + BC.esc(p.id) + '">Get notified</button>'
        : '');
  }

  function renderPlans() {
    var current = P.currentTier(session());
    var all = P.plans();
    if (!copyReady) {
      $('plans').innerHTML = BC.skeleton('cards', all.length);
      return;
    }
    $('plans').innerHTML = all.map(function (p, i) {
      var isCurrent = P.configured() && p.id === current;
      var cls = 'plan' + (p.badge ? ' is-featured' : '') + (isCurrent ? ' is-current' : '');
      var f = P.featuresFor(p.id);
      return '<div class="' + cls + '">' +
        (p.badge ? '<span class="plan-badge">' + BC.esc(p.badge) + '</span>' : '') +
        '<h2 class="plan-name">' + BC.esc(p.name) + '</h2>' +
        (p.who_for ? '<p class="plan-who">' + BC.esc(p.who_for) + '</p>' : '') +
        priceHtml(p) +
        '<p class="plan-blurb">' + BC.esc(p.blurb) + '</p>' +
        (p.perk ? '<div class="plan-perk"><strong>Member perk</strong>' + BC.esc(p.perk) + '</div>' : '') +
        '<h3 class="plan-list-h">Included</h3>' +
        '<ul class="plan-features">' +
          (i > 0 ? '<li class="plan-inherit">Everything in ' + BC.esc(all[i - 1].short) + '</li>' : '') +
          f.included.map(function (x) { return '<li>' + BC.esc(x.text) + '</li>'; }).join('') +
        '</ul>' +
        (f.soon.length
          ? '<h3 class="plan-list-h plan-soon-h">On the way</h3>' +
            '<ul class="plan-soon">' + f.soon.map(function (x) {
              return '<li><span class="sr-only">On the way: </span>' + BC.esc(x.text) + '</li>';
            }).join('') + '</ul>'
          : '') +
        footHtml(p, isCurrent) +
      '</div>';
    }).join('');
  }

  // --- the comparison -------------------------------------------------------------

  /** "$5 coupon, orders over $40" from the perk sentence (the amounts live in config). */
  function perkShort(text) {
    if (!text) return null;
    var m = /(\$\d+(?:\.\d+)?) coupon[^$]*?(\$\d+(?:\.\d+)?)/.exec(text);
    return m ? m[1] + ' coupon, orders over ' + m[2] : text;
  }

  function renderCompare() {
    if (!copyReady) { $('compare').innerHTML = BC.skeleton('table', 6); return; }
    var tiers = P.plans();
    var feats = P.features();
    var rows = feats.filter(function (f) { return f.status === 'included'; })
      .concat(feats.filter(function (f) { return f.status === 'soon'; }));
    function cell(tier, f) {
      var st = P.featureStatusFor(tier.id, f.id);
      if (st === 'included') return '<td><span class="cmp-yes" aria-label="Included">&#10003;</span></td>';
      if (st === 'soon') return '<td><span class="cmp-soon">On the way</span></td>';
      return '<td><span class="cmp-no" aria-label="Not included">&ndash;</span></td>';
    }
    $('compare').innerHTML = '<div class="table-scroll"><table class="compare-table">' +
      '<caption class="sr-only">What each plan includes</caption>' +
      '<thead><tr><th scope="col">Feature</th>' + tiers.map(function (t) {
        return '<th scope="col">' + BC.esc(t.name) + '</th>';
      }).join('') + '</tr></thead><tbody>' +
      rows.map(function (f) {
        return '<tr><th scope="row">' + BC.esc(f.text) + '</th>' +
          tiers.map(function (t) { return cell(t, f); }).join('') + '</tr>';
      }).join('') +
      '<tr><th scope="row">Monthly store coupon</th>' + tiers.map(function (t) {
        var s = perkShort(P.perk(t.id));
        return s ? '<td>' + BC.esc(s) + '</td>'
                 : '<td><span class="cmp-no" aria-label="Not included">&ndash;</span></td>';
      }).join('') + '</tr>' +
      '<tr class="cmp-price"><th scope="row">Price</th>' + tiers.map(function (t) {
        return '<td>$' + t.price_monthly + (t.price_monthly ? '/month' : '') + '</td>';
      }).join('') + '</tr>' +
      '</tbody></table></div>';
  }

  // --- the FAQ: the coupon answer comes from config --------------------------------

  function renderFaq() {
    var faq = $('faq');
    if (!faq || !copyReady || $('faq-coupon')) return;
    // Each perk named with its plan, both from config.
    var perks = ['pro', 'power'].filter(function (id) { return P.perk(id); }).map(function (id) {
      return '<strong>' + BC.esc(P.plan(id).name) + ':</strong> ' + BC.esc(P.perk(id));
    });
    if (!perks.length) return;
    var dt = document.createElement('dt');
    dt.id = 'faq-coupon';
    dt.textContent = 'How does the Jay\'s Retro Exchange coupon work?';
    var dd = document.createElement('dd');
    dd.innerHTML = perks.join(' ') + ' ' + BC.esc(P.couponTerms()) +
      ' The full rules are in the <a href="terms.html">terms</a>.';
    faq.insertBefore(dd, faq.firstChild);
    faq.insertBefore(dt, dd);
  }

  // --- the fine print ---------------------------------------------------------------

  function renderHotSlots() {
    // Still stated before anyone pays - just in the fine print rather than
    // ahead of the plans.
    $('hot-slots').innerHTML =
      '<strong>Deal alerts are not built yet. When they arrive, alert speed is shared, not personal.</strong> ' +
      'Scanning eBay for new listings costs API quota, and the budget covers about ' +
      '<strong>' + P.hotSlots + ' continuously-scanned searches for the whole site</strong> ' +
      '&mdash; not ' + P.hotSlots + ' each. So Power cannot promise 60-second checks on ' +
      'anything you like; that is a promise that breaks at the fourth customer.' +
      (P.hotSlotNote() ? '<br><br>' + BC.esc(P.hotSlotNote()) : '') +
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
        // Not built: nothing enforces it yet, so say only what will happen.
        if (r.soon) {
          return '<tr><td>' + BC.esc(r.label) + '</td>' +
            '<td>' + BC.esc(r.plan) + '</td>' +
            '<td><span class="tag upcoming">On the way</span></td>' +
            '<td class="fine"><strong>Not built yet.</strong> When it ships, ' +
            (r.where === 'server' ? 'the server will check the membership.' : 'it will say here how it is checked.') +
            '</td></tr>';
        }
        return '<tr><td>' + BC.esc(r.label) + '</td>' +
          '<td>' + BC.esc(r.plan) + '</td>' +
          '<td><span class="tag ' + kind[0] + '">' + BC.esc(kind[1]) + '</span></td>' +
          '<td class="fine">' + BC.esc(kind[2]) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  // --- behaviour ----------------------------------------------------------------------

  $('status-notice').addEventListener('submit', function (e) {
    if (e.target && e.target.id === 'waitlist') joinWaitlist(e);
  });

  $('plans').addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('button') : null;
    if (!btn) return;

    // Pre-launch: take them to the waitlist with this plan picked.
    var wl = btn.getAttribute('data-waitlist');
    if (wl) {
      var form = $('waitlist');
      if (!form) return;
      if (form.scrollIntoView) form.scrollIntoView({ block: 'center' });
      var sel = $('wl-plan');
      if (sel) sel.value = wl;
      $('wl-email').focus();
      return;
    }

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
      .invoke(BC.membership.checkout_function || 'create-checkout',
              { body: { plan: id } })
      .then(function (res) {
        if (res.error) throw new Error(res.error.message);
        if (!res.data || !res.data.url) throw new Error('no checkout url returned');
        // Only ever navigate to Stripe's own hosts, whatever the response says.
        var to = BC.safeRedirect(res.data.url, ['checkout.stripe.com', 'billing.stripe.com']);
        if (!to) throw new Error('unexpected billing address');
        // A live member is sent to the billing portal instead of a second checkout.
        if (res.data.portal) note('You already have a membership. Opening billing to change it…');
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
    renderCompare();
    renderFaq();
    renderHotSlots();
    renderEnforcement();
  }

  if (A) A.onChange(renderAll);
  if (A && A.ready && typeof A.ready.then === 'function') {
    A.ready.then(function () { authSettled = true; renderAll(); }, function () { authSettled = true; renderAll(); });
  }
  renderAll();
  BC.withPlans(function () {
    copyReady = true;
    renderAll();
  });
})();

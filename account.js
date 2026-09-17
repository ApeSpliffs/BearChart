/* BearChart account page: sign up, sign in, sign out, and syncing your
   collection to the account so it follows you between devices. */
(function () {
  'use strict';

  var A = window.BearChartAuth;
  var root = document.getElementById('account-root');
  var COLLECTION_KEY = 'bearchart.collection';

  BC.renderChrome('account.html');

  function localCollection() {
    try { return JSON.parse(localStorage.getItem(COLLECTION_KEY) || '[]'); }
    catch (e) { return []; }
  }

  function msg(text, kind) {
    var el = document.getElementById('auth-msg');
    if (!el) return;
    el.className = 'notice' + (kind === 'warn' ? ' warn' : '');
    el.textContent = text;
    el.hidden = !text;
  }

  // --- views -----------------------------------------------------------------

  function notConfigured() {
    return '<div class="panel">' +
      '<h2>Accounts are not switched on</h2>' +
      '<div class="notice">BearChart runs as a static site with no server of its own, ' +
      'so there is nothing here to sign in to yet. Your collection and checklists are ' +
      'kept in this browser and work exactly as they do now &mdash; they just do not ' +
      'follow you to another device.</div>' +
      '<h3 style="margin-top:22px">Turning accounts on</h3>' +
      '<p class="fine">Accounts run on Supabase Auth, which works from the browser, so ' +
      'the site can stay static. The database schema is already written for it: ' +
      '<span class="mono">supabase_schema.sql</span> has an <span class="mono">admins</span> ' +
      'table and row-level security policies keyed on the signed-in user.</p>' +
      '<ol class="why" style="padding-left:20px">' +
      '<li>Create a project at supabase.com and run ' +
      '<span class="mono">supabase_schema.sql</span>, then <span class="mono">seed.sql</span>.</li>' +
      '<li>Put the project URL and the <strong>anon</strong> key into ' +
      '<span class="mono">AUTH</span> in <span class="mono">tools/build_data.py</span> ' +
      'and set <span class="mono">enabled</span> to true.</li>' +
      '<li>Run <span class="mono">npm run build</span>.</li>' +
      '<li>Add yourself to the <span class="mono">admins</span> table with role ' +
      '<span class="mono">owner</span>.</li>' +
      '</ol>' +
      '<div class="notice" style="margin-top:16px"><strong>The anon key is meant to be ' +
      'public.</strong> It ships in client code and grants only what your RLS policies ' +
      'allow. The <span class="mono">service_role</span> key is the secret one and must ' +
      'never appear in anything a browser can see.</div>' +
      '</div>';
  }

  function signedOut() {
    return '<div class="panel">' +
      '<h2>Sign in</h2>' +
      '<p class="fine">An account keeps your collection and checklists on the server ' +
      'instead of in one browser, so they follow you between devices.</p>' +
      '<p id="auth-msg" hidden></p>' +
      '<div class="row" style="margin-top:12px">' +
        '<div class="field"><label for="email">Email</label>' +
        '<input type="email" id="email" autocomplete="email"></div>' +
        '<div class="field"><label for="password">Password</label>' +
        '<input type="password" id="password" autocomplete="current-password"></div>' +
      '</div>' +
      '<p style="margin-top:14px">' +
        '<button type="button" class="primary" id="do-signin">Sign in</button> ' +
        '<button type="button" id="do-signup">Create an account</button> ' +
        '<button type="button" id="do-link">Email me a sign-in link</button>' +
      '</p>' +
      '<p class="fine"><a href="#" id="do-reset">Forgot your password?</a></p>' +
      '<p class="fine" style="margin-top:14px">You do not need an account to use ' +
      'BearChart. Everything except syncing works signed out.</p>' +
      '</div>';
  }

  function signedIn(s) {
    var local = localCollection();
    return '<div class="panel">' +
      '<h2>Your account</h2>' +
      '<dl class="kv"><dt>Signed in as</dt><dd>' + BC.esc(s.email) + '</dd>' +
      '<dt>Role</dt><dd>' + (s.isAdmin ? 'Admin' : 'Collector') + '</dd></dl>' +
      '<p id="auth-msg" hidden></p>' +
      '<p style="margin-top:14px">' +
        '<button type="button" id="do-signout">Sign out</button> ' +
        (window.BearChartPlans && window.BearChartPlans.configured()
          ? '<button type="button" id="do-portal">Manage membership</button>'
          : '') +
      '</p>' +
      '</div>' +
      '<div class="panel">' +
        '<h2>Your collection</h2>' +
        '<p class="fine">Signed in, your collection is stored against your account. ' +
        'This browser currently holds <strong>' + local.length + '</strong> item' +
        (local.length === 1 ? '' : 's') + '.</p>' +
        (local.length
          ? '<p style="margin-top:12px"><button type="button" class="primary" ' +
            'id="do-push">Copy this browser\'s collection to my account</button></p>' +
            '<p class="fine">This adds them to your account. Nothing already on the ' +
            'account is removed.</p>'
          : '<p class="fine">Nothing to upload from this browser.</p>') +
        '<div id="sync-out" style="margin-top:14px"></div>' +
      '</div>' +
      (s.isAdmin
        ? '<div class="panel"><h2>Admin</h2><p class="fine">You are in the admins ' +
          'table, so the <a href="admin.html">admin tools</a> can write to the ' +
          'database. Writes are enforced by row-level security on the server, not by ' +
          'the page.</p></div>'
        : '');
  }

  // --- behaviour -------------------------------------------------------------

  function val(id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }

  function handle(promise, successText) {
    msg('Working…');
    return promise.then(function (res) {
      if (!res.ok) { msg(res.message, 'warn'); return res; }
      msg(successText || 'Done.');
      return res;
    });
  }

  function bindSignedOut() {
    document.getElementById('do-signin').addEventListener('click', function () {
      handle(A.signIn(val('email'), val('password')), 'Signed in.');
    });
    document.getElementById('do-signup').addEventListener('click', function () {
      handle(A.signUp(val('email'), val('password')),
        'Account created. Check your email to confirm it.');
    });
    document.getElementById('do-link').addEventListener('click', function () {
      handle(A.signInWithLink(val('email')),
        'Check your email for a sign-in link.');
    });
    document.getElementById('do-reset').addEventListener('click', function (e) {
      e.preventDefault();
      handle(A.resetPassword(val('email')), 'Check your email to reset your password.');
    });
  }

  function bindSignedIn() {
    document.getElementById('do-signout').addEventListener('click', function () {
      A.signOut().then(render);
    });
    var push = document.getElementById('do-push');
    if (push) push.addEventListener('click', pushCollection);

    // Cancelling has to be as easy as subscribing. Stripe's portal handles
    // card changes, invoices and cancellation without us storing any of it.
    var portal = document.getElementById('do-portal');
    if (portal) {
      portal.addEventListener('click', function () {
        var client = A.getClient();
        if (!client) { msg('Could not reach the account service.', 'warn'); return; }
        msg('Opening billing…');
        client.functions
          .invoke((BC.data.membership || {}).portal_function || 'create-portal', {})
          .then(function (res) {
            if (res.error) throw new Error(res.error.message);
            if (!res.data || !res.data.url) throw new Error('no portal url returned');
            window.location.href = res.data.url;
          })
          .catch(function (err) { msg(err.message, 'warn'); });
      });
    }
  }

  /** Copy this browser's collection onto the account. Additive, never destructive. */
  function pushCollection() {
    var out = document.getElementById('sync-out');
    var client = A.getClient();
    var s = A.state();
    if (!client || !s.signedIn) {
      out.innerHTML = '<div class="notice warn">Not signed in.</div>';
      return;
    }
    var rows = localCollection().map(function (e) {
      return {
        user_id: s.user.id,
        item_id_slug: e.item_id,
        condition: e.condition,
        completeness: e.completeness,
        qty: e.qty || 1
      };
    });
    if (!rows.length) return;

    out.innerHTML = '<p class="fine">Uploading ' + rows.length + ' item(s)…</p>';
    client.rpc('add_collection_items', { entries: rows })
      .then(function (res) {
        if (res && res.error) throw new Error(res.error.message);
        out.innerHTML = '<div class="notice">Uploaded. Your collection is now on your ' +
          'account.</div>';
      })
      .catch(function (err) {
        out.innerHTML = '<div class="notice warn">Could not upload: ' +
          BC.esc(err.message) + '<br>Your collection is still safe in this browser.</div>';
      });
  }

  function render() {
    var s = A.state();
    if (!s.configured) {
      root.innerHTML = notConfigured();
      return;
    }
    if (s.signedIn) {
      root.innerHTML = signedIn(s);
      bindSignedIn();
    } else {
      root.innerHTML = signedOut();
      bindSignedOut();
    }
  }

  A.ready.then(render);
  A.onChange(render);
})();

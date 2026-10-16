/*
 * Plush Price Guide authentication.
 *
 * Real auth, or none at all. There is deliberately no client-side password
 * check, no "signed in" flag in localStorage, and no fake session: on a static
 * site those are decoration that anyone can set from the console, and they are
 * worse than nothing because they imply a protection that does not exist.
 *
 * Instead this wraps Supabase Auth, which runs from the browser against
 * Supabase's servers. Sessions are real JWTs, and every read and write is
 * enforced server-side by the row-level security policies in the migrations
 * in supabase/migrations/ - not by this file. If someone bypasses this UI
 * entirely and calls the API directly, RLS still stops them.
 *
 * Until config.auth is filled in, Plush Price Guide runs exactly as it does today:
 * anonymous, with collections kept in the browser. Nothing here breaks that.
 * A deploy can override config.auth per environment through config.js
 * (BEARCHART_RUNTIME.auth) - that is how a preview is kept off production.
 *
 * On the anon key: it is designed to be public and ships in client code. It
 * grants only what RLS allows. The service-role key is the secret one and must
 * never appear in anything served to a browser.
 */
(function (root) {
  'use strict';

  // supabase-js is vendored (tools/vendor_supabase.sh): a fixed version that is
  // reviewed in git, served from this origin, and checked by Subresource
  // Integrity. A test fails if the file and this hash drift apart.
  var SUPABASE_VERSION = '2.117.3';
  var SUPABASE_FILE = 'vendor/supabase-js-' + SUPABASE_VERSION + '.min.js';
  var SUPABASE_SRI = 'sha384-BWcjm9OdFth9TbhCxZPdm+gAOUMAzQy9nmTs12ioXdCcbVnJaPMn+fMUoQCLt60R';

  // Resolved against auth.js's own URL, so pages one level down (item/*.html)
  // and email redirect targets both point at the site root.
  var SELF = (typeof document !== 'undefined' && document.currentScript &&
              document.currentScript.src) || '';
  function siteUrl(path) {
    try { return SELF ? new URL(path, SELF).href : path; } catch (e) { return path; }
  }

  var S = root.BearChartSanitize;

  // Password policy, in one place. The real enforcement is the Supabase Auth
  // setting (dashboard); raise this only together with it.
  var MIN_PASSWORD_LENGTH = 8;
  function passwordProblem(pw) {
    return !pw || pw.length < MIN_PASSWORD_LENGTH
      ? 'Use a password of at least ' + MIN_PASSWORD_LENGTH + ' characters.'
      : null;
  }

  // Email-link types supabase verifyOtp accepts for a token_hash link.
  var OTP_TYPES = ['email', 'recovery', 'signup', 'magiclink', 'invite', 'email_change'];

  // The one place the auth settings are resolved: site-config.js's auth (built
  // from data.json config.auth, read through bc-data.js) with the deploy's
  // config.js (BEARCHART_RUNTIME.auth) on top. Everything else that talks to
  // Supabase reads them through BearChartAuth.config().
  var BD = root.BearChartData;
  var dataCfg = (BD && BD.hasConfig() ? BD.config().auth : null) || {};
  var cfg = Object.assign({}, dataCfg, (root.BEARCHART_RUNTIME || {}).auth || {});
  var client = null;
  var session = null;
  var profile = { isAdmin: false };
  var recovery = false;   // signed in by a password-reset link: must choose a new password
  var linkError = null;   // an email link that failed (expired, already used)
  var listeners = [];
  var readyResolve;
  var ready = new Promise(function (r) { readyResolve = r; });

  function configured() {
    return !!(cfg.enabled && cfg.supabase_url && cfg.supabase_anon_key);
  }

  function notify() {
    // Error reports carry the user id only, never the email (observability.js).
    if (root.bcObs) root.bcObs.setUser(session && session.user ? session.user.id : null);
    listeners.forEach(function (fn) {
      try { fn(state()); } catch (e) { /* a bad listener must not break auth */ }
    });
  }

  function state() {
    return {
      configured: configured(),
      signedIn: !!session,
      user: session ? session.user : null,
      email: session && session.user ? session.user.email : null,
      isAdmin: profile.isAdmin,
      recovery: recovery && !!session,
      linkError: linkError
    };
  }

  // If the CDN is slow, blocked, or simply never answers, neither onload nor
  // onerror fires and the promise stays pending for ever - ready never resolves
  // and the page sits half-initialised with no navigation. A timeout is what
  // turns an unreachable dependency into a fallback instead of a hang.
  // Overridable so a test harness with no network need not wait the full
  // browser-appropriate timeout on every page it renders.
  var SCRIPT_TIMEOUT_MS = Number(root.__BEARCHART_SCRIPT_TIMEOUT_MS || 8000);

  function loadScript(src, integrity) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        reject(new Error('timed out loading ' + src));
      }, SCRIPT_TIMEOUT_MS);

      var el = document.createElement('script');
      if (integrity) { el.integrity = integrity; el.crossOrigin = 'anonymous'; }
      el.src = src;
      el.onload = function () {
        if (done) { return; }
        done = true; clearTimeout(timer); resolve();
      };
      el.onerror = function () {
        if (done) { return; }
        done = true; clearTimeout(timer);
        reject(new Error('could not load ' + src));
      };
      document.head.appendChild(el);
    });
  }

  /** Is this user in the admins table? Asked of the server, never assumed. */
  function refreshAdmin() {
    if (!client || !session) {
      profile.isAdmin = false;
      return Promise.resolve(false);
    }
    return client.from('admins').select('role').eq('user_id', session.user.id)
      .maybeSingle()
      .then(function (res) {
        // RLS makes the admins table readable only by admins, so a non-admin
        // simply gets nothing back rather than an error.
        profile.isAdmin = !!(res && res.data);
        return profile.isAdmin;
      })
      .catch(function () {
        profile.isAdmin = false;
        return false;
      });
  }

  function init() {
    if (!configured()) {
      readyResolve(state());
      return ready;
    }
    captureLinkError();
    return loadScript(siteUrl(SUPABASE_FILE), SUPABASE_SRI)
      .then(function () {
        // PKCE: an email link carries a one-time ?code= that is useless
        // without the verifier kept in THIS browser - no tokens in the URL.
        client = root.supabase.createClient(cfg.supabase_url, cfg.supabase_anon_key, {
          auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true }
        });
        // Registered synchronously, before getSession, so the PASSWORD_RECOVERY
        // event fired while the client initialises is not missed.
        client.auth.onAuthStateChange(function (event, s) {
          if (event === 'PASSWORD_RECOVERY') recovery = true;
          session = s;
          refreshAdmin().then(notify);
        });
        return verifyTokenHash();
      })
      .then(function () { return client.auth.getSession(); })
      .then(function (res) {
        session = (res && res.data) ? res.data.session : null;
        scrubAddressBar();
        return refreshAdmin();
      })
      .then(function () {
        readyResolve(state());
        notify();
        return state();
      })
      .catch(function (err) {
        // A misconfigured backend must not take the whole site down: fall back
        // to anonymous, which is a fully working mode.
        if (root.console && console.warn) {
          console.warn('Plush Price Guide auth unavailable, continuing anonymously:', err.message);
        }
        client = null;
        readyResolve(state());
        return state();
      });
  }

  function linkParams() {
    var out = {};
    if (!root.location) return out;
    [root.location.search, root.location.hash].forEach(function (part) {
      var p = new URLSearchParams(String(part || '').replace(/^[?#]/, ''));
      p.forEach(function (v, k) { if (!(k in out)) out[k] = v; });
    });
    return out;
  }

  /**
   * An email link that failed says so in the URL. Show a fixed message, never
   * the URL's own text: anyone can craft a link that "says" anything.
   */
  var LINK_ERROR = 'That email link has expired or has already been used. ' +
    'Ask for a new one below.';
  function captureLinkError() {
    var p = linkParams();
    if (p.error_description || p.error || p.error_code) linkError = LINK_ERROR;
  }

  /**
   * Cross-device links. PKCE cannot finish in a browser that did not start the
   * flow, so the email templates may instead link with ?token_hash=&type=
   * (owner TODO in the security spec), which is verified here.
   */
  function verifyTokenHash() {
    var p = linkParams();
    if (!p.token_hash || OTP_TYPES.indexOf(p.type) === -1) return Promise.resolve();
    return client.auth.verifyOtp({ token_hash: p.token_hash, type: p.type })
      .then(function (res) {
        if (res && res.error) { linkError = res.error.message; return; }
        if (p.type === 'recovery') recovery = true;
      })
      .catch(function (e) { linkError = (e && e.message) || 'That link did not work.'; });
  }

  /** Remove login codes/tokens from the address bar (and so from analytics and history). */
  function scrubAddressBar() {
    if (!S || !root.location || !root.history || !root.history.replaceState) return;
    var href = root.location.href;
    var p = linkParams();
    var sensitive = S.SENSITIVE_URL_PARAMS.some(function (k) { return k in p; });
    if (!sensitive) return;   // leave ordinary #anchors alone
    var clean = S.scrubUrl(href);
    if (clean !== href) root.history.replaceState(null, '', clean);
  }

  // --- actions ---------------------------------------------------------------
  // Each returns { ok: true } or { ok: false, message } - never throws at the UI.

  function guard() {
    if (!configured()) {
      return { ok: false, message: 'Accounts are not set up on this site yet.' };
    }
    if (!client) {
      return { ok: false, message: 'Could not reach the account service. Try again.' };
    }
    return null;
  }

  function wrap(promise) {
    return promise.then(function (res) {
      if (res && res.error) return { ok: false, message: res.error.message };
      return { ok: true, data: res ? res.data : null };
    }).catch(function (e) {
      return { ok: false, message: e.message || 'Something went wrong.' };
    });
  }

  function signUp(email, password) {
    if (!email) return Promise.resolve({ ok: false, message: 'Enter an email address.' });
    var weak = passwordProblem(password);
    if (weak) return Promise.resolve({ ok: false, message: weak });
    var bad = guard();
    if (bad) return Promise.resolve(bad);
    return wrap(client.auth.signUp({
      email: email, password: password,
      options: { emailRedirectTo: siteUrl('account.html') }
    }));
  }

  function signIn(email, password) {
    if (!email || !password) {
      return Promise.resolve({ ok: false, message: 'Enter your email and password.' });
    }
    var bad = guard();
    if (bad) return Promise.resolve(bad);
    return wrap(client.auth.signInWithPassword({ email: email, password: password }));
  }

  /** Passwordless: emails a one-time link. Nothing to forget or reuse. */
  function signInWithLink(email) {
    if (!email) return Promise.resolve({ ok: false, message: 'Enter an email address.' });
    var bad = guard();
    if (bad) return Promise.resolve(bad);
    return wrap(client.auth.signInWithOtp({
      email: email, options: { emailRedirectTo: siteUrl('account.html') }
    }));
  }

  function resetPassword(email) {
    if (!email) return Promise.resolve({ ok: false, message: 'Enter an email address.' });
    var bad = guard();
    if (bad) return Promise.resolve(bad);
    return wrap(client.auth.resetPasswordForEmail(email, { redirectTo: siteUrl('account.html') }));
  }

  /** Set a new password (after a reset link, or from the account page). */
  function updatePassword(pw, confirm) {
    var weak = passwordProblem(pw);
    if (weak) return Promise.resolve({ ok: false, message: weak });
    if (pw !== confirm) return Promise.resolve({ ok: false, message: 'Those passwords do not match.' });
    var bad = guard();
    if (bad) return Promise.resolve(bad);
    return wrap(client.auth.updateUser({ password: pw })).then(function (r) {
      if (r.ok) { recovery = false; notify(); }
      return r;
    });
  }

  function signOut() {
    var bad = guard();
    if (bad) return Promise.resolve(bad);
    return wrap(client.auth.signOut()).then(function (r) {
      session = null;
      profile.isAdmin = false;
      recovery = false;
      notify();
      return r;
    });
  }

  function onChange(fn) {
    listeners.push(fn);
    if (session !== undefined) { try { fn(state()); } catch (e) { /* ignore */ } }
    return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
  }

  root.BearChartAuth = {
    init: init,
    ready: ready,
    state: state,
    configured: configured,
    /** The merged auth settings (a copy). */
    config: function () { return Object.assign({}, cfg); },
    signUp: signUp,
    signIn: signIn,
    signInWithLink: signInWithLink,
    resetPassword: resetPassword,
    updatePassword: updatePassword,
    passwordProblem: passwordProblem,
    MIN_PASSWORD_LENGTH: MIN_PASSWORD_LENGTH,
    signOut: signOut,
    onChange: onChange,
    // Exposed so the collection can read and write the user's own rows. Null
    // until a session exists.
    getClient: function () { return client; },
    _setClientForTests: function (c, s) {
      client = c;
      session = s || null;
      return refreshAdmin().then(function (r) { notify(); return r; });
    },
    _setRecoveryForTests: function (on) { recovery = !!on; notify(); }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

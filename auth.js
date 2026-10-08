/*
 * BearChart authentication.
 *
 * Real auth, or none at all. There is deliberately no client-side password
 * check, no "signed in" flag in localStorage, and no fake session: on a static
 * site those are decoration that anyone can set from the console, and they are
 * worse than nothing because they imply a protection that does not exist.
 *
 * Instead this wraps Supabase Auth, which runs from the browser against
 * Supabase's servers. Sessions are real JWTs, and every read and write is
 * enforced server-side by the row-level security policies in
 * the migrations in supabase/migrations/ - not by this file. If someone bypasses this UI entirely
 * and calls the API directly, RLS still stops them.
 *
 * Until config.auth is filled in, BearChart runs exactly as it does today:
 * anonymous, with collections kept in the browser. Nothing here breaks that.
 *
 * On the anon key: it is designed to be public and ships in client code. It
 * grants only what RLS allows. The service-role key is the secret one and must
 * never appear in anything served to a browser.
 */
(function (root) {
  'use strict';

  var SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';

  var cfg = ((root.BEARCHART_DATA || {}).config || {}).auth || {};
  var client = null;
  var session = null;
  var profile = { isAdmin: false };
  var listeners = [];
  var readyResolve;
  var ready = new Promise(function (r) { readyResolve = r; });

  function configured() {
    return !!(cfg.enabled && cfg.supabase_url && cfg.supabase_anon_key);
  }

  function notify() {
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
      isAdmin: profile.isAdmin
    };
  }

  // If the CDN is slow, blocked, or simply never answers, neither onload nor
  // onerror fires and the promise stays pending for ever - ready never resolves
  // and the page sits half-initialised with no navigation. A timeout is what
  // turns an unreachable dependency into a fallback instead of a hang.
  // Overridable so a test harness with no network need not wait the full
  // browser-appropriate timeout on every page it renders.
  var SCRIPT_TIMEOUT_MS = Number(root.__BEARCHART_SCRIPT_TIMEOUT_MS || 8000);

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        reject(new Error('timed out loading ' + src));
      }, SCRIPT_TIMEOUT_MS);

      var el = document.createElement('script');
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
    return loadScript(SUPABASE_CDN)
      .then(function () {
        client = root.supabase.createClient(cfg.supabase_url, cfg.supabase_anon_key);
        return client.auth.getSession();
      })
      .then(function (res) {
        session = (res && res.data) ? res.data.session : null;
        client.auth.onAuthStateChange(function (_event, s) {
          session = s;
          refreshAdmin().then(notify);
        });
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
          console.warn('BearChart auth unavailable, continuing anonymously:', err.message);
        }
        client = null;
        readyResolve(state());
        return state();
      });
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
    if (!password || password.length < 8) {
      return Promise.resolve({ ok: false, message: 'Use a password of at least 8 characters.' });
    }
    var bad = guard();
    if (bad) return Promise.resolve(bad);
    return wrap(client.auth.signUp({ email: email, password: password }));
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
    return wrap(client.auth.signInWithOtp({ email: email }));
  }

  function resetPassword(email) {
    if (!email) return Promise.resolve({ ok: false, message: 'Enter an email address.' });
    var bad = guard();
    if (bad) return Promise.resolve(bad);
    return wrap(client.auth.resetPasswordForEmail(email));
  }

  function signOut() {
    var bad = guard();
    if (bad) return Promise.resolve(bad);
    return wrap(client.auth.signOut()).then(function (r) {
      session = null;
      profile.isAdmin = false;
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
    signUp: signUp,
    signIn: signIn,
    signInWithLink: signInWithLink,
    resetPassword: resetPassword,
    signOut: signOut,
    onChange: onChange,
    // Exposed so the collection can read and write the user's own rows. Null
    // until a session exists.
    getClient: function () { return client; },
    _setClientForTests: function (c, s) {
      client = c;
      session = s || null;
      return refreshAdmin().then(function (r) { notify(); return r; });
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

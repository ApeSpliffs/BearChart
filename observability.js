/* Error reporting (Sentry). Inert until a DSN is configured - the same rule as
   auth.js. Pages call nothing: loading this file is the one init. Other code may
   call window.bcObs.captureException(e) safely whether or not Sentry is on.

   With no DSN (the committed config.js), this defines no-op bcObs and stops:
   no script is added and no request is made. It also stays off on file://,
   localhost and under jsdom, so local work and the test suite never report. */
(function (root) {
  'use strict';
  var SDK_URL = 'https://browser.sentry-cdn.com/11.5.0/bundle.min.js';
  var SDK_SRI = 'sha384-hz6acjqDJyH+W4e5eBe7yycs+gVPltrjQnZ05EYDSYGV2fVFkqg3bR2tFiOq8DjQ';
  var rt = root.BEARCHART_RUNTIME || {};
  var noop = function () {};
  var api = root.bcObs = { enabled: false, captureException: noop, captureMessage: noop, setUser: noop };

  if (!rt.sentry_dsn) return;
  if (typeof document === 'undefined' || /jsdom/i.test((root.navigator && navigator.userAgent) || '')) return;
  if (location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return;

  // Errors that happen before the SDK arrives are queued (a few, not a flood).
  var queue = [], loaded = false;
  function early(kind) { return function () { if (!loaded && queue.length < 20) queue.push([kind, arguments]); }; }
  api.captureException = early('captureException');
  api.captureMessage = early('captureMessage');
  api.setUser = early('setUser');
  root.addEventListener('error', function (ev) { if (!loaded) api.captureException(ev.error || ev.message); });
  root.addEventListener('unhandledrejection', function (ev) { if (!loaded) api.captureException(ev.reason); });

  // Magic-link and recovery tokens live in the hash; search terms in the query.
  function scrubUrl(u) { return String(u || '').replace(/#.*$/, '').replace(/\?.*$/, ''); }

  var el = document.createElement('script');
  el.src = SDK_URL; el.integrity = SDK_SRI; el.crossOrigin = 'anonymous'; el.async = true;
  el.onload = function () {
    var S = root.Sentry; if (!S) return;
    S.init({
      dsn: rt.sentry_dsn,
      environment: rt.env || 'production',
      release: rt.release || undefined,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      ignoreErrors: ['ResizeObserver loop limit exceeded', 'ResizeObserver loop completed'],
      denyUrls: [/^chrome-extension:\/\//, /^moz-extension:\/\//, /^safari-extension:\/\//],
      beforeSend: function (e) {
        if (e.request) { e.request.url = scrubUrl(e.request.url); delete e.request.cookies; }
        return e;
      },
      beforeBreadcrumb: function (b) { if (b.data && b.data.url) b.data.url = scrubUrl(b.data.url); return b; }
    });
    loaded = true; api.enabled = true;
    api.captureException = function (e, c) { S.captureException(e, c); };
    api.captureMessage = function (m, c) { S.captureMessage(m, c); };
    api.setUser = function (id) { S.setUser(id ? { id: String(id) } : null); }; // id only, never email
    queue.forEach(function (q) { api[q[0]].apply(null, q[1]); });
    queue = [];
  };
  document.head.appendChild(el);
})(window);

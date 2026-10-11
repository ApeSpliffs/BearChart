/* BearChart colour theme. Loaded as a blocking script in every page's <head>,
   before the stylesheet paints, so a dark page never flashes light (and the
   reverse). The device setting decides unless the visitor picked a theme in
   the footer (localStorage 'bc.theme': 'light' | 'dark' | 'system').

   External on purpose: the Content-Security-Policy allows no inline script. */
(function (root) {
  'use strict';

  var KEY = 'bc.theme';
  var CHOICES = ['system', 'light', 'dark'];
  // The browser chrome colour for each: the brand red in light, the page
  // ground in dark.
  var CHROME = { light: '#b3131c', dark: '#1b1416' };

  function stored() {
    try {
      var v = root.localStorage.getItem(KEY);
      return CHOICES.indexOf(v) !== -1 ? v : 'system';
    } catch (e) { return 'system'; }   // storage blocked: follow the device
  }

  function deviceDark() {
    try {
      return !!(root.matchMedia && root.matchMedia('(prefers-color-scheme: dark)').matches);
    } catch (e) { return false; }
  }

  /** The theme in effect: 'light' or 'dark'. */
  function effective(choice) {
    var c = choice || stored();
    return c === 'system' ? (deviceDark() ? 'dark' : 'light') : c;
  }

  function apply(choice) {
    var doc = root.document;
    if (!doc || !doc.documentElement) return;
    var c = choice || stored();
    if (c === 'system') delete doc.documentElement.dataset.theme;
    else doc.documentElement.dataset.theme = c;
    var metas = doc.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) metas[i].setAttribute('content', CHROME[effective(c)]);
  }

  function set(choice) {
    if (CHOICES.indexOf(choice) === -1) choice = 'system';
    try {
      if (choice === 'system') root.localStorage.removeItem(KEY);
      else root.localStorage.setItem(KEY, choice);
    } catch (e) { /* blocked: still applies to this page */ }
    apply(choice);
    return choice;
  }

  apply();
  // Following the device: keep the browser chrome colour in step when it flips.
  try {
    var mq = root.matchMedia && root.matchMedia('(prefers-color-scheme: dark)');
    if (mq && mq.addEventListener) mq.addEventListener('change', function () { apply(); });
  } catch (e) { /* old browser */ }

  root.BearChartTheme = { get: stored, set: set, effective: effective, apply: apply };
})(typeof window !== 'undefined' ? window : this);

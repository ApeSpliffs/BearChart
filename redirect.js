/* Redirect stub helper for item/<old-id>.html pages of merged items.
   Loaded as an external file because the CSP allows no inline script; the
   meta refresh in the stub does the same job without JavaScript. */
(function () {
  'use strict';
  var link = document.querySelector('link[rel="canonical"]');
  var page = String((link && link.getAttribute('href')) || '').split('/').pop();
  // Only ever a sibling item page, never an arbitrary URL out of the document.
  if (/^[a-z0-9-]+\.html$/.test(page)) {
    location.replace(page + location.search + location.hash);
  }
})();

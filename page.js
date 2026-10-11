/* Chrome for the plain text pages (privacy, terms). The page names itself in
   <body data-page="...">, so no inline script is needed (the CSP forbids them). */
(function () {
  'use strict';
  BC.renderChrome(document.body.getAttribute('data-page'));
})();

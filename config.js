/* Runtime configuration. This committed copy is empty on purpose: local dev and
   tests run on data.json's config. tools/build_site.sh overwrites dist/config.js
   from the deploy environment (Vercel production/preview) - see
   tools/build_runtime_config.py and docs/ENVIRONMENTS.md. */
window.BEARCHART_RUNTIME = window.BEARCHART_RUNTIME || {};

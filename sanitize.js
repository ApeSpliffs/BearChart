/* Security helpers shared by every page: URL allow-listing, outbound links,
   HTML escaping, CSV cells that a spreadsheet will not execute, scrubbing auth
   secrets out of analytics URLs, and sniffing image bytes.

   Pure: no DOM, no data access. Loaded before auth.js on every page and
   require()-able from Node for tests. common.js re-exports these on BC. */
(function (root) {
  'use strict';

  var DEFAULT_SCHEMES = ['https:', 'http:'];
  var DEFAULT_REL = 'noopener noreferrer';

  // Query/hash parameters that can carry a login secret or an email address.
  // Removed from any URL before it is sent to analytics or stored.
  var SENSITIVE_URL_PARAMS = ['code', 'token', 'token_hash', 'access_token', 'refresh_token',
    'provider_token', 'provider_refresh_token', 'type', 'error', 'error_code',
    'error_description', 'email'];

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /**
   * The URL if it is safe to put in an href/src, else ''.
   *
   * HTML-escaping cannot stop `javascript:` - the scheme itself is the attack -
   * so every dynamic link goes through an allow-list of schemes.
   *
   * @param {*} value
   * @param {{schemes?: string[], allowRelative?: boolean, maxLength?: number}} [opts]
   */
  function safeUrl(value, opts) {
    opts = opts || {};
    if (value == null) return '';
    var s = String(value).trim();
    if (!s || s.length > (opts.maxLength || 2048)) return '';
    if (/[\u0000- \u007F]/.test(s)) return '';            // whitespace/control anywhere
    var m = /^([A-Za-z][A-Za-z0-9+.\-]*):/.exec(s);
    if (!m) {
      if (!opts.allowRelative || /^[\/\\]{2}/.test(s)) return ''; // no protocol-relative
      return s;
    }
    return (opts.schemes || DEFAULT_SCHEMES).indexOf(m[1].toLowerCase() + ':') !== -1 ? s : '';
  }

  /**
   * An outbound link that opens in a new tab, or just `innerHtml` when the URL
   * is unsafe. `innerHtml` must already be escaped.
   *
   * opts: safeUrl's options plus
   *   className  - class attribute
   *   rel        - rel attribute (default "noopener noreferrer")
   *   sponsored  - append "sponsored" to rel (affiliate links)
   */
  function extLink(url, innerHtml, opts) {
    opts = opts || {};
    var u = safeUrl(url, opts);
    if (!u) return innerHtml;
    var rel = opts.rel || DEFAULT_REL;
    if (opts.sponsored && !/(^|\s)sponsored(\s|$)/.test(rel)) rel += ' sponsored';
    return '<a' + (opts.className ? ' class="' + esc(opts.className) + '"' : '') +
      ' href="' + esc(u) + '" target="_blank" rel="' + esc(rel) + '">' + innerHtml + '</a>';
  }

  /** An https URL on one of the exact allowed hosts, else null. For window.location assignments. */
  function safeRedirect(url, hosts) {
    var u;
    try { u = new URL(String(url)); } catch (e) { return null; }
    return u.protocol === 'https:' && (hosts || []).indexOf(u.hostname) !== -1 ? u.href : null;
  }

  var NUMERIC = /^[+-]?\d+(\.\d+)?$/;

  /**
   * One CSV cell. Text starting with = + - @ tab or CR is prefixed with ' so a
   * spreadsheet shows it rather than evaluating it as a formula (OWASP CSV
   * injection). Plain numbers - including negative ones - are left alone.
   */
  function csvCell(v) {
    if (v == null) return '';
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    var s = String(v);
    if (/^[=+\-@\t\r]/.test(s) && !NUMERIC.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsv(rows) {
    return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n';
  }

  /** The URL with its hash and any login-secret/email parameters removed. Non-URLs pass through. */
  function scrubUrl(u) {
    if (typeof u !== 'string' || !/^https?:\/\//i.test(u)) return u;
    try {
      var url = new URL(u);
      url.hash = '';
      SENSITIVE_URL_PARAMS.forEach(function (p) { url.searchParams.delete(p); });
      return url.toString();
    } catch (e) { return u.split('#')[0].split('?')[0]; }
  }

  function scrubProps(o) {
    if (o && typeof o === 'object') {
      Object.keys(o).forEach(function (k) { if (typeof o[k] === 'string') o[k] = scrubUrl(o[k]); });
    }
    return o;
  }

  /** PostHog before_send hook: scrub every URL-valued property. */
  function scrubEvent(ev) {
    if (!ev) return ev;
    scrubProps(ev.properties); scrubProps(ev.$set); scrubProps(ev.$set_once);
    return ev;
  }

  /** 'jpeg'|'png'|'webp'|'gif'|'heic'|null from the first >=12 bytes. Never trusts a declared type. */
  function sniffImageType(b) {
    if (!b || b.length < 12) return null;
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpeg';
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'png';
    var a = String.fromCharCode.apply(null, Array.prototype.slice.call(b, 0, 12));
    if (a.slice(0, 4) === 'RIFF' && a.slice(8, 12) === 'WEBP') return 'webp';
    if (a.slice(0, 4) === 'GIF8') return 'gif';
    if (/^ftyp(heic|heix|mif1|msf1)/.test(a.slice(4, 12))) return 'heic';
    return null;
  }

  var api = {
    esc: esc, safeUrl: safeUrl, extLink: extLink, safeRedirect: safeRedirect,
    csvCell: csvCell, toCsv: toCsv, scrubUrl: scrubUrl, scrubEvent: scrubEvent,
    scrubProps: scrubProps, sniffImageType: sniffImageType,
    SENSITIVE_URL_PARAMS: SENSITIVE_URL_PARAMS
  };
  root.BearChartSanitize = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

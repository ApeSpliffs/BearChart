/*
 * sanitize.js unit tests: URL allow-listing, outbound links, CSV injection,
 * redirect allow-listing, analytics URL scrubbing and image sniffing.
 * Pure module - no DOM needed.  Run:  node --test tools/test_sanitize.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const S = require('../sanitize.js');

test('safeUrl rejects script-capable and malformed addresses', () => {
  const bad = ['javascript:alert(1)', 'JaVaScRiPt:x', ' javascript:x', 'java\tscript:x',
    'java\nscript:x', 'data:text/html,x', 'vbscript:x', 'https://x.com/ a', 'x'.repeat(3000)];
  for (const v of bad) assert.strictEqual(S.safeUrl(v), '', JSON.stringify(v.slice(0, 40)));
  assert.strictEqual(S.safeUrl('//evil.com', { allowRelative: true }), '', 'protocol-relative');
  assert.strictEqual(S.safeUrl('\\\\evil.com', { allowRelative: true }), '');
  assert.strictEqual(S.safeUrl(null), '');
  assert.strictEqual(S.safeUrl(undefined), '');
  assert.strictEqual(S.safeUrl(''), '');
});

test('safeUrl accepts http(s) and, when asked, relative paths', () => {
  assert.strictEqual(S.safeUrl('https://www.ebay.com/itm/1?a=b'), 'https://www.ebay.com/itm/1?a=b');
  assert.strictEqual(S.safeUrl('http://example.com/'), 'http://example.com/');
  assert.strictEqual(S.safeUrl('/images/lucky.jpg'), '', 'relative only when allowed');
  assert.strictEqual(S.safeUrl('/images/lucky.jpg', { allowRelative: true }), '/images/lucky.jpg');
  assert.strictEqual(S.safeUrl('http://example.com/', { schemes: ['https:'] }), '');
  assert.strictEqual(S.safeUrl('blob:https://x/1', { schemes: ['https:', 'blob:'] }), 'blob:https://x/1');
  assert.strictEqual(S.safeUrl('https://a.com/' + 'x'.repeat(600), { maxLength: 500 }), '');
  // An entity-encoded colon is not a scheme: it is a relative path, and esc()
  // keeps it inert when it is written into an attribute.
  const v = S.safeUrl('javascript&#58;x', { allowRelative: true });
  assert.strictEqual(v, 'javascript&#58;x');
  assert.strictEqual(S.esc(v), 'javascript&amp;#58;x');
});

test('extLink: unsafe url -> inner text only; safe url -> escaped, new tab, noopener', () => {
  assert.strictEqual(S.extLink('javascript:alert(1)', 'label'), 'label');
  const a = S.extLink('https://x.com/?a=1&b="2"', 'label', { className: 'btn' });
  assert.match(a, /^<a class="btn" href="https:\/\/x\.com\/\?a=1&amp;b=&quot;2&quot;" target="_blank" rel="noopener noreferrer">label<\/a>$/);
  assert.match(S.extLink('https://x.com', 'l', { sponsored: true }), /rel="noopener noreferrer sponsored"/);
  assert.match(S.extLink('https://x.com', 'l', { rel: 'noopener' }), /rel="noopener"/);
  assert.strictEqual(S.extLink('http://x.com', 'l', { schemes: ['https:'] }), 'l');
});

test('esc encodes the five HTML-significant characters', () => {
  assert.strictEqual(S.esc(`<a href="x">'&`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  assert.strictEqual(S.esc(null), '');
  assert.strictEqual(S.esc(0), '0');
});

test('csvCell neutralises formulas but leaves numbers alone', () => {
  assert.strictEqual(S.csvCell('=1+1'), "'=1+1");
  assert.strictEqual(S.csvCell('@SUM(A1)'), "'@SUM(A1)");
  assert.strictEqual(S.csvCell('+cmd'), "'+cmd");
  assert.strictEqual(S.csvCell('-cmd'), "'-cmd");
  assert.strictEqual(S.csvCell('\tx'), "'\tx");
  assert.strictEqual(S.csvCell('\rx'), "\"'\rx\"");
  assert.strictEqual(S.csvCell('-12.5'), '-12.5');
  assert.strictEqual(S.csvCell('+3'), '+3');
  assert.strictEqual(S.csvCell(-5), '-5');
  assert.strictEqual(S.csvCell(true), 'true');
  assert.strictEqual(S.csvCell('a,b'), '"a,b"');
  assert.strictEqual(S.csvCell('=a,b'), "\"'=a,b\"");
  assert.strictEqual(S.csvCell('say "hi"'), '"say ""hi"""');
  assert.strictEqual(S.csvCell('two\nlines'), '"two\nlines"');
  assert.strictEqual(S.csvCell(null), '');
  assert.strictEqual(S.csvCell(undefined), '');
});

test('toCsv joins cells with commas and rows with CRLF, ending in CRLF', () => {
  assert.strictEqual(S.toCsv([['a', 'b'], [1, '=x']]), "a,b\r\n1,'=x\r\n");
});

test('safeRedirect allows https on exact hosts only', () => {
  const hosts = ['checkout.stripe.com', 'billing.stripe.com'];
  assert.strictEqual(S.safeRedirect('https://checkout.stripe.com/c/x', hosts), 'https://checkout.stripe.com/c/x');
  assert.strictEqual(S.safeRedirect('https://billing.stripe.com/p/session/1', hosts), 'https://billing.stripe.com/p/session/1');
  assert.strictEqual(S.safeRedirect('http://checkout.stripe.com/c/x', hosts), null);
  assert.strictEqual(S.safeRedirect('https://checkout.stripe.com.evil.com/', hosts), null);
  assert.strictEqual(S.safeRedirect('https://evil.com/?checkout.stripe.com', hosts), null);
  assert.strictEqual(S.safeRedirect('javascript:alert(1)//checkout.stripe.com', hosts), null);
  assert.strictEqual(S.safeRedirect('not a url', hosts), null);
  assert.strictEqual(S.safeRedirect(undefined, hosts), null);
});

test('scrubUrl removes login secrets and the hash, keeps the rest', () => {
  assert.strictEqual(S.scrubUrl('https://b.test/account.html#access_token=a&refresh_token=b&type=magiclink'),
    'https://b.test/account.html');
  assert.strictEqual(S.scrubUrl('https://b.test/account.html?code=abc&u=jay'), 'https://b.test/account.html?u=jay');
  assert.strictEqual(S.scrubUrl('https://b.test/account.html?token_hash=h&type=recovery'),
    'https://b.test/account.html');
  assert.strictEqual(S.scrubUrl('https://b.test/a?email=x%40y.z&q=bear'), 'https://b.test/a?q=bear');
  assert.strictEqual(S.scrubUrl('not a url'), 'not a url');
  assert.strictEqual(S.scrubUrl(42), 42);
});

test('scrubEvent cleans the URL properties PostHog sends', () => {
  const ev = S.scrubEvent({
    event: '$pageview',
    properties: { $current_url: 'https://b.test/account.html?code=abc', $referrer: 'https://b.test/x#access_token=t',
      $initial_current_url: 'https://b.test/?token_hash=h&type=email', n: 3 },
    $set_once: { $initial_referrer: 'https://b.test/?refresh_token=r' }
  });
  assert.strictEqual(ev.properties.$current_url, 'https://b.test/account.html');
  assert.strictEqual(ev.properties.$referrer, 'https://b.test/x');
  assert.strictEqual(ev.properties.$initial_current_url, 'https://b.test/');
  assert.strictEqual(ev.properties.n, 3);
  assert.strictEqual(ev.$set_once.$initial_referrer, 'https://b.test/');
  assert.strictEqual(S.scrubEvent(null), null);
});

test('sniffImageType reads the bytes, not the declared type', () => {
  const pad = (a) => Uint8Array.from(a.concat(new Array(Math.max(0, 12 - a.length)).fill(0)));
  const ascii = (s) => Array.from(Buffer.from(s, 'latin1'));
  assert.strictEqual(S.sniffImageType(pad([0xFF, 0xD8, 0xFF, 0xE0])), 'jpeg');
  assert.strictEqual(S.sniffImageType(pad([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])), 'png');
  assert.strictEqual(S.sniffImageType(Uint8Array.from(ascii('RIFF\x00\x00\x00\x00WEBP'))), 'webp');
  assert.strictEqual(S.sniffImageType(pad(ascii('GIF89a'))), 'gif');
  assert.strictEqual(S.sniffImageType(Uint8Array.from(ascii('\x00\x00\x00\x18ftypheic'))), 'heic');
  assert.strictEqual(S.sniffImageType(Uint8Array.from(ascii('<!DOCTYPE html>'))), null);
  assert.strictEqual(S.sniffImageType(Uint8Array.from([0xFF, 0xD8, 0xFF])), null, 'fewer than 12 bytes');
  assert.strictEqual(S.sniffImageType(null), null);
});

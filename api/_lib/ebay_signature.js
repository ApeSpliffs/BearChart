/**
 * eBay notification signatures (pure; no network, no env).
 *
 * eBay signs every Marketplace Account Deletion POST. The X-EBAY-SIGNATURE
 * header is base64(JSON {alg, kid, signature, digest}); `kid` names a public key
 * fetched from eBay's Notification API (see ebay_public_keys.js), and
 * `signature` is a base64 DER ECDSA signature over the raw request body.
 *
 * Files under api/ whose name starts with "_" are not routes on Vercel.
 */
'use strict';

const crypto = require('crypto');

const KID = /^[A-Za-z0-9-]{1,128}$/;

/** {alg, kid, signature, digest} or null when the header is unusable. */
function parseSignatureHeader(h) {
  if (typeof h !== 'string' || !h || h.length > 8192) return null;
  let obj;
  try {
    obj = JSON.parse(Buffer.from(h, 'base64').toString('utf8'));
  } catch (e) {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const { alg, kid, signature, digest } = obj;
  if (typeof kid !== 'string' || !KID.test(kid)) return null;
  if (typeof signature !== 'string' || !signature) return null;
  if (typeof alg !== 'string' || typeof digest !== 'string') return null;
  return { alg, kid, signature, digest };
}

/** eBay returns the key as one line; Node wants proper PEM line breaks. */
function normalisePem(key) {
  const s = String(key || '').trim();
  const m = /^-----BEGIN PUBLIC KEY-----([\s\S]*?)-----END PUBLIC KEY-----$/.exec(s);
  if (!m) return s;
  const body = m[1].replace(/\s+/g, '');
  const lines = body.match(/.{1,64}/g) || [];
  return '-----BEGIN PUBLIC KEY-----\n' + lines.join('\n') + '\n-----END PUBLIC KEY-----\n';
}

/**
 * True only for a valid ECDSA/SHA1 signature from the given key over rawBody.
 * publicKey is eBay's {key, algorithm, digest}. Never throws.
 */
function verifyNotification({ rawBody, header, publicKey }) {
  try {
    if (!header || !publicKey || typeof publicKey.key !== 'string') return false;
    if (String(publicKey.algorithm).toUpperCase() !== 'ECDSA') return false;
    if (String(publicKey.digest).toUpperCase() !== 'SHA1') return false;
    if (String(header.alg).toUpperCase() !== 'ECDSA') return false;
    if (String(header.digest).toUpperCase() !== 'SHA1') return false;
    const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8');
    // An ECDSA claim must come with an EC key, whatever the metadata says.
    const key = crypto.createPublicKey(normalisePem(publicKey.key));
    if (key.asymmetricKeyType !== 'ec') return false;
    return crypto.verify(
      'sha1',
      body,
      { key, dsaEncoding: 'der' },
      Buffer.from(header.signature, 'base64'),
    );
  } catch (e) {
    return false;
  }
}

module.exports = { parseSignatureHeader, normalisePem, verifyNotification };

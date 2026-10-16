/**
 * eBay Marketplace Account Deletion / Closure notifications.
 *
 * eBay will not release a production keyset until this endpoint answers their
 * challenge. Both verbs live at one URL, which is what eBay expects:
 *
 *   GET  ?challenge_code=...  -> prove we own the endpoint
 *   POST {notification}       -> a user closed their account; forget them
 *
 * The challenge response is sha256(challengeCode + verificationToken +
 * endpointUrl), hashed in exactly that order over the raw UTF-8 bytes. The
 * endpoint URL must match what was typed into eBay's form character for
 * character - a trailing slash or an http/https mismatch is the usual reason
 * validation fails, so it is configured rather than reconstructed from the
 * request (proxies rewrite Host and protocol headers and would silently
 * produce a different string than the one eBay hashed).
 *
 * POSTs are authenticated: the X-EBAY-SIGNATURE header names an eBay public
 * key (fetched with this app's client credentials and cached) and carries an
 * ECDSA signature over the raw body. Anything unsigned or mis-signed is a 412.
 *
 * Plush Price Guide stores no eBay seller usernames or ids (tools/ebay_active.py drops
 * the seller), so a verified notification has nothing to delete. Only the
 * notification id is logged - never userId, username or eiasToken.
 */
'use strict';

const crypto = require('crypto');
const { parseSignatureHeader, verifyNotification } = require('./_lib/ebay_signature.js');
const { createEbayKeyFetcher } = require('./_lib/ebay_public_keys.js');

const MAX_BODY = 64 * 1024;

function challengeResponse(code, token, endpoint) {
  return crypto
    .createHash('sha256')
    .update(code, 'utf8')
    .update(token, 'utf8')
    .update(endpoint, 'utf8')
    .digest('hex');
}

function readStream(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      const b = Buffer.isBuffer(c) ? c : Buffer.from(c);
      size += b.length;
      if (size > MAX_BODY) { reject(new Error('body too large')); return; }
      chunks.push(b);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** The exact bytes eBay signed, as a string. */
async function rawBodyOf(req) {
  if (typeof req.rawBody === 'string') return req.rawBody;
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody.toString('utf8');
  // Read the stream before touching req.body: on some hosts req.body is a lazy
  // getter that consumes (and re-serialises) it.
  if (req.readable) return readStream(req);
  return JSON.stringify(req.body === undefined ? null : req.body);
}

function createHandler({ env, keyFetcher, log }) {
  let built = null; // {clientId, fetchKey} - the lazily created fetcher

  function fetcherFor() {
    if (keyFetcher) return keyFetcher;
    const clientId = env.EBAY_CLIENT_ID;
    const clientSecret = env.EBAY_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;
    if (!built || built.clientId !== clientId) {
      built = { clientId, fetchKey: createEbayKeyFetcher({ clientId, clientSecret }) };
    }
    return built.fetchKey;
  }

  return async function handler(req, res) {
    const token = env.EBAY_VERIFICATION_TOKEN;
    const endpoint = env.EBAY_DELETION_ENDPOINT;
    if (!token || !endpoint) {
      // Names go to the server log only; the response says nothing about
      // which settings exist.
      const missing = [];
      if (!token) missing.push('EBAY_VERIFICATION_TOKEN');
      if (!endpoint) missing.push('EBAY_DELETION_ENDPOINT');
      log.error('ebay-deletion: unset: %s', missing.join(', '));
      return res.status(500).json({ error: 'endpoint not configured' });
    }

    if (req.method === 'GET') {
      const code = req.query && req.query.challenge_code;
      if (typeof code !== 'string' || !code || code.length > 256) {
        return res.status(400).json({ error: 'challenge_code required' });
      }
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).json({ challengeResponse: challengeResponse(code, token, endpoint) });
    }

    if (req.method === 'POST') {
      let rawBody;
      try {
        rawBody = await rawBodyOf(req);
      } catch (e) {
        return res.status(413).json({ error: 'body too large' });
      }

      const headers = req.headers || {};
      const header = parseSignatureHeader(headers['x-ebay-signature']);
      if (!header) return res.status(412).json({ error: 'invalid signature' });

      const fetchKey = fetcherFor();
      if (!fetchKey) {
        log.error('ebay-deletion: EBAY_CLIENT_ID / EBAY_CLIENT_SECRET not set; cannot verify');
        return res.status(500).json({ error: 'endpoint not configured' });
      }

      let publicKey;
      try {
        publicKey = await fetchKey(header.kid);
      } catch (e) {
        if (e && e.code === 'unknown_key') return res.status(412).json({ error: 'invalid signature' });
        log.error('ebay-deletion: public key unavailable: %s', (e && e.message) || 'error');
        return res.status(503).json({ error: 'try again later' });
      }

      if (!verifyNotification({ rawBody, header, publicKey })) {
        return res.status(412).json({ error: 'invalid signature' });
      }

      let notificationId = 'unknown';
      try {
        const parsed = JSON.parse(rawBody);
        const n = parsed && parsed.notification;
        if (n && typeof n.notificationId === 'string') notificationId = n.notificationId.slice(0, 128);
      } catch (e) { /* signed but not JSON - still acknowledged */ }

      // Only the id: never userId, username or eiasToken. Logged BEFORE
      // responding: a host may freeze the function once the response is sent.
      log.info('ebay-deletion: closure notification verified id=%s', notificationId);
      res.status(204).end();
      return;
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method not allowed' });
  };
}

module.exports = createHandler({ env: process.env, keyFetcher: null /* lazily built from env */, log: console });
module.exports.createHandler = createHandler;
module.exports.challengeResponse = challengeResponse;

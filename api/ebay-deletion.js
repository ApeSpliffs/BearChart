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
 */
'use strict';

const crypto = require('crypto');

const TOKEN = process.env.EBAY_VERIFICATION_TOKEN;
const ENDPOINT = process.env.EBAY_DELETION_ENDPOINT;

function challengeResponse(challengeCode) {
  return crypto
    .createHash('sha256')
    .update(challengeCode, 'utf8')
    .update(TOKEN, 'utf8')
    .update(ENDPOINT, 'utf8')
    .digest('hex');
}

module.exports = (req, res) => {
  // Misconfiguration must be loud here. Answering the challenge with a hash
  // built from an undefined token would "succeed" with a wrong digest and
  // leave eBay reporting a validation failure with nothing to point at.
  if (!TOKEN || !ENDPOINT) {
    console.error('ebay-deletion: EBAY_VERIFICATION_TOKEN and ' +
                  'EBAY_DELETION_ENDPOINT must both be set.');
    return res.status(500).json({ error: 'endpoint not configured' });
  }

  if (req.method === 'GET') {
    const code = req.query && req.query.challenge_code;
    if (!code) return res.status(400).json({ error: 'challenge_code required' });
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({ challengeResponse: challengeResponse(code) });
  }

  if (req.method === 'POST') {
    // Acknowledge first. eBay retries on anything slow or non-2xx and will
    // disable the keyset if this endpoint looks flaky, so no deletion work
    // happens on the request thread.
    res.status(204).end();

    const data = (req.body && req.body.notification && req.body.notification.data) || {};
    // Usernames are the only eBay user data BearChart holds, and they are not
    // a key anything is filed under - so record the request for the operator
    // rather than pretending to complete a deletion we cannot do from here.
    console.log('ebay-deletion: closure notification for userId=%s eiasToken=%s',
                data.userId || 'unknown', data.eiasToken || 'unknown');
    return;
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'method not allowed' });
};

module.exports.challengeResponse = challengeResponse;

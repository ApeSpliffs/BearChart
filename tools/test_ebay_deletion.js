/** The challenge hash and the request handling eBay's validation depends on. */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const path = require('path');

const TOKEN = 'test-token-0123456789abcdef0123456789';
const ENDPOINT = 'https://example.com/api/ebay-deletion';
process.env.EBAY_VERIFICATION_TOKEN = TOKEN;
process.env.EBAY_DELETION_ENDPOINT = ENDPOINT;

const handler = require(path.join(__dirname, '..', 'api', 'ebay-deletion.js'));

/** Minimal stand-in for the Vercel response object. */
function mockRes() {
  const res = { statusCode: null, body: null, headers: {}, ended: false };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; return res; };
  res.end = () => { res.ended = true; return res; };
  return res;
}

test('challenge hash is challengeCode + token + endpoint, in that order', () => {
  const expected = crypto.createHash('sha256')
    .update('abc123').update(TOKEN).update(ENDPOINT).digest('hex');
  assert.strictEqual(handler.challengeResponse('abc123'), expected);
});

test('a different order produces a different hash', () => {
  // Guards the single most common way this endpoint is written wrong.
  const wrong = crypto.createHash('sha256')
    .update(TOKEN).update('abc123').update(ENDPOINT).digest('hex');
  assert.notStrictEqual(handler.challengeResponse('abc123'), wrong);
});

test('GET answers the challenge with 200 and JSON', () => {
  const res = mockRes();
  handler({ method: 'GET', query: { challenge_code: 'abc123' } }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.headers['content-type'], 'application/json');
  assert.strictEqual(res.body.challengeResponse, handler.challengeResponse('abc123'));
  assert.match(res.body.challengeResponse, /^[0-9a-f]{64}$/);
});

test('GET without a challenge_code is a 400, not a hash of undefined', () => {
  const res = mockRes();
  handler({ method: 'GET', query: {} }, res);
  assert.strictEqual(res.statusCode, 400);
});

test('POST acknowledges immediately with a 2xx', () => {
  const res = mockRes();
  handler({ method: 'POST', body: { notification: { data: { userId: 'u1' } } } }, res);
  assert.strictEqual(res.statusCode, 204);
  assert.ok(res.ended);
});

test('POST survives a body with no notification', () => {
  const res = mockRes();
  handler({ method: 'POST', body: {} }, res);
  assert.strictEqual(res.statusCode, 204);
});

test('other verbs are rejected', () => {
  const res = mockRes();
  handler({ method: 'DELETE' }, res);
  assert.strictEqual(res.statusCode, 405);
});

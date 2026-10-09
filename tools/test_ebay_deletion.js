/** eBay account-deletion endpoint: the challenge hash, signed POSTs, and no leaks. */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const path = require('path');

const API = path.join(__dirname, '..', 'api');
const mod = require(path.join(API, 'ebay-deletion.js'));
const { createHandler, challengeResponse } = mod;
const { parseSignatureHeader, normalisePem, verifyNotification } =
  require(path.join(API, '_lib', 'ebay_signature.js'));
const { createEbayKeyFetcher } = require(path.join(API, '_lib', 'ebay_public_keys.js'));

const TOKEN = 'test-token-0123456789abcdef0123456789';
const ENDPOINT = 'https://example.com/api/ebay-deletion';
const ENV = {
  EBAY_VERIFICATION_TOKEN: TOKEN,
  EBAY_DELETION_ENDPOINT: ENDPOINT,
  EBAY_CLIENT_ID: 'client-id',
  EBAY_CLIENT_SECRET: 'client-secret',
};

const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
// eBay serves the PEM on a single line.
const ONE_LINE_PEM = publicKey.export({ type: 'spki', format: 'pem' }).replace(/\n/g, '');
const EBAY_KEY = { key: ONE_LINE_PEM, algorithm: 'ECDSA', digest: 'SHA1' };
const KID = 'kid-0123-abcd';

const USER_ID = 'ebay-user-SECRET-42';
const EIAS = 'nY+sHZ2PrBmdj6wVnY+sEZ2PrA2dj6AFkYWnC5iEpw2dj6x9nY+seQ==';
const BODY = JSON.stringify({
  metadata: { topic: 'MARKETPLACE_ACCOUNT_DELETION', schemaVersion: '1.0', deprecated: false },
  notification: {
    notificationId: 'notif-1',
    eventDate: '2026-10-08T00:00:00.000Z',
    publishDate: '2026-10-08T00:00:00.000Z',
    publishAttemptCount: 1,
    data: { username: 'someseller', userId: USER_ID, eiasToken: EIAS },
  },
});

function sigHeader(body, overrides) {
  const signature = crypto.sign('sha1', Buffer.from(body, 'utf8'), privateKey).toString('base64');
  const h = Object.assign({ alg: 'ECDSA', kid: KID, signature, digest: 'SHA1' }, overrides || {});
  return Buffer.from(JSON.stringify(h)).toString('base64');
}

/** Minimal stand-in for the Vercel response object. */
function mockRes() {
  const res = { statusCode: null, body: null, headers: {}, ended: false };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; return res; };
  res.end = () => { res.ended = true; return res; };
  return res;
}

function capturingLog() {
  const lines = [];
  const fmt = (args) => args.map(String).join(' ');
  return {
    lines,
    info: (...a) => lines.push(fmt(a)),
    log: (...a) => lines.push(fmt(a)),
    warn: (...a) => lines.push(fmt(a)),
    error: (...a) => lines.push(fmt(a)),
  };
}

function setup(opts) {
  opts = opts || {};
  const log = capturingLog();
  const calls = [];
  const keyFetcher = opts.keyFetcher || (async (kid) => { calls.push(kid); return EBAY_KEY; });
  const handler = createHandler({ env: opts.env || ENV, keyFetcher, log });
  return { handler, log, calls };
}

async function post(handler, body, header) {
  const res = mockRes();
  const headers = {};
  if (header !== undefined) headers['x-ebay-signature'] = header;
  await handler({ method: 'POST', headers, rawBody: body }, res);
  return res;
}

// --- challenge ------------------------------------------------------------

test('challenge hash is challengeCode + token + endpoint, in that order', () => {
  const expected = crypto.createHash('sha256')
    .update('abc123').update(TOKEN).update(ENDPOINT).digest('hex');
  assert.strictEqual(challengeResponse('abc123', TOKEN, ENDPOINT), expected);
});

test('a different order produces a different hash', () => {
  // Guards the single most common way this endpoint is written wrong.
  const wrong = crypto.createHash('sha256')
    .update(TOKEN).update('abc123').update(ENDPOINT).digest('hex');
  assert.notStrictEqual(challengeResponse('abc123', TOKEN, ENDPOINT), wrong);
});

test('GET answers the challenge with 200 and JSON', async () => {
  const { handler } = setup();
  const res = mockRes();
  await handler({ method: 'GET', query: { challenge_code: 'abc123' } }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.headers['content-type'], 'application/json');
  assert.strictEqual(res.body.challengeResponse, challengeResponse('abc123', TOKEN, ENDPOINT));
  assert.match(res.body.challengeResponse, /^[0-9a-f]{64}$/);
});

test('GET without a challenge_code is a 400, not a hash of undefined', async () => {
  const { handler } = setup();
  const res = mockRes();
  await handler({ method: 'GET', query: {} }, res);
  assert.strictEqual(res.statusCode, 400);
});

test('a repeated challenge_code (array) is a 400', async () => {
  const { handler } = setup();
  const res = mockRes();
  await handler({ method: 'GET', query: { challenge_code: ['a', 'b'] } }, res);
  assert.strictEqual(res.statusCode, 400);
});

test('a 300-character challenge_code is a 400', async () => {
  const { handler } = setup();
  const res = mockRes();
  await handler({ method: 'GET', query: { challenge_code: 'x'.repeat(300) } }, res);
  assert.strictEqual(res.statusCode, 400);
});

test('the module export reads env at call time', async () => {
  const saved = { t: process.env.EBAY_VERIFICATION_TOKEN, e: process.env.EBAY_DELETION_ENDPOINT };
  process.env.EBAY_VERIFICATION_TOKEN = TOKEN;
  process.env.EBAY_DELETION_ENDPOINT = ENDPOINT;
  try {
    const res = mockRes();
    await mod({ method: 'GET', query: { challenge_code: 'abc123' } }, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.challengeResponse, challengeResponse('abc123', TOKEN, ENDPOINT));
  } finally {
    if (saved.t === undefined) delete process.env.EBAY_VERIFICATION_TOKEN; else process.env.EBAY_VERIFICATION_TOKEN = saved.t;
    if (saved.e === undefined) delete process.env.EBAY_DELETION_ENDPOINT; else process.env.EBAY_DELETION_ENDPOINT = saved.e;
  }
});

// --- signed POST ------------------------------------------------------------

test('a validly signed notification is acknowledged with 204', async () => {
  const { handler, calls } = setup();
  const res = await post(handler, BODY, sigHeader(BODY));
  assert.strictEqual(res.statusCode, 204);
  assert.ok(res.ended);
  assert.deepStrictEqual(calls, [KID]);
});

test('a raw Buffer body verifies too', async () => {
  const { handler } = setup();
  const res = mockRes();
  await handler({ method: 'POST', headers: { 'x-ebay-signature': sigHeader(BODY) },
    rawBody: Buffer.from(BODY, 'utf8') }, res);
  assert.strictEqual(res.statusCode, 204);
});

test('the body is read from the stream when no rawBody is given', async () => {
  const { Readable } = require('stream');
  const { handler } = setup();
  const req = Readable.from([Buffer.from(BODY.slice(0, 10)), Buffer.from(BODY.slice(10))]);
  req.method = 'POST';
  req.headers = { 'x-ebay-signature': sigHeader(BODY) };
  const res = mockRes();
  await handler(req, res);
  assert.strictEqual(res.statusCode, 204);
});

test('a tampered body is a 412', async () => {
  const { handler } = setup();
  const res = await post(handler, BODY.replace('notif-1', 'notif-2'), sigHeader(BODY));
  assert.strictEqual(res.statusCode, 412);
});

test('no signature header is a 412', async () => {
  const { handler, calls } = setup();
  const res = await post(handler, BODY, undefined);
  assert.strictEqual(res.statusCode, 412);
  assert.strictEqual(calls.length, 0);
});

test('a garbage signature header is a 412', async () => {
  const { handler, calls } = setup();
  for (const h of ['not base64 at all!!', Buffer.from('not json').toString('base64'), '']) {
    const res = await post(handler, BODY, h);
    assert.strictEqual(res.statusCode, 412, JSON.stringify(h));
  }
  assert.strictEqual(calls.length, 0);
});

test('a bad kid is a 412 and the key fetcher is never called', async () => {
  const { handler, calls } = setup();
  const res = await post(handler, BODY, sigHeader(BODY, { kid: '../x' }));
  assert.strictEqual(res.statusCode, 412);
  assert.strictEqual(calls.length, 0);
});

test('an unknown key is a 412', async () => {
  const keyFetcher = async () => { const e = new Error('nope'); e.code = 'unknown_key'; throw e; };
  const { handler } = setup({ keyFetcher });
  const res = await post(handler, BODY, sigHeader(BODY));
  assert.strictEqual(res.statusCode, 412);
});

test('an unavailable key service is a 503 so eBay retries', async () => {
  const keyFetcher = async () => { const e = new Error('down'); e.code = 'unavailable'; throw e; };
  const { handler } = setup({ keyFetcher });
  const res = await post(handler, BODY, sigHeader(BODY));
  assert.strictEqual(res.statusCode, 503);
});

test('an RSA alg in the header is a 412', async () => {
  const { handler } = setup();
  const res = await post(handler, BODY, sigHeader(BODY, { alg: 'RSA' }));
  assert.strictEqual(res.statusCode, 412);
});

test('a key that is not ECDSA/SHA1 is a 412', async () => {
  const { handler } = setup({ keyFetcher: async () => Object.assign({}, EBAY_KEY, { digest: 'SHA256' }) });
  const res = await post(handler, BODY, sigHeader(BODY));
  assert.strictEqual(res.statusCode, 412);
});

test('the log never carries userId or eiasToken', async () => {
  const { handler, log } = setup();
  await post(handler, BODY, sigHeader(BODY));
  await post(handler, BODY.replace('notif-1', 'x'), sigHeader(BODY));
  const all = log.lines.join('\n');
  assert.ok(all.includes('notif-1'), 'the notification id is logged');
  assert.ok(!all.includes(USER_ID), 'userId must not be logged');
  assert.ok(!all.includes(EIAS), 'eiasToken must not be logged');
  assert.ok(!all.includes('someseller'), 'username must not be logged');
});

test('missing client credentials (no injected fetcher) is a generic 500', async () => {
  const log = capturingLog();
  const env = Object.assign({}, ENV);
  delete env.EBAY_CLIENT_SECRET;
  const handler = createHandler({ env, keyFetcher: null, log });
  const res = await post(handler, BODY, sigHeader(BODY));
  assert.strictEqual(res.statusCode, 500);
  assert.ok(!/EBAY_/.test(JSON.stringify(res.body)));
});

test('other verbs are rejected', async () => {
  const { handler } = setup();
  const res = mockRes();
  await handler({ method: 'DELETE' }, res);
  assert.strictEqual(res.statusCode, 405);
});

test('missing config is a 500 that names nothing, and no value is echoed', async () => {
  for (const drop of ['EBAY_VERIFICATION_TOKEN', 'EBAY_DELETION_ENDPOINT']) {
    const env = Object.assign({}, ENV);
    delete env[drop];
    const log = capturingLog();
    const handler = createHandler({ env, keyFetcher: null, log });
    const res = mockRes();
    await handler({ method: 'GET', query: { challenge_code: 'abc123' } }, res);
    assert.strictEqual(res.statusCode, 500);
    const body = JSON.stringify(res.body);
    assert.ok(!('missing' in res.body), 'no missing key in the response');
    assert.ok(!/EBAY_/.test(body), 'no variable names in the response');
    assert.ok(!body.includes(TOKEN) && !body.includes(ENDPOINT), 'no values in the response');
    assert.ok(log.lines.join('\n').includes(drop), 'the server log names the missing variable');
  }
});

// --- pure helpers -------------------------------------------------------------

test('parseSignatureHeader requires a well-formed kid', () => {
  assert.strictEqual(parseSignatureHeader(sigHeader(BODY)).kid, KID);
  assert.strictEqual(parseSignatureHeader(sigHeader(BODY, { kid: '' })), null);
  assert.strictEqual(parseSignatureHeader(sigHeader(BODY, { kid: 'a'.repeat(129) })), null);
  assert.strictEqual(parseSignatureHeader(undefined), null);
});

test('normalisePem of a one-line key is accepted by createPublicKey', () => {
  assert.ok(!ONE_LINE_PEM.includes('\n'));
  const pem = normalisePem(ONE_LINE_PEM);
  const k = crypto.createPublicKey(pem);
  assert.strictEqual(k.asymmetricKeyType, 'ec');
});

test('verifyNotification never throws on junk', () => {
  assert.strictEqual(verifyNotification({ rawBody: BODY, header: { alg: 'ECDSA', digest: 'SHA1', signature: 'AAAA' },
    publicKey: { key: 'garbage', algorithm: 'ECDSA', digest: 'SHA1' } }), false);
  assert.strictEqual(verifyNotification({}), false);
});

// --- key fetcher -----------------------------------------------------------------

function fakeFetch(opts) {
  opts = opts || {};
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    if (url.includes('/oauth2/token')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'app-token', expires_in: 7200 }) };
    }
    if (opts.keyStatus && opts.keyStatus !== 200) {
      return { ok: false, status: opts.keyStatus, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => EBAY_KEY };
  };
  return { impl, calls };
}

test('the key fetcher caches per kid and refetches after the TTL', async () => {
  let t = 1000000;
  const f = fakeFetch();
  const fetchKey = createEbayKeyFetcher({ clientId: 'id', clientSecret: 'secret',
    fetchImpl: f.impl, ttlMs: 60000, now: () => t });
  assert.deepStrictEqual(await fetchKey(KID), EBAY_KEY);
  assert.deepStrictEqual(await fetchKey(KID), EBAY_KEY);
  const keyCalls = () => f.calls.filter((c) => c.url.includes('/public_key/')).length;
  assert.strictEqual(keyCalls(), 1, 'one key fetch for two requests');
  assert.strictEqual(f.calls.filter((c) => c.url.includes('/oauth2/token')).length, 1);
  const tokenCall = f.calls.find((c) => c.url.includes('/oauth2/token'));
  assert.strictEqual(tokenCall.init.method, 'POST');
  assert.strictEqual(tokenCall.init.headers.authorization,
    'Basic ' + Buffer.from('id:secret').toString('base64'));
  assert.match(tokenCall.init.body, /grant_type=client_credentials/);
  const keyCall = f.calls.find((c) => c.url.includes('/public_key/'));
  assert.strictEqual(keyCall.url, 'https://api.ebay.com/commerce/notification/v1/public_key/' + KID);
  assert.strictEqual(keyCall.init.headers.authorization, 'Bearer app-token');
  t += 60001;
  await fetchKey(KID);
  assert.strictEqual(keyCalls(), 2, 'TTL expiry triggers a refetch');
});

test('the key fetcher maps 404 to unknown_key and other failures to unavailable', async () => {
  const notFound = createEbayKeyFetcher({ clientId: 'id', clientSecret: 's', fetchImpl: fakeFetch({ keyStatus: 404 }).impl });
  await assert.rejects(notFound(KID), (e) => e.code === 'unknown_key');
  const broken = createEbayKeyFetcher({ clientId: 'id', clientSecret: 's', fetchImpl: fakeFetch({ keyStatus: 500 }).impl });
  await assert.rejects(broken(KID), (e) => e.code === 'unavailable');
  const offline = createEbayKeyFetcher({ clientId: 'id', clientSecret: 's',
    fetchImpl: async () => { throw new Error('ECONNRESET'); } });
  await assert.rejects(offline(KID), (e) => e.code === 'unavailable');
});

test('end to end: the real fetcher with a fake network verifies a signed POST', async () => {
  const f = fakeFetch();
  const keyFetcher = createEbayKeyFetcher({ clientId: 'id', clientSecret: 's', fetchImpl: f.impl });
  const { handler } = setup({ keyFetcher });
  assert.strictEqual((await post(handler, BODY, sigHeader(BODY))).statusCode, 204);
  assert.strictEqual((await post(handler, BODY, sigHeader(BODY))).statusCode, 204);
  assert.strictEqual(f.calls.filter((c) => c.url.includes('/public_key/')).length, 1);
});

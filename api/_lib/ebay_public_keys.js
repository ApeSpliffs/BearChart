/**
 * Fetches and caches eBay notification public keys by `kid`.
 *
 *   const fetchKey = createEbayKeyFetcher({ clientId, clientSecret });
 *   const { key, algorithm, digest } = await fetchKey(kid);
 *
 * Errors carry a `code`: 'unknown_key' (eBay says 404 - reject the message) or
 * 'unavailable' (anything else - answer 503 so eBay retries later).
 */
'use strict';

const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const KEY_URL = 'https://api.ebay.com/commerce/notification/v1/public_key/';
const SCOPE = 'https://api.ebay.com/oauth/api_scope';
const MAX_KEYS = 50;

function fail(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

function createEbayKeyFetcher({
  clientId, clientSecret, fetchImpl = (...a) => fetch(...a), ttlMs = 3600000, now = Date.now,
}) {
  let token = null; // {value, expiresAt}
  const keys = new Map(); // kid -> {value, expiresAt}

  async function appToken() {
    if (token && token.expiresAt > now()) return token.value;
    let res;
    try {
      res = await fetchImpl(TOKEN_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64'),
        },
        body: 'grant_type=client_credentials&scope=' + encodeURIComponent(SCOPE),
      });
    } catch (e) {
      throw fail('unavailable', 'token request failed');
    }
    if (!res.ok) throw fail('unavailable', 'token request returned ' + res.status);
    let data;
    try { data = await res.json(); } catch (e) { throw fail('unavailable', 'token response unreadable'); }
    if (!data || typeof data.access_token !== 'string') throw fail('unavailable', 'no access token');
    const life = Math.max(0, (Number(data.expires_in) || 0) - 60) * 1000;
    token = { value: data.access_token, expiresAt: now() + life };
    return token.value;
  }

  return async function fetchKey(kid) {
    const hit = keys.get(kid);
    if (hit && hit.expiresAt > now()) return hit.value;
    const bearer = await appToken();
    let res;
    try {
      res = await fetchImpl(KEY_URL + encodeURIComponent(kid), {
        headers: { authorization: 'Bearer ' + bearer, accept: 'application/json' },
      });
    } catch (e) {
      throw fail('unavailable', 'key request failed');
    }
    if (res.status === 404) throw fail('unknown_key');
    if (!res.ok) throw fail('unavailable', 'key request returned ' + res.status);
    let data;
    try { data = await res.json(); } catch (e) { throw fail('unavailable', 'key response unreadable'); }
    if (!data || typeof data.key !== 'string') throw fail('unavailable', 'key response malformed');
    const value = { key: data.key, algorithm: data.algorithm, digest: data.digest };
    if (keys.size >= MAX_KEYS && !keys.has(kid)) keys.delete(keys.keys().next().value);
    keys.set(kid, { value, expiresAt: now() + ttlMs });
    return value;
  };
}

module.exports = { createEbayKeyFetcher };

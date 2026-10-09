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
const MAX_MISSES = 50;
// Lookups that reach eBay (cache misses), per rolling minute. Beyond this the
// caller gets 'unavailable' (-> 503, eBay retries later), so a flood of
// messages naming made-up kids cannot become a flood of eBay API calls.
const MAX_LOOKUPS_PER_MINUTE = 10;

function fail(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

function createEbayKeyFetcher({
  clientId, clientSecret, fetchImpl = (...a) => fetch(...a), ttlMs = 3600000,
  unknownTtlMs = 600000, now = Date.now, maxLookupsPerMinute = MAX_LOOKUPS_PER_MINUTE,
}) {
  let token = null; // {value, expiresAt}
  const keys = new Map(); // kid -> {value, expiresAt}, at most MAX_KEYS
  // Unknown kids live in their own small cache, so misses can never evict
  // real keys.
  const misses = new Map(); // kid -> expiresAt, at most MAX_MISSES
  const inflight = new Map(); // kid -> Promise
  let lookups = []; // timestamps of lookups that went to eBay

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

  async function requestKey(kid, bearer) {
    try {
      return await fetchImpl(KEY_URL + encodeURIComponent(kid), {
        headers: { authorization: 'Bearer ' + bearer, accept: 'application/json' },
      });
    } catch (e) {
      throw fail('unavailable', 'key request failed');
    }
  }

  function boundedSet(map, max, k, v) {
    if (map.size >= max && !map.has(k)) map.delete(map.keys().next().value);
    map.set(k, v);
  }

  function takeLookup() {
    const t = now();
    lookups = lookups.filter((x) => x > t - 60000);
    if (lookups.length >= maxLookupsPerMinute) return false;
    lookups.push(t);
    return true;
  }

  async function load(kid) {
    let res = await requestKey(kid, await appToken());
    if (res.status === 401 || res.status === 403) {
      // The cached app token was revoked or expired early: drop it, retry once.
      token = null;
      res = await requestKey(kid, await appToken());
    }
    if (res.status === 404) {
      // Remember the miss briefly, so a flood of messages naming a made-up
      // kid cannot turn into a flood of eBay API calls.
      boundedSet(misses, MAX_MISSES, kid, now() + unknownTtlMs);
      throw fail('unknown_key');
    }
    if (!res.ok) throw fail('unavailable', 'key request returned ' + res.status);
    let data;
    try { data = await res.json(); } catch (e) { throw fail('unavailable', 'key response unreadable'); }
    if (!data || typeof data.key !== 'string') throw fail('unavailable', 'key response malformed');
    const value = { key: data.key, algorithm: data.algorithm, digest: data.digest };
    boundedSet(keys, MAX_KEYS, kid, { value, expiresAt: now() + ttlMs });
    return value;
  }

  return function fetchKey(kid) {
    const hit = keys.get(kid);
    if (hit && hit.expiresAt > now()) return Promise.resolve(hit.value);
    const miss = misses.get(kid);
    if (miss && miss > now()) return Promise.reject(fail('unknown_key'));
    // Concurrent requests for the same kid share one fetch.
    if (inflight.has(kid)) return inflight.get(kid);
    if (!takeLookup()) return Promise.reject(fail('unavailable', 'key lookup rate limit'));
    const p = load(kid).finally(() => inflight.delete(kid));
    inflight.set(kid, p);
    return p;
  };
}

module.exports = { createEbayKeyFetcher };

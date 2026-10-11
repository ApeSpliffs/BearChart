/*
 * The generated service worker (sw.js, tools/build_pwa.py), run in Node
 * against an in-memory Cache Storage. It checks what a browser cannot be
 * asked cheaply: what is left in the caches after several deploys.
 *
 *   node --test tools/test_sw.js        (needs sw.js: npm run build:dev)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SW = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
const ORIGIN = 'https://bearchart.test';
const SCOPE = ORIGIN + '/';

class FakeResponse {
  constructor(body, status) { this.body = body; this.status = status || 200; this.ok = this.status < 300; this.type = 'basic'; }
  clone() { return new FakeResponse(this.body, this.status); }
}
class FakeRequest {
  constructor(url, init) {
    this.url = new URL(url, SCOPE).href;
    this.method = (init && init.method) || 'GET';
    this.mode = (init && init.mode) || 'cors';
  }
}
const keyOf = (k) => (typeof k === 'string' ? new URL(k, SCOPE).href : k.url);

/** Cache Storage in memory. opts.quotaFull makes every put throw. */
function makeCaches(state) {
  const all = new Map();
  class FakeCache {
    constructor() { this.m = new Map(); }
    async match(k) { const r = this.m.get(keyOf(k)); return r ? r.clone() : undefined; }
    async put(k, r) {
      if (state.quotaFull) throw new Error('QuotaExceededError');
      this.m.set(keyOf(k), r);
    }
    async keys() { return Array.from(this.m.keys()).map((u) => new FakeRequest(u)); }
    async delete(k) { return this.m.delete(keyOf(k)); }
  }
  return {
    all,
    async keys() { return Array.from(all.keys()); },
    async open(n) { if (!all.has(n)) all.set(n, new FakeCache()); return all.get(n); },
    async delete(n) { return all.delete(n); },
    async match(k) {
      for (const c of all.values()) { const r = await c.match(k); if (r) return r; }
      return undefined;
    }
  };
}

/** One worker version: sw.js with its own shell name and precache list. */
function worker(env, version, precache) {
  const src = SW
    .replace(/const SHELL = '[^']+';/, "const SHELL = 'bearchart-shell-" + version + "';")
    .replace(/const PRECACHE = \[[\s\S]*?\];/, 'const PRECACHE = ' + JSON.stringify(precache) + ';');
  const handlers = {};
  const self = {
    addEventListener: (t, fn) => { handlers[t] = fn; },
    registration: { scope: SCOPE },
    location: { origin: ORIGIN },
    skipWaiting: async () => {},
    clients: { claim: async () => {} }
  };
  vm.runInNewContext(src, {
    self, caches: env.caches, fetch: env.fetch, URL, Request: FakeRequest, Response: {
      error: () => new FakeResponse(null, 0)
    }, setTimeout, clearTimeout, console
  });
  const run = async (type) => {
    let p = null;
    handlers[type]({ waitUntil: (x) => { p = x; } });
    await p;
  };
  return {
    install: () => run('install'),
    activate: () => run('activate'),
    async fetch(url, mode) {
      let p = null;
      const waits = [];
      handlers.fetch({ request: new FakeRequest(url, { mode }), respondWith: (x) => { p = x; },
                       waitUntil: (x) => waits.push(x) });
      const res = await p;
      await Promise.all(waits);
      return res;
    }
  };
}

function makeEnv() {
  const state = { quotaFull: false, fetched: [] };
  const fetch = async (req) => {
    const url = typeof req === 'string' ? new URL(req, SCOPE).href : req.url;
    state.fetched.push(url.replace(SCOPE, ''));
    return new FakeResponse('body of ' + url);
  };
  return { state, caches: makeCaches(state), fetch };
}

const precacheFor = (day) => [
  { url: 'index.html', rev: 'html1' },
  { url: 'item.html', rev: 'html1' },
  { url: 'site-config.js', rev: 'cfg' + day },
  { url: 'app.js', rev: 'app1' },
  { url: 'data/h/index.' + day + '.json', rev: day },
  { url: 'data/h/listings.' + day + '.json', rev: day }
];

async function runtimeUrls(env) {
  const c = env.caches.all.get('bearchart-runtime-v1');
  return c ? (await c.keys()).map((r) => r.url.replace(SCOPE, '')) : [];
}

async function deploy(env, day) {
  const w = worker(env, 'v' + day, precacheFor(day));
  await w.install();
  await w.activate();
  return w;
}

test('after repeated deploys no stale catalogue index survives in any cache', async () => {
  const env = makeEnv();
  let w = await deploy(env, 1);
  for (let day = 2; day <= 4; day++) {
    // The old worker still controls the page: the fresh site-config names the
    // next deploy's index, which the old precache does not hold.
    await w.fetch('site-config.js');
    const res = await w.fetch('data/h/index.' + day + '.json');
    assert.ok(res.ok);
    assert.ok((await runtimeUrls(env)).includes('data/h/index.' + day + '.json'),
      'fetched under the old worker, kept until the next activate');
    w = await deploy(env, day);
    const left = await runtimeUrls(env);
    assert.deepStrictEqual(left.filter((u) => u.startsWith('data/h/')), [], 'day ' + day + ': ' + left);
    assert.ok(!left.includes('site-config.js'), 'a now-precached url is not kept twice');
  }
  // Only the current shell remains, and it holds exactly the current index.
  const shells = (await env.caches.keys()).filter((n) => n.startsWith('bearchart-shell-'));
  assert.deepStrictEqual(shells, ['bearchart-shell-v4']);
  const shell = (await env.caches.all.get('bearchart-shell-v4').keys()).map((r) => r.url);
  assert.ok(shell.some((u) => u.includes('data/h/index.4.json')));
  assert.ok(!shell.some((u) => /data\/h\/index\.[123]\.json/.test(u)));
});

test('a full quota never fails a good network response', async () => {
  const env = makeEnv();
  const w = await deploy(env, 1);
  env.state.quotaFull = true;
  for (const url of ['data/h/index.9.json', 'data/items/some-bear.json', 'site-config.js', 'styles.css']) {
    const res = await w.fetch(url);
    assert.ok(res && res.ok, url + ' still served');
  }
  const nav = await w.fetch('item/some-bear.html', 'navigate');
  assert.ok(nav.ok);
});

test('precached files are served without a refetch, item.html?id= included', async () => {
  const env = makeEnv();
  const w = await deploy(env, 1);
  env.state.fetched.length = 0;
  for (const [url, mode] of [['app.js'], ['index.html', 'navigate'], ['item.html?id=some-bear', 'navigate'],
                             ['', 'navigate']]) {
    const res = await w.fetch(url, mode);
    assert.ok(res.ok, url);
  }
  assert.deepStrictEqual(env.state.fetched, [], 'nothing precached went back to the network');
  assert.deepStrictEqual(await runtimeUrls(env), []);
});

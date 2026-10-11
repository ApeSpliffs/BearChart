#!/usr/bin/env python3
"""
Make BearChart installable, and make it work with no signal.

    python3 tools/build_pwa.py     (npm run pwa)

Writes manifest.webmanifest and sw.js. Icons are generated separately and
rarely change - see npm run icons.

WHY OFFLINE IS THE POINT, NOT A GARNISH
    The job this site exists for happens in a thrift store, holding a bear,
    with one bar of signal: is this worth the four dollars they want for it?
    A price guide that needs a connection is no use at the moment you need it.

    The catalogue index is about 125KB gzipped and the site is static files, so the
    entire thing fits in a cache. Installed, BearChart answers that question
    with the phone in aeroplane mode.

    It is also what any eventual app-store listing would rest on. Apple rejects
    repackaged websites; an offline price guide is a real application.
"""

import hashlib
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# The app shell: everything needed to open any page and price any bear with no
# network at all - including the catalogue index (every item's value summary)
# and today's listings, whose hashed names come from data/manifest.json. The
# generated item pages and item files are NOT in here - they are cached as
# they are visited, and item/_offline.html plus the index cover the rest.
SHELL = [
    "index.html", "item.html", "deals.html", "checklists.html",
    "collection.html", "admin.html", "about.html", "roadmap.html",
    "plans.html", "account.html", "showcase.html", "privacy.html", "terms.html",
    "item/_offline.html",
    "styles.css", "theme.js",
    "config.js", "observability.js", "site-config.js", "sanitize.js", "bc-data.js",
    "engine.js", "icons.js", "auth.js", "entitlements.js",
    "submissions.js", "common.js", "app.js", "item.js", "deals.js", "checklists.js",
    "collection.js", "admin.js", "roadmap.js", "plans.js", "account.js",
    "about.js", "page.js", "showcase.js", "recent_bears.js",
    "manifest.webmanifest",
    "icons/icon-192.png", "icons/icon-512.png",
    "icons/icon-maskable-512.png", "icons/apple-touch-icon.png",
]

# Fetched fresh whenever online: config.js (per-deploy runtime settings) and
# site-config.js (the data manifest that names the current index). A stale
# copy of either would point a page at yesterday's deploy.
NETWORK_FIRST = ["config.js", "site-config.js"]


def data_manifest():
    path = os.path.join(ROOT, "data", "manifest.json")
    if not os.path.exists(path):
        raise SystemExit("data/manifest.json is missing: run `npm run build:assets` first.")
    with open(path) as f:
        return json.load(f)


def source_path(rel):
    """Where a precached file's deployed bytes are. config.js is replaced at
    deploy time (tools/build_site.sh passes the generated copy), so its hash
    must be of that copy, not of the inert committed one."""
    if rel == "config.js" and os.environ.get("BEARCHART_CONFIG_JS"):
        return os.environ["BEARCHART_CONFIG_JS"]
    return os.path.join(ROOT, rel)


def file_rev(rel):
    with open(source_path(rel), "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()[:12]


def data_files(manifest):
    """The hashed data files the shell carries: the index, the listings and the
    plans page's copy (older manifests have no plans file)."""
    return [manifest[k] for k in ("index", "listings", "plans") if manifest.get(k)]


def precache_entries(manifest):
    """[{url, rev}] for every shell file on disk. rev is the file's own hash, so
    a deploy re-downloads exactly the entries whose bytes changed."""
    urls = SHELL + data_files(manifest)
    out = []
    for rel in urls:
        if os.path.isfile(source_path(rel)):
            out.append({"url": rel, "rev": file_rev(rel)})
    return out


def version(entries):
    """The shell cache name: changes exactly when a precached file does.

    Not a timestamp: rebuilding without changing anything would evict every
    visitor's cache for nothing.
    """
    h = hashlib.sha256()
    for e in sorted(entries, key=lambda e: e["url"]):
        h.update((e["url"] + "@" + e["rev"] + "\n").encode())
    return h.hexdigest()[:12]


def write_manifest(data):
    meta = data["meta"]
    manifest = {
        "name": "BearChart — Build-A-Bear Price Guide",
        "short_name": "BearChart",
        "description": meta.get("subtitle") or "Build-A-Bear collector price guide",
        # Relative, so the app works served from a subdirectory as well as a
        # domain root - the same reason internal links are not root-relative.
        "start_url": "./index.html",
        "scope": "./",
        "display": "standalone",
        "orientation": "any",
        "background_color": "#fff6f2",
        "theme_color": "#b3131c",
        "categories": ["shopping", "utilities", "lifestyle"],
        "icons": [
            {"src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png",
             "purpose": "any"},
            {"src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png",
             "purpose": "any"},
            {"src": "icons/icon-maskable-512.png", "sizes": "512x512",
             "type": "image/png", "purpose": "maskable"},
        ],
        "shortcuts": [
            {"name": "My collection", "url": "./collection.html"},
            {"name": "Checklists", "url": "./checklists.html"},
            {"name": "Deals", "url": "./deals.html"},
        ],
    }
    path = os.path.join(ROOT, "manifest.webmanifest")
    with open(path, "w") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")
    return path


SW_TEMPLATE = """/* BearChart service worker - generated by tools/build_pwa.py. Do not edit.
 *
 * Caches:
 *   bearchart-shell-<hash>  the precached app shell (pages, scripts, the
 *                           catalogue index and listings). Each entry is stored
 *                           under url?__rev=<its own hash>, so a new deploy
 *                           copies unchanged entries from the old cache and
 *                           downloads only what changed.
 *   bearchart-items-v1      item files (data/items/*.json) as they are opened.
 *   bearchart-pages-v1      item pages (item/*.html) as they are visited.
 *   bearchart-runtime-v1    anything else fetched after install, under its
 *                           plain URL. A ?__rev= key is only ever written at
 *                           install, from the file this version precaches, so
 *                           a newer deploy's response can never sit under this
 *                           version's key (and a newer site-config.js never
 *                           replaces the one that matches the cached index).
 */
'use strict';

const SHELL = 'bearchart-shell-%(version)s';
const ITEMS = 'bearchart-items-v1';
const PAGES = 'bearchart-pages-v1';
const RUNTIME = 'bearchart-runtime-v1';
const ITEMS_MAX = 400;
const PAGES_MAX = 300;
const RUNTIME_MAX = 200;
const NETWORK_TIMEOUT_MS = 2500;
const PRECACHE = %(precache)s;
const NETWORK_FIRST = %(network_first)s;

const REV = {};
for (const e of PRECACHE) REV[e.url] = e.rev;
const revKey = (url) => url + '?__rev=' + REV[url];

/** A request's path relative to the worker's scope ('' for the root). */
function relPath(url) {
  const scope = new URL(self.registration.scope).pathname;
  const p = url.pathname;
  return p.startsWith(scope) ? p.slice(scope.length) : null;
}

async function fromAnyShell(key) {
  for (const name of await caches.keys()) {
    if (!name.startsWith('bearchart-shell-')) continue;
    const hit = await (await caches.open(name)).match(key, { ignoreVary: true });
    if (hit) return hit;
  }
  return null;
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // One entry at a time, each allowed to fail: a single missing asset must
    // not leave a visitor with no offline support at all.
    await Promise.all(PRECACHE.map(async (e) => {
      const key = revKey(e.url);
      try {
        const old = await fromAnyShell(key);
        if (old) return cache.put(key, old);
        const res = await fetch(new Request(e.url, { cache: 'reload' }));
        if (res && res.ok) await cache.put(key, res);
      } catch (err) { /* stays uncached; fetched when next needed */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      const oldShell = name.startsWith('bearchart-shell-') && name !== SHELL;
      // The previous scheme: one cache named bearchart-<hex>.
      const legacy = /^bearchart-[0-9a-f]{12}$/.test(name);
      if (oldShell || legacy) await caches.delete(name);
    }
    // The runtime cache holds what the previous version fetched after its
    // install: a newer deploy's hashed index and listings (1-2 MB each, a new
    // name every day) and fresh copies of shell files. This version precaches
    // its own, so drop every data/h entry and everything now precached -
    // otherwise each deploy would leave another dead index behind.
    try {
      const runtime = await caches.open(RUNTIME);
      for (const req of await runtime.keys()) {
        const rel = relPath(new URL(req.url));
        if (rel !== null && (rel.startsWith('data/h/') || REV[rel] || REV[rel === '' ? 'index.html' : rel])) {
          await runtime.delete(req);
        }
      }
    } catch (err) { /* a cleanup failure must not block activation */ }
    await self.clients.claim();
  })());
});

async function trim(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

/** Network first with a timeout, the precached copy when it fails or stalls. */
/**
 * Store a copy for later. Never throws: a full quota (or any storage error)
 * must not turn a good network response into a failed request.
 */
async function putIn(cacheName, key, res, max) {
  try {
    const cache = await caches.open(cacheName);
    await cache.put(key, res);
    if (max) await trim(cache, max);
  } catch (err) { /* not cached; the response is still served */ }
}
const putRuntime = (key, res) => putIn(RUNTIME, key, res, RUNTIME_MAX);

/** This version's precached copy first, then a runtime copy. */
async function cached(request, rel) {
  return (REV[rel] && await fromAnyShell(revKey(rel))) ||
         await (await caches.open(RUNTIME)).match(request, { ignoreVary: true });
}

/**
 * Network first with a timeout. Offline (or stalled), this version's
 * precached copy wins over a newer runtime one: for site-config.js that is the
 * copy whose catalogue index is in the same shell cache.
 */
async function networkFirst(request, rel) {
  const fresh = fetch(request).then(async (res) => {
    if (res && res.ok) await putRuntime(request, res.clone());
    return res;
  });
  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS, null));
  try {
    const res = await Promise.race([fresh, timeout]);
    if (res && res.ok) return res;
  } catch (err) { /* offline: fall through to the cache */ }
  const hit = await cached(request, rel);
  return hit || fresh.catch(() => Response.error());
}

/** Content-hashed data: the URL never changes meaning, so the cache is final. */
async function cacheFirst(request, rel) {
  const hit = await cached(request, rel);
  if (hit) return hit;
  const res = await fetch(request);
  // A hashed name is its content, so it may fill this version's slot.
  if (res && res.ok) {
    if (REV[rel]) await putIn(SHELL, revKey(rel), res.clone());
    else await putRuntime(request, res.clone());
  }
  return res;
}

/** Serve from cache, refresh it in the background for next time. */
async function staleWhileRevalidate(event, lookup, store) {
  // ignoreVary (in lookups): responses are stored compressed and carry
  // "Vary: accept-encoding"; without it a cached entry can fail to match.
  const hit = await lookup();
  const fetching = fetch(event.request).then(async (res) => {
    if (res && res.ok && res.type === 'basic') await store(res.clone());
    return res;
  }).catch(() => null);
  if (hit) {
    event.waitUntil(fetching);
    return hit;
  }
  return (await fetching) || Response.error();
}

/**
 * This version's precached copy (item.html?id=... included). A file the
 * install missed (it was offline, or the fetch failed) is fetched once and
 * kept in the runtime cache under its plain path, so it is there next time.
 */
async function precached(request, rel) {
  const hit = (await fromAnyShell(revKey(rel))) ||
              (await (await caches.open(RUNTIME)).match(rel, { ignoreVary: true }));
  if (hit) return hit;
  const res = await fetch(request);
  if (res && res.ok) await putRuntime(rel, res.clone());
  return res;
}

async function navigate(event, rel) {
  const isItem = /^item\\/[^/]+\\.html$/.test(rel);
  const target = rel === '' ? 'index.html' : rel;
  if (REV[target]) return precached(event.request, target);
  const cacheName = isItem ? PAGES : RUNTIME;
  const cache = await caches.open(cacheName);
  const hit = await cache.match(event.request, { ignoreVary: true });
  const fetching = fetch(event.request).then(async (res) => {
    if (res && res.ok) await putIn(cacheName, event.request, res.clone(), isItem ? PAGES_MAX : RUNTIME_MAX);
    return res;
  });
  if (hit) {
    event.waitUntil(fetching.catch(() => null));
    return hit;
  }
  try {
    return await fetching;
  } catch (err) {
    // Offline, and this page was never visited. For an item page that is the
    // common case - nobody has opened the bear they are holding in a shop. The
    // stand-in shell renders it from the cached index; the address bar still
    // says which bear it is.
    if (isItem) {
      const shell = await fromAnyShell(revKey('item/_offline.html'));
      if (shell) return shell;
    }
    const home = await fromAnyShell(revKey('index.html'));
    if (home) return home;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;   // webfonts etc: leave alone
  const rel = relPath(url);
  if (rel === null) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigate(event, rel));
  } else if (NETWORK_FIRST.includes(rel)) {
    event.respondWith(networkFirst(request, rel));
  } else if (rel.startsWith('data/h/')) {
    event.respondWith(cacheFirst(request, rel));
  } else if (rel.startsWith('data/items/')) {
    event.respondWith(staleWhileRevalidate(event,
      async () => (await caches.open(ITEMS)).match(request, { ignoreVary: true }),
      (res) => putIn(ITEMS, request, res, ITEMS_MAX)));
  } else if (REV[rel]) {
    // Precached by this version: serve it; the next deploy's worker brings
    // the next copy. No runtime refetch or second stored copy.
    event.respondWith(precached(request, rel));
  } else {
    event.respondWith(staleWhileRevalidate(event, () => cached(request, rel),
      (res) => putRuntime(request, res)));
  }
});
"""


def write_sw(entries):
    path = os.path.join(ROOT, "sw.js")
    with open(path, "w") as f:
        f.write(SW_TEMPLATE % {
            "version": version(entries),
            "precache": json.dumps(entries, indent=1),
            "network_first": json.dumps(NETWORK_FIRST),
        })
    return path


def main():
    with open(os.path.join(ROOT, "data.json")) as f:
        data = json.load(f)

    # The manifest is itself precached, so it has to exist before the shell is
    # hashed or every build would report it missing.
    print("wrote %s" % os.path.relpath(write_manifest(data), ROOT))

    manifest = data_manifest()
    entries = precache_entries(manifest)
    wanted = SHELL + data_files(manifest)
    missing = [p for p in wanted if p not in {e["url"] for e in entries}]
    print("wrote %s  (cache bearchart-shell-%s, %d files precached)"
          % (os.path.relpath(write_sw(entries), ROOT), version(entries), len(entries)))
    if missing:
        print("\n  NOT on disk yet, so not precached:")
        for m in missing:
            print("    %s" % m)
        print("  run: npm run build:dev && npm run icons")


if __name__ == "__main__":
    main()

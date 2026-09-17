/* Does BearChart actually work with the network off?
 *
 * The offline promise is the whole argument for installing this thing, and it
 * is not something jsdom can answer - service workers, caches and a real
 * network stack only exist in a browser. So this drives Chrome over the
 * DevTools Protocol: load the site, let the worker install, cut the network
 * with Network.emulateNetworkConditions, and then try to price a bear nobody
 * has looked at before.
 *
 *   node tools/test_offline.js [baseUrl]
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const BASE = process.argv[2] || 'http://localhost:5188';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const base = path.join(os.homedir(), '.cache', 'puppeteer', 'chrome');
  for (const dir of fs.readdirSync(base).sort().reverse()) {
    const bin = path.join(base, dir, 'chrome-linux64', 'chrome');
    if (fs.existsSync(bin)) return bin;
  }
  throw new Error('no Chrome; npx puppeteer browsers install chrome');
}

const port = 9000 + Math.floor(Math.random() * 900);
const chrome = spawn(findChrome(), [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  '--remote-debugging-port=' + port,
  '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'offline-')),
  'about:blank'
], { stdio: 'ignore' });

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '  [' + detail + ']' : ''));
  if (!ok) failures++;
}

(async () => {
  let ws;
  for (let i = 0; i < 60 && !ws; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
    } catch (e) { await wait(250); }
  }
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));

  let id = 0; const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id); pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    }
  });
  const send = (method, params) => new Promise((resolve, reject) => {
    const n = ++id; pending.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params: params || {} }));
  });
  const evaluate = async (expr) => (await send('Runtime.evaluate', {
    expression: expr, awaitPromise: true, returnByValue: true
  })).result.value;

  await send('Page.enable');
  await send('Network.enable');
  await send('Runtime.enable');
  await send('Log.enable').catch(() => null);

  // Anything the page complains about, so an offline failure explains itself
  // instead of just showing up as an empty grid.
  const problems = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') {
      problems.push('exception: ' +
        (m.params.exceptionDetails.exception || {}).description ||
        m.params.exceptionDetails.text);
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      problems.push('console.error: ' +
        m.params.args.map((a) => a.value || a.description || '').join(' '));
    } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      problems.push('log: ' + m.params.entry.text + ' ' + (m.params.entry.url || ''));
    }
  });

  const go = async (url) => {
    problems.length = 0;
    await send('Page.navigate', { url });
    await wait(4000);
  };

  console.log('BearChart offline test');
  await go(BASE + '/index.html');

  const ready = await evaluate(
    "navigator.serviceWorker.ready.then(r => !!r.active).catch(() => false)");
  check('service worker installs and activates', ready === true);

  // Give the precache time to finish before pulling the plug.
  await wait(3500);
  const cached = await evaluate(
    "caches.keys().then(k => k.filter(n => n.startsWith('bearchart-')))" +
    ".then(k => k.length ? caches.open(k[0]).then(c => c.keys()).then(r => r.length) : 0)");
  check('the app shell is precached', cached >= 25, cached + ' entries');

  // --- the actual claim ----------------------------------------------------
  await send('Network.emulateNetworkConditions', {
    offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0
  });

  await go(BASE + '/index.html');
  const home = await evaluate(
    "({cards: document.querySelectorAll('#results .card').length," +
    " items: (window.BEARCHART_DATA||{items:[]}).items.length})");
  check('the price guide opens offline', home.cards > 0,
        home.cards + ' cards' + (problems.length ? ' | ' + problems.slice(0, 3).join(' ; ') : ''));
  check('the whole catalogue is available offline', home.items > 2000,
        home.items + ' items');

  // A bear nobody has opened before - the thrift-shop case.
  await go(BASE + '/item/vanilla-fudge-bunny.html');
  const item = (await evaluate(`(() => {
    const r = document.getElementById('item-root');
    const h = r && r.querySelector('h1');
    return {
      name: h ? h.textContent.trim() : null,
      priced: !!r && r.textContent.indexOf('$') !== -1,
      text: r ? r.textContent.replace(/\\s+/g, ' ').slice(0, 90) : '(no #item-root)'
    };
  })()`)) || {};
  check('an unvisited item page works offline', !!item.name,
        item.name || item.text || 'blank');
  check('and it still prices the bear', item.priced === true);

  const search = await evaluate(`(() => {
    const q = document.querySelector('#q'); return !!q;
  })()`);

  await go(BASE + '/checklists.html');
  const lists = await evaluate("document.querySelectorAll('a,li').length > 10");
  check('checklists work offline', lists === true);

  ws.close(); chrome.kill();
  console.log(failures ? `\n${failures} failure(s)` : '\nall offline checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); chrome.kill(); process.exit(1); });

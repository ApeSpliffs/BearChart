/* Screenshot a page at a real device size.
 *
 *   node tools/shot.js http://localhost:5173/index.html out.png
 *   node tools/shot.js http://localhost:5173/index.html phone.png --phone
 *   node tools/shot.js <url> <out.png> --width=768 --height=1024 --full
 *
 * Why this exists: jsdom, which the test suite runs on, has no layout engine.
 * It will tell you the markup is correct while the hero overlaps the search
 * box and the cards are clipped - all three of which actually happened. And
 * `chrome --screenshot --window-size=390,844` does NOT give a 390px layout
 * viewport; it renders the page at whatever width the platform gives the
 * window and crops the image, which looks exactly like an overflow bug that
 * is not there. The only honest way to see a phone is to set device metrics
 * over the DevTools Protocol, which is what this does.
 *
 * No dependencies: Chrome comes from the puppeteer cache, and node has had a
 * global WebSocket since v22.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

/** Every place a usable Chrome might be, most specific first. */
function chromeCandidates() {
  const list = [];
  if (process.env.CHROME_PATH) list.push(process.env.CHROME_PATH);

  // Chrome for Testing installed by `npx puppeteer browsers install chrome`,
  // newest version first, on Linux and on both Mac architectures.
  const cft = 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
  const base = path.join(os.homedir(), '.cache', 'puppeteer', 'chrome');
  if (fs.existsSync(base)) {
    for (const dir of fs.readdirSync(base).sort().reverse()) {
      list.push(path.join(base, dir, 'chrome-linux64', 'chrome'),
                path.join(base, dir, 'chrome-mac-arm64', cft),
                path.join(base, dir, 'chrome-mac-x64', cft));
    }
  }

  list.push(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable');
  return list;
}

function findChrome() {
  const tried = chromeCandidates();
  const hit = tried.find((bin) => fs.existsSync(bin));
  if (hit) return hit;
  throw new Error('No Chrome found. Tried:\n  ' + tried.join('\n  ') +
                  '\nSet CHROME_PATH, or install one with:\n' +
                  '  npx puppeteer browsers install chrome');
}

const args = process.argv.slice(2);
const url = args[0];
const out = args[1];
if (!url || !out) {
  console.error('usage: node tools/shot.js <url> <out.png> [--phone] ' +
                '[--width=N] [--height=N] [--dpr=N] [--full]');
  process.exit(2);
}
const flag = (name, dflt) => {
  const hit = args.find((a) => a.startsWith('--' + name + '='));
  return hit ? Number(hit.split('=')[1]) : dflt;
};
const phone = args.includes('--phone');
const width = flag('width', phone ? 390 : 1280);
const height = flag('height', phone ? 844 : 900);
const full = args.includes('--full');
// Screenshots want retina; generated assets want exact pixels.
const dpr = flag('dpr', 2);
const port = 9000 + Math.floor(Math.random() * 900);

const chrome = spawn(findChrome(), [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--remote-debugging-port=' + port, '--user-data-dir=' +
    fs.mkdtempSync(path.join(os.tmpdir(), 'shot-')),
  'about:blank'
], { stdio: 'ignore' });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function endpoint() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch('http://127.0.0.1:' + port + '/json/list');
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch (e) { /* not up yet */ }
    await wait(250);
  }
  throw new Error('Chrome never opened a debugging port');
}

(async () => {
  const ws = new WebSocket(await endpoint());
  let id = 0;
  const pending = new Map();
  const events = new Map();

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method && events.has(msg.method)) {
      events.get(msg.method)();
      events.delete(msg.method);
    }
  });
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));

  const send = (method, params) => new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params: params || {} }));
  });
  const once = (method) => new Promise((r) => events.set(method, r));

  await send('Page.enable');
  // The part --window-size cannot do: a genuine mobile layout viewport.
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: dpr, mobile: phone
  });

  const loaded = once('Page.loadEventFired');
  await send('Page.navigate', { url });
  await Promise.race([loaded, wait(15000)]);
  await wait(1200); // webfonts, and the render pass after them

  const probe = await send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      const vw = document.documentElement.clientWidth;
      const over = [];
      for (const el of document.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (r.width > vw + 1 || r.right > vw + 1) {
          over.push((el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
            (typeof el.className === 'string' && el.className
              ? '.' + el.className.trim().split(/\\s+/).join('.') : ''))
            .slice(0, 44) + ' w=' + Math.round(r.width));
        }
      }
      return { vw, scrollW: document.documentElement.scrollWidth, over: over.slice(0, 10) };
    })()`
  });
  const info = probe.result.value;

  const shot = await send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: full
  });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));

  console.log('%s  viewport %dx%d%s', out, info.vw, height, phone ? ' (mobile)' : '');
  if (info.scrollW > info.vw + 1) {
    console.log('  HORIZONTAL OVERFLOW: page is %dpx wide in a %dpx viewport',
                info.scrollW, info.vw);
    info.over.forEach((o) => console.log('    ' + o));
  } else {
    console.log('  no horizontal overflow');
  }

  ws.close();
  chrome.kill();
  process.exit(0);
})().catch((err) => {
  console.error(err.message);
  chrome.kill();
  process.exit(1);
});

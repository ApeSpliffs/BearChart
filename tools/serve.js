/* Dependency-free static server for local development.
   Usage: npm start   (then open http://localhost:5173) */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 5173;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.sql': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '');

  // Keep requests inside the project directory.
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found: ' + rel);
      return;
    }
    const headers = {
      'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store'
    };

    // The catalogue is 2,048 items, so data.js is a couple of megabytes of
    // mostly-repeated JSON - and about 80KB once gzipped. Real hosts compress
    // by default; without this the dev server is the only place the site feels
    // slow, which is a misleading thing for it to be.
    const compressible = /^(text\/|application\/(json|javascript))/.test(headers['content-type']);
    if (compressible && /\bgzip\b/.test(req.headers['accept-encoding'] || '') && buf.length > 1024) {
      zlib.gzip(buf, (gzErr, gz) => {
        if (gzErr) { res.writeHead(200, headers).end(buf); return; }
        headers['content-encoding'] = 'gzip';
        headers.vary = 'accept-encoding';
        res.writeHead(200, headers).end(gz);
      });
      return;
    }
    res.writeHead(200, headers).end(buf);
  });
}).listen(PORT, () => {
  console.log('BearChart running at http://localhost:' + PORT);
});

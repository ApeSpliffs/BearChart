/**
 * Netlify entry point for eBay's Marketplace Account Deletion endpoint.
 *
 * The protocol - the challenge hash, signature checks, what is logged - lives
 * in api/ebay-deletion.js, which tools/test_ebay_deletion.js covers. This file
 * only translates Netlify's Request/Response into the (req, res) shape that
 * handler was written against, and serves it at the URL registered with eBay.
 */
import deletion from '../../api/ebay-deletion.js';

const MAX_BODY = 64 * 1024;
const handle = deletion.createHandler({ env: process.env, keyFetcher: null, log: console });

export function toNodeShape(request, rawBody) {
  const url = new URL(request.url);
  const headers = {};
  request.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  return {
    method: request.method,
    query: Object.fromEntries(url.searchParams),
    headers,
    rawBody,
  };
}

export function responder() {
  let status = 200;
  let body = null;
  const headers = new Headers();
  const res = {
    status(code) { status = code; return res; },
    setHeader(k, v) { headers.set(k, v); return res; },
    json(obj) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(obj);
      return res;
    },
    end(b) { if (b !== undefined) body = b; return res; },
  };
  return { res, toResponse: () => new Response(status === 204 ? null : body, { status, headers }) };
}

export async function handleRequest(request, handler = handle) {
  let rawBody;
  if (request.method === 'POST') {
    const buf = Buffer.from(await request.arrayBuffer());
    if (buf.length > MAX_BODY) {
      return new Response(JSON.stringify({ error: 'body too large' }),
        { status: 413, headers: { 'Content-Type': 'application/json' } });
    }
    rawBody = buf.toString('utf8');
  }
  const { res, toResponse } = responder();
  await handler(toNodeShape(request, rawBody), res);
  return toResponse();
}

export default (request) => handleRequest(request);

export const config = { path: '/api/ebay-deletion' };

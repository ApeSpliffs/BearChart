// Comps export behaviour: the pure module behind supabase/functions/export-comps,
// imported through Node's type stripping. Fakes stand in for Supabase.
//
//   node --test tools/test_comps_export.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const S = require('../sanitize.js');
const svc = await import('../supabase/functions/_shared/comps_export/service.ts');

function ports(o) {
  const calls = [];
  const p = Object.assign({
    entitled: true, admin: false, quota: true,
    rows: [
      { id: 's2', item_slug: 'b-bear', canonical_name: 'B', sale_date: '2026-01-01', sold_price: 10,
        price_high: null, currency: 'USD', condition: 'Good', completeness: 'bare', marketplace: 'eBay',
        listing_id: '1', evidence_type: 'completed_sale', source_url: 'https://www.ebay.com/itm/1', notes: '=HYPERLINK("x")' },
      { id: 's1', item_slug: 'a-bear', canonical_name: 'A, the bear', sale_date: null, sold_price: '12.50',
        price_high: '15.00', currency: 'USD', condition: 'NWT', completeness: 'complete', marketplace: null,
        listing_id: null, evidence_type: 'collector_report', source_url: null, notes: null },
      { id: 's3', item_slug: 'a-bear', canonical_name: 'A, the bear', sale_date: '2026-05-01', sold_price: 9,
        price_high: null, currency: 'USD', condition: 'Fair', completeness: 'bare', marketplace: 'eBay',
        listing_id: '3', evidence_type: 'completed_sale', source_url: null, notes: null },
    ],
  }, o || {});
  return {
    calls,
    async hasEntitlement(f) { calls.push(['hasEntitlement', f]); return p.entitled; },
    async isAdmin() { calls.push(['isAdmin']); return p.admin; },
    async countSales(ids) { calls.push(['countSales', ids.length]); return p.rows.length; },
    async claimQuota(n) { calls.push(['claimQuota', n]); return p.quota; },
    async fetchSales(ids) { calls.push(['fetchSales', ids.length]); return p.rows; },
  };
}

test('the body must be 1-500 catalogue slugs', () => {
  assert.match(svc.parseRequest(null).error, /1-500/);
  assert.match(svc.parseRequest({}).error, /1-500/);
  assert.match(svc.parseRequest({ item_ids: [] }).error, /1-500/);
  assert.match(svc.parseRequest({ item_ids: Array(501).fill('a') }).error, /1-500/);
  assert.match(svc.parseRequest({ item_ids: ['Bad Id'] }).error, /not an item id/);
  assert.match(svc.parseRequest({ item_ids: ['a', 7] }).error, /not an item id/);
  assert.match(svc.parseRequest({ item_ids: ["x'; drop table sales"] }).error, /not an item id/);
  assert.deepEqual(svc.parseRequest({ item_ids: ['a-bear', 'a-bear', 'b'] }), { itemIds: ['a-bear', 'b'] });
  assert.equal(svc.parseRequest({ item_ids: Array(500).fill('a') }).itemIds.length, 1);
});

test('no comps_export entitlement: 403, and no quota is spent', async () => {
  const p = ports({ entitled: false });
  const r = await svc.exportComps(['a-bear'], p);
  assert.equal(r.status, 403);
  assert.ok(!p.calls.some((c) => c[0] === 'claimQuota' || c[0] === 'fetchSales'));
});

test('an admin may export without the entitlement', async () => {
  const r = await svc.exportComps(['a-bear'], ports({ entitled: false, admin: true }));
  assert.equal(r.status, 200);
});

test('over the daily quota: 429, and nothing is read', async () => {
  const p = ports({ quota: false });
  const r = await svc.exportComps(['a-bear'], p);
  assert.equal(r.status, 429);
  assert.ok(!p.calls.some((c) => c[0] === 'fetchSales'));
  assert.deepEqual(p.calls.find((c) => c[0] === 'claimQuota'), ['claimQuota', 3], 'the estimate is claimed');
});

test('the CSV has the browser export columns, newest sale first per item, formula-safe', async () => {
  const r = await svc.exportComps(['a-bear', 'b-bear'], ports());
  assert.equal(r.status, 200);
  assert.equal(r.rows, 3);
  const lines = r.csv.trim().split('\r\n');
  assert.equal(lines[0], 'sale_id,item_id,canonical_name,sale_date,sold_price,price_high,ranged,currency,' +
    'condition,completeness,marketplace,listing_id,evidence_type,source_url,notes');
  assert.deepEqual(lines.slice(1).map((l) => l.split(',')[0]), ['s3', 's1', 's2']);
  assert.match(lines[2], /"A, the bear"/);
  assert.match(lines[2], /,true,/, 'a ranged row says so');
  assert.match(lines[3], /"'=HYPERLINK\(""x""\)"/, 'a formula is neutralised');
});

test('csvCell and toCsv match sanitize.js exactly', () => {
  const cases = ['=1+1', '+1', '-1', '-1.5', '@x', '\tx', '\rx', 'a,b', 'say "hi"', 'line\nbreak',
    '', 'plain', 12.5, -3, 0, true, false, null, undefined, '12', '+12.0'];
  for (const c of cases) assert.equal(svc.csvCell(c), S.csvCell(c), JSON.stringify(c));
  const rows = [['a', 1, null], ['=x', 'y,z', false]];
  assert.equal(svc.toCsv(rows), S.toCsv(rows));
});

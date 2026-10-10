/**
 * Sold-comps CSV export: the domain, pure (no Deno, no Supabase).
 *
 * What this protects is the convenience of one bulk download, rate limited per
 * member - not access to the records. Every comp is published on its bear's
 * page and readable through sales_public_read, so the plans copy says "the
 * records stay free on every bear's page; this is a convenience download".
 *
 * Ports are implemented by supabase_adapter.ts under the caller's own JWT, so
 * has_entitlement() and claim_export_quota() see the real caller.
 */

export const MAX_ITEMS = 500;
export const ITEM_ID = /^[a-z0-9-]+$/;

/** One sale row as the export reads it (items joined for the slug and name). */
export interface CompRow {
  id: string;
  item_slug: string;
  canonical_name: string;
  sale_date: string | null;
  sold_price: number | string;
  price_high: number | string | null;
  currency: string | null;
  condition: string | null;
  completeness: string | null;
  marketplace: string | null;
  listing_id: string | null;
  evidence_type: string;
  source_url: string | null;
  notes: string | null;
}

export interface CompsExportPorts {
  hasEntitlement(feature: string): Promise<boolean>;
  isAdmin(): Promise<boolean>;
  /** How many rows an export of these items would hold. */
  countSales(itemIds: string[]): Promise<number>;
  /** True records the export; false = no entitlement or over the daily quota. */
  claimQuota(rows: number): Promise<boolean>;
  fetchSales(itemIds: string[]): Promise<CompRow[]>;
}

export type ExportResult =
  | { status: 200; csv: string; rows: number }
  | { status: 400 | 403 | 429; error: string };

/** The body is {item_ids: string[]} of 1-500 catalogue slugs. */
export function parseRequest(body: unknown): { itemIds: string[] } | { error: string } {
  const ids = (body && typeof body === "object")
    ? (body as { item_ids?: unknown }).item_ids
    : undefined;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_ITEMS) {
    return { error: `item_ids must be a list of 1-${MAX_ITEMS} item ids` };
  }
  for (const id of ids) {
    if (typeof id !== "string" || id.length > 120 || !ITEM_ID.test(id)) {
      return { error: "item_ids holds something that is not an item id" };
    }
  }
  return { itemIds: Array.from(new Set(ids as string[])) };
}

export async function exportComps(
  itemIds: string[],
  ports: CompsExportPorts,
): Promise<ExportResult> {
  // Entitlement first and separately, so "not Power" and "over quota" get
  // different answers (claim_export_quota returns false for both).
  const allowed = (await ports.hasEntitlement("comps_export")) || (await ports.isAdmin());
  if (!allowed) return { status: 403, error: "the sold comps download is part of Power" };
  const estimate = await ports.countSales(itemIds);
  if (!(await ports.claimQuota(estimate))) {
    return { status: 429, error: "daily export limit reached" };
  }
  const rows = (await ports.fetchSales(itemIds)).slice().sort((a, b) =>
    a.item_slug.localeCompare(b.item_slug) ||
    String(b.sale_date ?? "").localeCompare(String(a.sale_date ?? ""))
  );
  return { status: 200, csv: compsCsv(rows), rows: rows.length };
}

/** The same columns the browser's BC.salesCsv writes. */
export const CSV_HEAD = [
  "sale_id", "item_id", "canonical_name", "sale_date", "sold_price", "price_high",
  "ranged", "currency", "condition", "completeness", "marketplace", "listing_id",
  "evidence_type", "source_url", "notes",
];

export function compsCsv(rows: CompRow[]): string {
  const out: unknown[][] = [CSV_HEAD];
  for (const s of rows) {
    out.push([
      s.id, s.item_slug, s.canonical_name, s.sale_date, s.sold_price, s.price_high,
      s.price_high != null, s.currency, s.condition, s.completeness, s.marketplace,
      s.listing_id, s.evidence_type, s.source_url, s.notes,
    ]);
  }
  return toCsv(out);
}

/**
 * One CSV cell, formula-injection safe: the same rule as sanitize.js csvCell
 * (tools/test_comps_export.mjs pins the two equal). A text cell opening with
 * = + - @ tab or CR is prefixed with ' so a spreadsheet shows it as text.
 */
const NUMERIC = /^[+-]?\d+(\.\d+)?$/;

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s) && !NUMERIC.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCsv(rows: unknown[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

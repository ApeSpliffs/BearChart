/**
 * Supabase adapter for the comps export (Deno only).
 *
 * Every call runs under the CALLER's JWT (the user client from resolveCaller),
 * so has_entitlement() and claim_export_quota() answer for that member and the
 * sales read is the same public read any visitor has.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import type { CompRow, CompsExportPorts } from "./service.ts";

/** PostgREST returns at most 1000 rows a request (supabase/config.toml max_rows). */
const PAGE = 1000;
/** The quota's daily row cap; an export never reads past it. */
const MAX_ROWS = 20000;

const COLUMNS = "id,sale_date,sold_price,price_high,currency,condition,completeness," +
  "marketplace,listing_id,evidence_type,source_url,notes,items!inner(slug,canonical_name)";

interface SaleWithItem extends Omit<CompRow, "item_slug" | "canonical_name"> {
  items: { slug: string; canonical_name: string };
}

export function createCompsExportPorts(client: SupabaseClient): CompsExportPorts {
  async function rpcBool(fn: string, args?: Record<string, unknown>): Promise<boolean> {
    const { data, error } = await client.rpc(fn, args);
    if (error) throw new Error(`${fn} failed: ${error.message}`);
    return data === true;
  }

  // Sold evidence only, quarantined rows left out: the rows a valuation uses.
  const salesFor = (ids: string[], select: string, opts?: { count: "exact"; head: true }) =>
    client.from("sales").select(select, opts)
      .in("items.slug", ids)
      .is("excluded", null)
      .neq("evidence_type", "active_listing");

  return {
    hasEntitlement: (feature) => rpcBool("has_entitlement", { feature }),
    isAdmin: () => rpcBool("is_admin"),

    async countSales(itemIds) {
      const { count, error } = await salesFor(itemIds, "id,items!inner(slug)",
        { count: "exact", head: true });
      if (error) throw new Error(`count failed: ${error.message}`);
      return count ?? 0;
    },

    claimQuota: (rows) => rpcBool("claim_export_quota", { p_rows: rows }),

    async fetchSales(itemIds) {
      const out: CompRow[] = [];
      for (let from = 0; from < MAX_ROWS; from += PAGE) {
        const { data, error } = await salesFor(itemIds, COLUMNS)
          .order("id")
          .range(from, from + PAGE - 1);
        if (error) throw new Error(`sales read failed: ${error.message}`);
        const rows = (data ?? []) as unknown as SaleWithItem[];
        for (const r of rows) {
          const { items, ...sale } = r;
          out.push({ ...sale, item_slug: items.slug, canonical_name: items.canonical_name });
        }
        if (rows.length < PAGE) break;
      }
      return out;
    },
  };
}

/*
 * The sold-comps CSV, for Power members (and admins).
 *
 * Switched off twice over until the owner's legal review is done: the site
 * shows no button while config.features.comps_export is false, and this
 * function answers 404 unless COMPS_EXPORT_ENABLED=true.
 *
 *   POST {item_ids: string[]}   1-500 catalogue slugs
 *   200 text/csv | 400 bad body | 401 signed out | 403 not Power | 429 over quota
 *
 * What this enforces is one convenient bulk download, rate limited - not
 * access: every comp stays listed, free, on its bear's page.
 *
 * Deploy: supabase functions deploy export-comps
 */

import { resolveCaller } from "../_shared/auth.ts";
import { requireEnv } from "../_shared/env.ts";
import { corsHeaders, json, preflight } from "../_shared/http.ts";
import { withObservability } from "../_shared/observability.ts";
import { exportComps, parseRequest } from "../_shared/comps_export/service.ts";
import { createCompsExportPorts } from "../_shared/comps_export/supabase_adapter.ts";

Deno.serve(withObservability("export-comps", async (req) => {
  const get = (k: string) => Deno.env.get(k);
  const siteUrl = get("SITE_URL") ?? "http://localhost:5173";
  const cors = corsHeaders(siteUrl);
  if (get("COMPS_EXPORT_ENABLED") !== "true") return json({ error: "not found" }, 404, cors);
  const pre = preflight(req, cors);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405, cors);

  const caller = await resolveCaller(
    req,
    requireEnv(get, "SUPABASE_URL"),
    requireEnv(get, "SUPABASE_ANON_KEY"),
  );
  if (!caller) return json({ error: "sign in first" }, 401, cors);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "expected a JSON body" }, 400, cors);
  }
  const parsed = parseRequest(body);
  if ("error" in parsed) return json({ error: parsed.error }, 400, cors);

  try {
    const res = await exportComps(parsed.itemIds, createCompsExportPorts(caller.client));
    if (res.status !== 200) return json({ error: res.error }, res.status, cors);
    const day = new Date().toISOString().slice(0, 10);
    return new Response(res.csv, {
      status: 200,
      headers: {
        ...cors,
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="bearchart-sales-${day}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    console.error("comps export failed:", (err as Error).message);
    return json({ error: "could not build the export" }, 502, cors);
  }
}));

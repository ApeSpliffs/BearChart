/** Small HTTP helpers shared by the browser-facing functions. Pure. */

export type Headers = Record<string, string>;

/** CORS for the site only. Never "*": these endpoints act on a signed-in user. */
export function corsHeaders(siteUrl: string): Headers {
  return {
    "access-control-allow-origin": siteUrl,
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    "vary": "origin",
  };
}

export function json(body: unknown, status = 200, headers: Headers = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** The OPTIONS answer, or null when this is not a preflight. */
export function preflight(req: Request, cors: Headers): Response | null {
  return req.method === "OPTIONS"
    ? new Response("ok", { headers: cors })
    : null;
}

/**
 * Resolve the signed-in caller from the request's Supabase JWT (Deno only).
 * The identity always comes from the token, never from the body: a caller who
 * could name the user could have somebody else's payment attach to them.
 */

import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.45.0";

export interface ResolvedCaller {
  user: { id: string; email: string | null };
  /** A client acting as the caller, under their RLS. */
  client: SupabaseClient;
}

export async function resolveCaller(
  req: Request,
  url: string,
  anonKey: string,
): Promise<ResolvedCaller | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const client = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data, error } = await client.auth.getUser();
  const user = data?.user;
  if (error || !user) return null;
  return { user: { id: user.id, email: user.email ?? null }, client };
}

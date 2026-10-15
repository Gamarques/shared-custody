import type { SupabaseClient } from "@supabase/supabase-js";

export type SessionUser = { id: string; email: string | null };

type ClaimsClient = { auth: Pick<SupabaseClient["auth"], "getClaims"> };

/**
 * The signed-in user from the session's access token, for the hot path (proxy, layout, home;
 * RNF-07). `getClaims()` verifies the token's signature locally against the project's cached
 * public keys (asymmetric JWT signing keys), so it costs no request to Supabase Auth; with a
 * legacy symmetric secret it falls back to `getUser()`, one request, as before. It refreshes an
 * expired session like `getUser()` does. It does not see a sign-out made on another device until
 * the token expires (1 h by default); RLS checks the same token, so data access is unchanged.
 */
export async function getSessionUser(supabase: ClaimsClient): Promise<SessionUser | null> {
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;
  return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : null };
}

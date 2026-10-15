import { createBrowserClient } from "@supabase/ssr";
import { createDemoBrowserClient } from "@/lib/demo/browser";
import { isDemoMode } from "@/lib/demo/mode";
import { getPublicEnv } from "@/lib/env";

/** Supabase client for Client Components. Session lives in cookies. */
export function createClient(): ReturnType<typeof createBrowserClient> {
  // Demo mode: fake client on the server's in-memory data (src/lib/demo).
  if (isDemoMode()) return createDemoBrowserClient() as unknown as ReturnType<typeof createBrowserClient>;
  const { supabaseUrl, supabaseAnonKey } = getPublicEnv();
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}

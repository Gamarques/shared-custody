import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { isDemoMode } from "@/lib/demo/mode";
import { createDemoServerClient } from "@/lib/demo/server";
import { getPublicEnv } from "@/lib/env";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 * Create one per request; never share it across requests.
 */
export async function createClient(): Promise<ReturnType<typeof createServerClient>> {
  // Demo mode: fake client on in-memory data, signed in as Ana (src/lib/demo).
  if (isDemoMode()) return createDemoServerClient() as unknown as ReturnType<typeof createServerClient>;
  const { supabaseUrl, supabaseAnonKey } = getPublicEnv();
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // Session refresh is handled by src/proxy.ts.
        }
      },
    },
  });
}

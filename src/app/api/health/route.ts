import { isSupabaseConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Liveness check for the deploy; reports whether Supabase env vars are set. */
export function GET() {
  return Response.json({ ok: true, supabaseConfigured: isSupabaseConfigured() });
}

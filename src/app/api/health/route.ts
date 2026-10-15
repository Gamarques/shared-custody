import { isDemoMode } from "@/lib/demo/mode";
import { isSupabaseConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Liveness check for the deploy; reports whether Supabase env vars are set (or demo mode is on). */
export function GET() {
  if (isDemoMode()) return Response.json({ ok: true, supabaseConfigured: false, demo: true });
  return Response.json({ ok: true, supabaseConfigured: isSupabaseConfigured() });
}

import { isDemoMode } from "@/lib/demo/mode";
import { getPublicEnv, isSupabaseConfigured } from "@/lib/env";
import { isAuthorizedCron, pingSupabase } from "@/lib/keepalive/keepalive";

export const dynamic = "force-dynamic";

/**
 * Called by Vercel Cron (vercel.json) twice a week so the free Supabase project never reaches
 * 7 days without activity (RNF-06). Each run writes one `supabase_keepalive` JSON line to the
 * function logs, which is how a run is confirmed.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (isDemoMode()) {
    // No Supabase project to keep awake: the demo runs on in-memory data.
    return Response.json({ ok: true, demo: true });
  }
  if (!isSupabaseConfigured()) {
    console.error(JSON.stringify({ event: "supabase_keepalive", ok: false, error: "supabase env not configured" }));
    return Response.json({ ok: false, error: "supabase not configured" }, { status: 500 });
  }

  const result = await pingSupabase(getPublicEnv());
  const line = JSON.stringify({ event: "supabase_keepalive", at: new Date().toISOString(), ...result });
  if (!result.ok) {
    console.error(line);
    return Response.json(result, { status: 502 });
  }
  console.log(line);
  return Response.json(result);
}

import type { DemoRequest } from "@/lib/demo/fake-client";
import { DEMO_USER } from "@/lib/demo/users";
import { getDemoStore } from "@/lib/demo/server";
import { isDemoAllowed } from "@/lib/supabase/demo-guard";

export const dynamic = "force-dynamic";

/** Demo mode only: runs a request of the browser's fake Supabase client on the in-memory store. */
export async function POST(request: Request) {
  // 404 unless demo mode is on, and always on the production deployment (src/lib/supabase/demo-guard.ts).
  if (!isDemoAllowed()) return new Response("Not found", { status: 404 });
  let body: DemoRequest;
  try {
    body = (await request.json()) as DemoRequest;
  } catch {
    return Response.json({ data: null, error: { code: "PGRST100", message: "invalid JSON", details: null, hint: null }, status: 400 }, { status: 400 });
  }
  const result = await getDemoStore().execute(body, DEMO_USER.id);
  return Response.json(result);
}

import type { NextRequest } from "next/server";
import { DEMO_USER } from "@/lib/demo/users";
import { getDemoStore } from "@/lib/demo/server";
import { isDemoAllowed } from "@/lib/supabase/demo-guard";

export const dynamic = "force-dynamic";

/** Demo mode only: serves a receipt uploaded to the in-memory store (stands in for a signed URL). */
export function GET(request: NextRequest) {
  // 404 unless demo mode is on, and always on the production deployment (src/lib/supabase/demo-guard.ts).
  if (!isDemoAllowed()) return new Response("Not found", { status: 404 });
  const object = getDemoStore().readObject(request.nextUrl.searchParams.get("path") ?? "", DEMO_USER.id);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(object.bytes), {
    headers: { "Content-Type": object.contentType, "Cache-Control": "private, no-store" },
  });
}

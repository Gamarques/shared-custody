import type { NextRequest } from "next/server";
import { isDemoMode } from "@/lib/demo/mode";
import { DEMO_USER } from "@/lib/demo/users";
import { getDemoStore } from "@/lib/demo/server";

export const dynamic = "force-dynamic";

/** Demo mode only: serves a receipt uploaded to the in-memory store (stands in for a signed URL). */
export function GET(request: NextRequest) {
  if (!isDemoMode()) return new Response("Not found", { status: 404 });
  const object = getDemoStore().readObject(request.nextUrl.searchParams.get("path") ?? "", DEMO_USER.id);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(object.bytes), {
    headers: { "Content-Type": object.contentType, "Cache-Control": "private, no-store" },
  });
}

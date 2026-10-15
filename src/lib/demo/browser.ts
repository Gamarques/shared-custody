import { createDemoClient, type DemoRequest, type DemoResult } from "./fake-client";
import { DEMO_USER } from "./users";

export const DEMO_ENDPOINT = "/api/demo";

async function postToServer(request: DemoRequest): Promise<DemoResult> {
  try {
    const res = await fetch(DEMO_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    return (await res.json()) as DemoResult;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { data: null, error: { code: "", message, details: null, hint: null }, status: 0 };
  }
}

/**
 * Fake Supabase client for Client Components. Requests run on the server's in-memory store
 * (/api/demo), so what a form writes shows up on the server-rendered pages.
 */
export function createDemoBrowserClient() {
  return createDemoClient(postToServer, DEMO_USER);
}

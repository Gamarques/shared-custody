import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// Outside demo mode the factories must keep calling @supabase/ssr; in demo mode, never.
const { createServerClient, createBrowserClient } = vi.hoisted(() => ({
  createServerClient: vi.fn(() => ({ marker: "real-server" })),
  createBrowserClient: vi.fn(() => ({ marker: "real-browser" })),
}));
vi.mock("@supabase/ssr", () => ({ createServerClient, createBrowserClient }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));

import { isSupabaseConfigured } from "@/lib/env";
import { createClient as createBrowser } from "@/lib/supabase/client";
import { updateSession } from "@/lib/supabase/proxy";
import { createClient as createServer } from "@/lib/supabase/server";
import { isDemoMode } from "./mode";
import { resetDemoStore } from "./server";
import { DEMO_ANA } from "./users";

function realEnv() {
  vi.stubEnv("DEMO_MODE", "");
  vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcd1234.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  createServerClient.mockClear();
  createBrowserClient.mockClear();
});

describe("isDemoMode", () => {
  it("is off unless DEMO_MODE or NEXT_PUBLIC_DEMO_MODE is 1", () => {
    realEnv();
    expect(isDemoMode()).toBe(false);
    vi.stubEnv("DEMO_MODE", "true");
    expect(isDemoMode()).toBe(false);
    vi.stubEnv("DEMO_MODE", "1");
    expect(isDemoMode()).toBe(true);
    vi.stubEnv("DEMO_MODE", "");
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "1");
    expect(isDemoMode()).toBe(true);
  });
});

describe("without DEMO_MODE", () => {
  it("uses the real Supabase clients", async () => {
    realEnv();
    expect(await createServer()).toEqual({ marker: "real-server" });
    expect(createBrowser()).toEqual({ marker: "real-browser" });
  });

  it("reports Supabase as not configured when its variables are missing", () => {
    vi.stubEnv("DEMO_MODE", "");
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    expect(isSupabaseConfigured()).toBe(false);
  });
});

describe("with DEMO_MODE=1 and no Supabase variables", () => {
  function demoEnv() {
    vi.stubEnv("DEMO_MODE", "1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    resetDemoStore();
  }

  it("counts as configured", () => {
    demoEnv();
    expect(isSupabaseConfigured()).toBe(true);
  });

  it("the server factory returns the fake client, signed in as Ana, on the seed data", async () => {
    demoEnv();
    const supabase = await createServer();
    expect(createServerClient).not.toHaveBeenCalled();
    expect((await supabase.auth.getUser()).data.user?.id).toBe(DEMO_ANA.id);
    const { data } = await supabase.from("members").select("display_name, families(currency)").eq("user_id", DEMO_ANA.id).maybeSingle();
    expect(data).toEqual({ display_name: "Ana", families: { currency: "EUR" } });
  });

  it("the browser factory posts requests to /api/demo", async () => {
    demoEnv();
    const fetchMock = vi.fn(async () => Response.json({ data: [{ id: "x" }], error: null, status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await createBrowser().from("expenses").select("id").eq("id", "x");
    expect(createBrowserClient).not.toHaveBeenCalled();
    expect(result.data).toEqual([{ id: "x" }]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/demo");
    expect(JSON.parse(String(init.body))).toMatchObject({ kind: "table", table: "expenses", filters: [{ column: "id", op: "eq", value: "x" }] });
  });

  it("the proxy lets Ana in without a session and keeps her out of /onboarding", async () => {
    demoEnv();
    expect((await updateSession(new NextRequest("http://localhost/despesas"))).headers.get("location")).toBeNull();
    const res = await updateSession(new NextRequest("http://localhost/onboarding"));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/");
    expect(createServerClient).not.toHaveBeenCalled();
  });
});

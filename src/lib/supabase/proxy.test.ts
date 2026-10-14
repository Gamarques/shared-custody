import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser } }),
}));

import { updateSession } from "./proxy";

function configure() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcd1234.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
}

afterEach(() => {
  vi.unstubAllEnvs();
  getUser.mockReset();
});

describe("updateSession", () => {
  it("redirects anonymous users to /login keeping next", async () => {
    configure();
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await updateSession(new NextRequest("http://localhost/despesas?x=1"));
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("next")).toBe("/despesas?x=1");
  });

  it("lets anonymous users reach /login", async () => {
    configure();
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await updateSession(new NextRequest("http://localhost/login"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("lets signed-in users through", async () => {
    configure();
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const res = await updateSession(new NextRequest("http://localhost/"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("does nothing when Supabase is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const res = await updateSession(new NextRequest("http://localhost/"));
    expect(res.headers.get("location")).toBeNull();
    expect(getUser).not.toHaveBeenCalled();
  });
});

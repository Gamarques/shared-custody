import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const exchangeCodeForSession = vi.fn();
const signOut = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession, signOut } }),
}));

import { GET } from "./callback/route";
import { POST } from "./signout/route";

afterEach(() => {
  vi.unstubAllEnvs();
  exchangeCodeForSession.mockReset();
  signOut.mockReset();
});

describe("GET /auth/callback", () => {
  it("exchanges the code and redirects to next", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const res = await GET(new NextRequest("http://localhost/auth/callback?code=abc&next=/calendario"));
    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(new URL(res.headers.get("location")!).pathname).toBe("/calendario");
  });

  it("ignores an external next", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const res = await GET(new NextRequest("http://localhost/auth/callback?code=abc&next=//evil.com"));
    const loc = new URL(res.headers.get("location")!);
    expect(loc.host).toBe("localhost");
    expect(loc.pathname).toBe("/");
  });

  it("sends invalid/expired links back to /login?error=1", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: new Error("expired") });
    const res = await GET(new NextRequest("http://localhost/auth/callback?code=bad"));
    expect(res.headers.get("location")).toBe("http://localhost/login?error=1");
  });

  it("fails without a code", async () => {
    const res = await GET(new NextRequest("http://localhost/auth/callback"));
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("http://localhost/login?error=1");
  });
});

describe("POST /auth/signout", () => {
  it("signs out and redirects to /login with 303", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcd1234.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    signOut.mockResolvedValue({ error: null });
    const res = await POST(new NextRequest("http://localhost/auth/signout", { method: "POST" }));
    expect(signOut).toHaveBeenCalled();
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://localhost/login");
  });
});

import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// The proxy reads the user through getClaims (src/lib/supabase/session-user.ts).
const getClaims = vi.fn();
const members = vi.fn();
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getClaims },
    from: () => ({ select: () => ({ eq: () => ({ limit: () => members() }) }) }),
  }),
}));

import { updateSession } from "./proxy";

function configure() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcd1234.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
}

function signedIn(id: string) {
  getClaims.mockResolvedValue({ data: { claims: { sub: id } }, error: null });
}

function anonymous() {
  getClaims.mockResolvedValue({ data: null, error: null });
}

afterEach(() => {
  vi.unstubAllEnvs();
  getClaims.mockReset();
  members.mockReset();
});

describe("updateSession", () => {
  it("redirects anonymous users to /login keeping next", async () => {
    configure();
    anonymous();
    const res = await updateSession(new NextRequest("http://localhost/despesas?x=1"));
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("next")).toBe("/despesas?x=1");
  });

  it("lets anonymous users reach /login", async () => {
    configure();
    anonymous();
    const res = await updateSession(new NextRequest("http://localhost/login"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("lets signed-in users through", async () => {
    configure();
    signedIn("u1");
    members.mockResolvedValue({ data: [{ id: "m1" }] });
    const res = await updateSession(new NextRequest("http://localhost/"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("sends signed-in users without a family to /onboarding", async () => {
    configure();
    signedIn("u1");
    members.mockResolvedValue({ data: [] });
    const res = await updateSession(new NextRequest("http://localhost/despesas"));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/onboarding");
  });

  it("does not query members on the home, which checks the family in its own query (RNF-07)", async () => {
    configure();
    signedIn("u1");
    const res = await updateSession(new NextRequest("http://localhost/"));
    expect(res.headers.get("location")).toBeNull();
    expect(members).not.toHaveBeenCalled();
  });

  it("lets users without a family stay on /onboarding", async () => {
    configure();
    signedIn("u1");
    members.mockResolvedValue({ data: [] });
    const res = await updateSession(new NextRequest("http://localhost/onboarding"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("lets users without a family open an invite link", async () => {
    configure();
    signedIn("u1");
    members.mockResolvedValue({ data: [] });
    const res = await updateSession(new NextRequest(`http://localhost/convite/${"a".repeat(64)}`));
    expect(res.headers.get("location")).toBeNull();
  });

  it("sends anonymous invitees to /login and back to the invite", async () => {
    configure();
    anonymous();
    const path = `/convite/${"a".repeat(64)}`;
    const res = await updateSession(new NextRequest(`http://localhost${path}`));
    expect(new URL(res.headers.get("location")!).searchParams.get("next")).toBe(path);
  });

  it("still sends users without a family to /onboarding from /convidar", async () => {
    configure();
    signedIn("u1");
    members.mockResolvedValue({ data: [] });
    const res = await updateSession(new NextRequest("http://localhost/convidar"));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/onboarding");
  });

  it("sends users with a family away from /onboarding", async () => {
    configure();
    signedIn("u1");
    members.mockResolvedValue({ data: [{ id: "m1" }] });
    const res = await updateSession(new NextRequest("http://localhost/onboarding"));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/");
  });

  it("does nothing when Supabase is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const res = await updateSession(new NextRequest("http://localhost/"));
    expect(res.headers.get("location")).toBeNull();
    expect(getClaims).not.toHaveBeenCalled();
  });
});

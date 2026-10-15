import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ping = vi.fn();
vi.mock("@/lib/keepalive/keepalive", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/keepalive/keepalive")>()),
  pingSupabase: (...args: unknown[]) => ping(...args),
}));

import { GET } from "./route";

const get = (auth?: string) =>
  GET(new Request("http://localhost/api/cron/keepalive", { headers: auth ? { authorization: auth } : {} }));

let log: ReturnType<typeof vi.spyOn>;
let err: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  ping.mockReset();
  vi.stubEnv("CRON_SECRET", "s3cret-value");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcd1234.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  log = vi.spyOn(console, "log").mockImplementation(() => {});
  err = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/cron/keepalive (RNF-06)", () => {
  it("pings Supabase and writes one supabase_keepalive log line", async () => {
    ping.mockResolvedValue({ ok: true, dbTime: "2026-10-15T06:00:00+00:00", ms: 42 });
    const res = await get("Bearer s3cret-value");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, dbTime: "2026-10-15T06:00:00+00:00", ms: 42 });
    expect(ping).toHaveBeenCalledWith({ supabaseUrl: "https://abcd1234.supabase.co", supabaseAnonKey: "anon" });
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0][0] as string)).toMatchObject({ event: "supabase_keepalive", ok: true, ms: 42 });
  });

  it("rejects calls without the cron secret and does not ping", async () => {
    expect((await get()).status).toBe(401);
    expect((await get("Bearer nope")).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await get("Bearer ")).status).toBe(401);
    expect(ping).not.toHaveBeenCalled();
  });

  it("fails with 502 and an error log when the ping fails, so the run shows as failed", async () => {
    ping.mockResolvedValue({ ok: false, status: 503, error: "paused", ms: 10 });
    const res = await get("Bearer s3cret-value");
    expect(res.status).toBe(502);
    expect(JSON.parse(err.mock.calls[0][0] as string)).toMatchObject({ event: "supabase_keepalive", ok: false, status: 503 });
    expect(log).not.toHaveBeenCalled();
  });

  it("fails with 500 when the Supabase env vars are missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect((await get("Bearer s3cret-value")).status).toBe(500);
    expect(ping).not.toHaveBeenCalled();
  });
});

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { isAuthorizedCron, pingSupabase } from "./keepalive";

const env = { supabaseUrl: "https://abcd1234.supabase.co", supabaseAnonKey: "anon" };

describe("isAuthorizedCron", () => {
  it("accepts only the exact Vercel bearer header", () => {
    expect(isAuthorizedCron("Bearer s3cret-value", "s3cret-value")).toBe(true);
    expect(isAuthorizedCron("Bearer wrong-value", "s3cret-value")).toBe(false);
    expect(isAuthorizedCron("s3cret-value", "s3cret-value")).toBe(false);
    expect(isAuthorizedCron(null, "s3cret-value")).toBe(false);
  });

  it("denies everyone when CRON_SECRET is not set", () => {
    expect(isAuthorizedCron("Bearer ", undefined)).toBe(false);
    expect(isAuthorizedCron("Bearer ", "  ")).toBe(false);
    expect(isAuthorizedCron("Bearer undefined", undefined)).toBe(false);
  });
});

describe("pingSupabase", () => {
  it("calls the keepalive_ping RPC with the anon key and returns the database time", async () => {
    const fetchImpl = vi.fn(async () => new Response('"2026-10-15T06:00:00.123+00:00"', { status: 200 }));
    let t = 1000;
    const result = await pingSupabase(env, fetchImpl as unknown as typeof fetch, () => (t += 40));
    expect(result).toEqual({ ok: true, dbTime: "2026-10-15T06:00:00.123+00:00", ms: 40 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://abcd1234.supabase.co/rest/v1/rpc/keepalive_ping");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ apikey: "anon", Authorization: "Bearer anon" });
  });

  it("reports HTTP errors with the status and body", async () => {
    const fetchImpl = async () => new Response('{"message":"function not found"}', { status: 404 });
    const result = await pingSupabase(env, fetchImpl as typeof fetch);
    expect(result).toMatchObject({ ok: false, status: 404, error: '{"message":"function not found"}' });
  });

  it("reports network errors instead of throwing", async () => {
    const fetchImpl = async () => {
      throw new TypeError("fetch failed");
    };
    const result = await pingSupabase(env, fetchImpl as typeof fetch);
    expect(result).toMatchObject({ ok: false, status: null, error: "fetch failed" });
  });
});

describe("vercel.json cron (RNF-06)", () => {
  const config = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string; schedule: string }[] };
  const cron = config.crons.find((c) => c.path === "/api/cron/keepalive");

  it("points at an existing route", () => {
    expect(cron).toBeDefined();
    expect(existsSync("src/app/api/cron/keepalive/route.ts")).toBe(true);
  });

  it("runs at most once a day (Hobby limit) and never leaves 7 days without a ping", () => {
    const [minute, hour, dom, month, dow] = cron!.schedule.split(" ");
    expect([minute, hour, dom, month].every((f) => /^\d+$/.test(f) || f === "*")).toBe(true);
    expect(/^\d+$/.test(minute) && /^\d+$/.test(hour)).toBe(true);
    expect(dom).toBe("*");
    expect(month).toBe("*");
    const days = dow.split(",").map(Number).sort((a, b) => a - b);
    const gaps = days.map((d, i) => (i + 1 < days.length ? days[i + 1] - d : days[0] + 7 - d));
    expect(Math.max(...gaps)).toBeLessThan(7);
  });
});

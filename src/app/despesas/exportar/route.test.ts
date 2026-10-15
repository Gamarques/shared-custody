import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const results: Record<string, unknown[]> = {};
const calls: { table: string; chain: [string, unknown[]][] }[] = [];
let user: { id: string } | null = { id: "u1" };
function query(table: string) {
  const entry = { table, chain: [] as [string, unknown[]][] };
  calls.push(entry);
  const next = () => Promise.resolve(results[table].shift());
  const q: Record<string, unknown> = {
    then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => next().then(ok, fail),
    maybeSingle: next,
  };
  for (const m of ["select", "eq", "is", "gte", "lt", "order"]) {
    q[m] = (...args: unknown[]) => {
      entry.chain.push([m, args]);
      return q;
    };
  }
  return q;
}
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) }, from: query }),
}));

import { GET } from "./route";

const get = (qs = "") => GET(new Request(`http://localhost/despesas/exportar${qs}`));

function queue(rows: unknown[] | null) {
  results.members = [
    { data: { family_id: "f1", families: { timezone: "Europe/Lisbon" } } },
    { data: [{ id: "m1", display_name: "José" }] },
  ];
  results.expenses = [rows ? { data: rows } : { data: null, error: { message: "boom" } }];
}

beforeEach(() => {
  calls.length = 0;
  user = { id: "u1" };
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcd1234.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-14T12:00:00Z"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("GET /despesas/exportar (RF-15)", () => {
  it("returns the month as a UTF-8 CSV attachment with a BOM and correct accents", async () => {
    queue([
      { paid_by: "m1", amount_cents: 1250, spent_on: "2026-10-05", description: "Ação de São João", category: "saude", payer_share_bps: 5000, status: "pending" },
    ]);
    const res = await get("?mes=2026-09");
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="despesas-2026-09.csv"');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder("utf-8").decode(bytes);
    expect(text).toContain("Ação de São João");
    expect(text).toContain("José");
    const chain = calls.find((c) => c.table === "expenses")!.chain;
    expect(chain).toContainEqual(["gte", ["spent_on", "2026-09-01"]]);
    expect(chain).toContainEqual(["lt", ["spent_on", "2026-10-01"]]);
    expect(chain).toContainEqual(["is", ["deleted_at", null]]);
  });

  it("defaults to the current month in the family timezone", async () => {
    queue([]);
    const res = await get();
    expect(res.headers.get("Content-Disposition")).toContain("despesas-2026-10.csv");
  });

  it("rejects anonymous callers and reports query errors", async () => {
    user = null;
    expect((await get()).status).toBe(401);
    user = { id: "u1" };
    queue(null);
    expect((await get()).status).toBe(500);
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Records every supabase.from(table) call and the chain applied to it; resolves to `result`.
let result: unknown;
const calls: { table: string; chain: [string, unknown[]][] }[] = [];
function query(table: string) {
  const entry = { table, chain: [] as [string, unknown[]][] };
  calls.push(entry);
  const q: Record<string, unknown> = { maybeSingle: () => Promise.resolve(result) };
  for (const m of ["select", "eq", "gt", "gte", "is", "order"]) {
    q[m] = (...args: unknown[]) => {
      entry.chain.push([m, args]);
      return q;
    };
  }
  return q;
}
vi.mock("@/lib/supabase/server", () => ({
  // Only getClaims: the home must not ask Supabase Auth for the user (RNF-07).
  createClient: async () => ({ auth: { getClaims: async () => claims }, from: query }),
}));
let claims: unknown = { data: { claims: { sub: "u1" } }, error: null };
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh() {} }),
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));

import Home from "./page";
import { GET } from "./api/health/route";

const rule = {
  id: "r1",
  starts_on: "2026-01-04", // a Sunday
  first_member_id: "m1",
  handover_weekday: 0,
  handover_time: "18:00:00",
  valid_from: "2026-01-04",
  valid_to: null,
  created_at: "2026-01-01T10:00:00.000000+00:00",
};
function family(extra: Record<string, unknown> = {}) {
  return {
    data: {
      family_id: "f1",
      families: {
        timezone: "Europe/Lisbon",
        children: [{ name: "Lia", created_at: "2026-01-01T10:00:00+00:00" }],
        members: [
          { id: "m1", display_name: "Ana", color: "#2f6f5e" },
          { id: "m2", display_name: "Bruno", color: "#fde047" },
        ],
        custody_rules: [rule],
        custody_overrides: [],
        ...extra,
      },
    },
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("home page", () => {
  it("renders without Supabase configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const html = renderToStaticMarkup(await Home());
    expect(html).toContain("<h1>Guarda Partilhada</h1>");
    expect(html).toContain("Supabase ainda não configurado");
  });
});

describe("home page: com quem está hoje (RF-05)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcd1234.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    // Wednesday 2026-10-14, 10:00 in Lisbon (WEST). Week 40 of the rule: Ana has the child.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-14T09:00:00Z"));
    calls.length = 0;
  });

  it("shows the holder in their color, the next handover and the countdown", async () => {
    result = family();
    const html = renderToStaticMarkup(await Home());
    expect(html).toContain("Lia está com");
    expect(html).toMatch(/data-testid="current-holder" data-color="#2f6f5e">Ana</);
    expect(html).toContain('style="background:#2f6f5e;color:#ffffff"');
    expect(html).toContain("Domingo, 18/10, às 18:00, com");
    expect(html).toMatch(/data-testid="next-holder" data-color="#fde047">Bruno</);
    expect(html).toContain('style="background:#fde047;color:#000000"');
    // 2026-10-14 10:00 -> 2026-10-18 18:00 Lisbon.
    expect(html).toContain('<span data-testid="countdown">Faltam 4 dias e 8 horas</span>');
  });

  it("reads everything with a single query, limited to overrides that have not ended (RNF-07)", async () => {
    result = family();
    await Home();
    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("members");
    const chain = Object.fromEntries(calls[0].chain);
    expect(chain.eq).toEqual(["user_id", "u1"]);
    expect(chain.gt).toEqual(["families.custody_overrides.ends_at", "2026-10-14T09:00:00.000Z"]);
    const select = String(chain.select[0]);
    for (const embedded of ["members(id, display_name, color)", "custody_rules(", "custody_overrides(", "children(", "expenses(", "settlements("]) {
      expect(select).toContain(embedded);
    }
  });

  it("shows this month's expenses and balance from the same query", async () => {
    result = family({
      currency: "EUR",
      expenses: [
        // Ana paid 100,00 at 50%: Bruno owes 50,00. Bruno paid 80,00 at 30%: Ana owes 56,00.
        { id: "e1", paid_by: "m1", amount_cents: 10000, payer_share_bps: 5000, status: "confirmed", spent_on: "2026-10-02" },
        { id: "e2", paid_by: "m2", amount_cents: 8000, payer_share_bps: 3000, status: "pending", spent_on: "2026-10-05" },
        // Last month: outside the month, so not counted even when returned.
        { id: "e3", paid_by: "m2", amount_cents: 5000, payer_share_bps: 5000, status: "confirmed", spent_on: "2026-09-28" },
      ],
      settlements: [],
    });
    const html = renderToStaticMarkup(await Home());
    expect(html).toContain("Despesas de outubro");
    expect(html).toContain("180,00");
    expect(html).toContain("2 despesas");
    expect(html).toContain("Saldo de outubro");
    expect(html).toContain("6,00");
    expect(html).toContain("Ana deve a Bruno");
    const chain = calls[0].chain;
    expect(chain).toContainEqual(["gte", ["families.expenses.spent_on", "2026-10-01"]]);
    expect(chain).toContainEqual(["is", ["families.expenses.deleted_at", null]]);
  });

  it("shows an override with its reason", async () => {
    result = family({
      custody_overrides: [
        {
          id: "o1",
          starts_at: "2026-10-14T00:00:00+00:00",
          ends_at: "2026-10-15T08:00:00+00:00",
          member_id: "m2",
          reason: "Consulta no dentista",
          created_at: "2026-10-10T10:00:00+00:00",
        },
      ],
    });
    const html = renderToStaticMarkup(await Home());
    expect(html).toMatch(/data-testid="current-holder" data-color="#fde047">Bruno</);
    expect(html).toContain("Exceção: Consulta no dentista");
    expect(html).toContain("Amanhã às 09:00, com");
    expect(html).toMatch(/data-testid="next-holder" data-color="#2f6f5e">Ana</);
    expect(html).toContain("Faltam 23 horas<");
  });

  it("links to the rule screen when no rule exists", async () => {
    result = family({ custody_rules: [] });
    const html = renderToStaticMarkup(await Home());
    expect(html).toContain("A regra de guarda ainda não foi definida.");
    expect(html).toContain('href="/guarda"');
    expect(html).toContain('href="/excecoes"');
    expect(html).toContain('href="/despesas/nova"');
    expect(html).not.toContain("countdown");
  });

  it("says when custody has not started yet", async () => {
    result = family({ custody_rules: [{ ...rule, starts_on: "2026-10-18", valid_from: "2026-10-18" }] });
    const html = renderToStaticMarkup(await Home());
    expect(html).toContain("A guarda ainda não começou.");
    expect(html).toMatch(/Domingo, 18\/10, às 18:00, com <span[^>]*>Ana</);
  });

  it("uses a default label without a child and handles a failed query", async () => {
    result = family({ children: [] });
    expect(renderToStaticMarkup(await Home())).toContain("A criança está com");
    result = { data: null, error: { code: "PGRST000", message: "down" } };
    expect(renderToStaticMarkup(await Home())).toContain("Não foi possível carregar a família.");
  });

  it("sends a user without a family to /onboarding (the proxy skips that check on /)", async () => {
    result = { data: null, error: null };
    await expect(Home()).rejects.toThrow("redirect:/onboarding");
  });

  it("sends a session that does not verify to /login", async () => {
    claims = { data: null, error: { message: "Invalid JWT signature" } };
    try {
      await expect(Home()).rejects.toThrow("redirect:/login");
      expect(calls).toHaveLength(0);
    } finally {
      claims = { data: { claims: { sub: "u1" } }, error: null };
    }
  });
});

describe("GET /api/health", () => {
  it("returns ok and the Supabase status", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const res = GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, supabaseConfigured: false });
  });
});

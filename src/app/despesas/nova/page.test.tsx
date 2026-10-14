import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Each supabase.from(table) call returns a chainable query that resolves to the next queued
// result for that table; the chain applied to it is recorded.
const results: Record<string, unknown[]> = {};
const calls: { table: string; chain: [string, unknown[]][] }[] = [];
function query(table: string) {
  const entry = { table, chain: [] as [string, unknown[]][] };
  calls.push(entry);
  const next = () => Promise.resolve(results[table].shift());
  const q: Record<string, unknown> = {
    then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => next().then(ok, fail),
    maybeSingle: next,
  };
  for (const m of ["select", "eq", "order"]) {
    q[m] = (...args: unknown[]) => {
      entry.chain.push([m, args]);
      return q;
    };
  }
  return q;
}
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "u2" } } }) }, from: query }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));

import NewExpensePage from "./page";

const members = {
  data: [
    { id: "m1", display_name: "Ana" },
    { id: "m2", display_name: "Bruno" },
  ],
};

function queue(defaultBps: number, currency = "EUR") {
  results.members = [
    { data: { id: "m2", family_id: "f1", families: { timezone: "Europe/Lisbon", currency, default_payer_share_bps: defaultBps } } },
    members,
  ];
}

async function render() {
  return renderToStaticMarkup(await NewExpensePage());
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("new expense page (RF-08, RF-09)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcd1234.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    vi.useFakeTimers({ toFake: ["Date"] });
    // 23:30 in UTC is already the 15th in Lisbon (UTC+1 in October).
    vi.setSystemTime(new Date("2026-10-14T23:30:00Z"));
    calls.length = 0;
  });

  it("offers every field, paid by the caller today, with the family default share filled in", async () => {
    queue(5000);
    const html = await render();
    expect(html).toMatch(/<input id="amount" type="text" inputMode="decimal"[^>]*value=""/);
    expect(html).toContain("Valor (EUR)");
    expect(html).toMatch(/id="spentOn" type="date" max="2026-10-15" value="2026-10-15"/);
    expect(html).toMatch(/id="description"[^>]*value=""/);
    for (const label of ["Saúde", "Escola", "Alimentação", "Vestuário", "Lazer", "Transporte"]) {
      expect(html).toContain(`>${label}</option>`);
    }
    expect(html).toContain('<option value="outros" selected="">Outros</option>');
    expect(html).toContain('<option value="m2" selected="">Bruno</option>');
    expect(html).toContain('<option value="m1">Ana</option>');
    // RF-09: the default is filled in and editable (a plain text input, not read-only).
    expect(html).toMatch(/<input id="payerPercent" type="text"[^>]*value="50"\/>/);
    expect(html).not.toMatch(/id="payerPercent"[^>]*(readOnly|disabled)/);
    expect(html).not.toContain("Usar o padrão da família");
    expect(html).toContain("Registrar despesa");

    // Only the caller's family members are listed (RLS does the rest).
    const memberCalls = calls.filter((c) => c.table === "members");
    expect(memberCalls[0].chain).toContainEqual(["eq", ["user_id", "u2"]]);
    expect(memberCalls[1].chain).toContainEqual(["eq", ["family_id", "f1"]]);
  });

  it("fills in a non-round family default and shows it in the default form", async () => {
    queue(3333, "BRL");
    const html = await render();
    expect(html).toMatch(/id="payerPercent"[^>]*value="33,33"/);
    expect(html).toMatch(/id="defaultPercent"[^>]*value="33,33"/);
    expect(html).toContain("Padrão da família: 33,33% para quem pagou.");
    expect(html).toContain("Valor (BRL)");
    expect(html).toContain("Mudar o padrão não altera as despesas já registradas.");
  });

  it("handles a missing family", async () => {
    results.members = [{ data: null }];
    expect(await render()).toContain("Não foi possível carregar a família.");
  });

  it("renders without Supabase configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    expect(await render()).toContain("Supabase ainda não configurado");
  });
});

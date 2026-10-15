import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Each supabase.from(table) call returns a chainable query resolving to the next queued result;
// the chain applied to it is recorded.
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
  for (const m of ["select", "eq", "is", "gte", "lt", "order"]) {
    q[m] = (...args: unknown[]) => {
      entry.chain.push([m, args]);
      return q;
    };
  }
  return q;
}
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) }, from: query }),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));

import ExpensesPage from "./page";

const expenses = [
  { id: "e1", paid_by: "m1", amount_cents: 1050, spent_on: "2026-10-12", description: "Dentista", category: "saude", payer_share_bps: 5000, status: "pending", receipt_path: null },
  { id: "e2", paid_by: "m2", amount_cents: 2999, spent_on: "2026-10-03", description: "Livros", category: "escola", payer_share_bps: 6000, status: "confirmed", receipt_path: "f1/e2.jpg" },
];

function queue(rows: unknown[] | null = expenses) {
  results.members = [
    { data: { id: "m2", family_id: "f1", families: { timezone: "Europe/Lisbon", currency: "EUR" } } },
    { data: [{ id: "m1", display_name: "Ana" }, { id: "m2", display_name: "Bruno" }] },
  ];
  results.expenses = [rows ? { data: rows } : { data: null, error: { message: "boom" } }];
}

async function render(params: Record<string, string> = {}) {
  return renderToStaticMarkup(await ExpensesPage({ searchParams: Promise.resolve(params) }));
}

const expenseChain = () => calls.find((c) => c.table === "expenses")!.chain;

beforeEach(() => {
  calls.length = 0;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcd1234.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-14T12:00:00Z"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("expense list page (RF-10)", () => {
  it("defaults to the current month and shows the total of the list", async () => {
    queue();
    const html = await render();
    expect(expenseChain()).toContainEqual(["gte", ["spent_on", "2026-10-01"]]);
    expect(expenseChain()).toContainEqual(["lt", ["spent_on", "2026-11-01"]]);
    expect(expenseChain()).toContainEqual(["is", ["deleted_at", null]]);
    expect(html).toContain("Dentista");
    expect(html).toContain("Bruno");
    expect(html).toMatch(/Total:.*40,49.*2 despesas/);
  });

  it("applies month, category and payer filters", async () => {
    queue([expenses[0]]);
    const html = await render({ mes: "2026-09", categoria: "saude", pagou: "m1" });
    expect(expenseChain()).toContainEqual(["gte", ["spent_on", "2026-09-01"]]);
    expect(expenseChain()).toContainEqual(["lt", ["spent_on", "2026-10-01"]]);
    expect(expenseChain()).toContainEqual(["eq", ["category", "saude"]]);
    expect(expenseChain()).toContainEqual(["eq", ["paid_by", "m1"]]);
    expect(html).toMatch(/Total:.*10,50.*1 despesa/);
  });

  it("'todos' sends no month bounds", async () => {
    queue();
    await render({ mes: "todos" });
    expect(expenseChain().some(([m]) => m === "gte" || m === "lt")).toBe(false);
  });

  it("ignores a payer outside the family", async () => {
    queue();
    await render({ pagou: "stranger" });
    expect(expenseChain().some(([m, a]) => m === "eq" && a[0] === "paid_by")).toBe(false);
  });

  it("shows an empty state with a zero total", async () => {
    queue([]);
    const html = await render();
    expect(html).toContain("Nenhuma despesa para este filtro.");
    expect(html).toMatch(/Total:.*0,00/);
  });

  it("shows an alert, not a wrong total, when the query fails", async () => {
    queue(null);
    const html = await render();
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("Total:");
  });

  it("shows decision buttons only on expenses paid by the other member, and the dispute comment", async () => {
    queue([
      { ...expenses[0], dispute_comment: null },
      { ...expenses[1], id: "e3", paid_by: "m2", status: "disputed", dispute_comment: "valor errado" },
    ]);
    const html = await render();
    expect(html.match(/data-testid="decision"/g)?.length).toBe(1);
    expect(html).toContain("Motivo: valor errado");
  });
});

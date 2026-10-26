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
  for (const m of ["select", "eq", "order"]) {
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

import ExpenseHistoryPage from "./page";

const before = {
  id: "e1", paid_by: "m1", amount_cents: 10000, spent_on: "2026-10-10", description: "Material escolar",
  category: "escola", payer_share_bps: 5000, receipt_path: null, status: "pending", dispute_comment: null, deleted_at: null,
};
const audit = [
  { seq: 3, action: "delete", changed_by: "u1", changed_at: "2026-10-13T09:00:00Z", old_data: { ...before, amount_cents: 12000 }, new_data: { ...before, amount_cents: 12000, deleted_at: "2026-10-13T09:00:00Z" } },
  { seq: 2, action: "update", changed_by: "u2", changed_at: "2026-10-12T17:30:00Z", old_data: before, new_data: { ...before, amount_cents: 12000 } },
  { seq: 1, action: "insert", changed_by: "u1", changed_at: "2026-10-10T09:00:00Z", old_data: null, new_data: before },
];

function queue(opts: { expense?: unknown; audit?: unknown[] | null } = {}) {
  results.members = [
    { data: { id: "m1", family_id: "f1", families: { timezone: "Europe/Lisbon", currency: "EUR" } } },
    { data: [{ id: "m1", user_id: "u1", display_name: "Ana" }, { id: "m2", user_id: "u2", display_name: "Bruno" }] },
  ];
  results.expenses = [
    { data: "expense" in opts ? opts.expense : { id: "e1", description: "Material escolar", amount_cents: 12000, spent_on: "2026-10-10", deleted_at: "2026-10-13T09:00:00Z" } },
  ];
  const rows = opts.audit === undefined ? audit : opts.audit;
  results.expense_audit = [rows ? { data: rows } : { data: null, error: { message: "boom" } }];
}

async function render(id = "e1") {
  return renderToStaticMarkup(await ExpenseHistoryPage({ params: Promise.resolve({ id }) }));
}

beforeEach(() => {
  calls.length = 0;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcd1234.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
});
afterEach(() => vi.unstubAllEnvs());

describe("expense history page (RF-12)", () => {
  it("lists every change, newest first, with who, when and what", async () => {
    queue();
    const html = await render();
    const auditChain = calls.find((c) => c.table === "expense_audit")!.chain;
    expect(auditChain).toContainEqual(["eq", ["expense_id", "e1"]]);
    expect(auditChain).toContainEqual(["order", ["seq", { ascending: false }]]);
    expect(html.match(/data-testid="history-entry"/g)?.length).toBe(3);
    const titles = [...html.matchAll(/<strong[^>]*>([^<]+ a despesa)<\/strong>/g)].map((m) => m[1]);
    expect(titles).toEqual(["Eliminou a despesa", "Alterou a despesa", "Criou a despesa"]);
    expect(html).toContain("Bruno, 12/10/2026 18:30");
    expect(html).toMatch(/Valor: 100,00.€ → 120,00.€/);
    expect(html).toContain("(eliminada)");
  });

  it("reads the expense only inside the caller's family", async () => {
    queue();
    await render("e1");
    const chain = calls.find((c) => c.table === "expenses")!.chain;
    expect(chain).toContainEqual(["eq", ["id", "e1"]]);
    expect(chain).toContainEqual(["eq", ["family_id", "f1"]]);
  });

  it("says when the expense does not exist or is not visible", async () => {
    queue({ expense: null });
    const html = await render("other");
    expect(html).toContain("Despesa não encontrada.");
    expect(calls.some((c) => c.table === "expense_audit")).toBe(false);
  });

  it("shows an alert when the audit cannot be read", async () => {
    queue({ audit: null });
    const html = await render();
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("history-entry");
  });
});

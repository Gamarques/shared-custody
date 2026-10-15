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

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

import BalancePage from "./page";

// The plan's "Exemplo de saldo": Ana (m1) owes Bruno (m2) 6,00.
const example = [
  { id: "e1", paid_by: "m1", amount_cents: 100_00, payer_share_bps: 5000, status: "confirmed", spent_on: "2026-10-03", description: "Material escolar", dispute_comment: null },
  { id: "e2", paid_by: "m2", amount_cents: 80_00, payer_share_bps: 3000, status: "pending", spent_on: "2026-10-05", description: "Dentista", dispute_comment: null },
];
const disputed = { id: "e3", paid_by: "m2", amount_cents: 45_50, payer_share_bps: 5000, status: "disputed", spent_on: "2026-10-08", description: "Óculos", dispute_comment: "Não combinamos" };

function queue({
  expenses = example as unknown[] | null,
  settlements = [] as unknown[] | null,
  members = [{ id: "m1", display_name: "Ana" }, { id: "m2", display_name: "Bruno" }],
} = {}) {
  results.members = [
    { data: { id: "m1", family_id: "f1", families: { timezone: "Europe/Lisbon", currency: "EUR" } } },
    { data: members },
  ];
  results.expenses = [expenses ? { data: expenses } : { data: null, error: { message: "boom" } }];
  results.settlements = [settlements ? { data: settlements } : { data: null, error: { message: "boom" } }];
}

async function render(params: Record<string, string> = {}) {
  const html = renderToStaticMarkup(await BalancePage({ searchParams: Promise.resolve(params) }));
  return html.replace(/[  ]/g, " ").replace(/<!-- -->/g, "");
}

const chain = (table: string) => calls.find((c) => c.table === table)!.chain;

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

describe("balance page (RF-13)", () => {
  it("shows who owes whom for the current month, from non-deleted expenses and settlements of the family", async () => {
    queue();
    const html = await render();
    expect(html).toContain("Outubro de 2026");
    expect(html).toContain("Ana deve 6,00 € a Bruno.");
    expect(html).toContain("2 despesas no saldo");
    expect(chain("expenses")).toContainEqual(["eq", ["family_id", "f1"]]);
    expect(chain("expenses")).toContainEqual(["is", ["deleted_at", null]]);
    expect(chain("expenses")).toContainEqual(["gte", ["spent_on", "2026-10-01"]]);
    expect(chain("expenses")).toContainEqual(["lt", ["spent_on", "2026-11-01"]]);
    expect(chain("settlements")).toContainEqual(["eq", ["family_id", "f1"]]);
    expect(chain("settlements")).toContainEqual(["gte", ["settled_on", "2026-10-01"]]);
    expect(chain("settlements")).toContainEqual(["lt", ["settled_on", "2026-11-01"]]);
    expect(html).toContain('href="/saldo?mes=2026-09"');
    expect(html).toContain('href="/saldo?mes=2026-11"');
  });

  it("keeps a disputed expense out of the balance, on the 'em disputa' line", async () => {
    queue({ expenses: [...example, disputed] });
    const html = await render();
    expect(html).toContain("Ana deve 6,00 € a Bruno.");
    expect(html).toContain("Em disputa");
    expect(html).toContain("Fora do saldo: 1 despesa. Se aceitas, Ana deveria 22,75 € a Bruno por elas.");
    expect(html).toMatch(/Óculos.*45,50 €, pago por Bruno; parte de Ana: 22,75 €\..*Motivo: Não combinamos/);
    expect(html).toContain('href="/despesas/e3/historico"');
  });

  it("says when nothing is in dispute", async () => {
    queue();
    expect(await render()).toContain("Nenhuma despesa em disputa neste período.");
  });

  it("subtracts settlements of the period", async () => {
    queue({ settlements: [{ from_member: "m1", to_member: "m2", amount_cents: 6_00, settled_on: "2026-10-20" }] });
    const html = await render();
    expect(html).toContain("Ninguém deve nada neste período.");
    expect(html).toContain("já descontados 1 acerto (6,00 €)");
  });

  it("lists settlements in the history and offers the form prefilled with the debt", async () => {
    queue({
      settlements: [{ id: "s1", from_member: "m1", to_member: "m2", amount_cents: 2_50, settled_on: "2026-10-12", note: "pix" }],
    });
    const html = await render();
    expect(html).toContain('data-testid="settlement"');
    expect(html).toContain("Ana pagou a Bruno");
    expect(html).toContain("pix");
    expect(html).toContain('data-testid="settlement-form"');
    expect(html).toContain('value="3,50"'); // 6,00 debt minus the 2,50 already settled
  });

  it("says when there is no settlement", async () => {
    queue();
    expect(await render()).toContain("Nenhum acerto neste período.");
  });

  it("a settlement larger than the debt flips the direction", async () => {
    queue({ settlements: [{ from_member: "m1", to_member: "m2", amount_cents: 10_00, settled_on: "2026-10-20" }] });
    expect(await render()).toContain("Bruno deve 4,00 € a Ana.");
  });

  it("'todos' queries without date bounds", async () => {
    queue();
    const html = await render({ mes: "todos" });
    expect(html).toContain("Todo o período");
    for (const t of ["expenses", "settlements"]) {
      expect(chain(t).some(([m]) => m === "gte" || m === "lt")).toBe(false);
    }
    expect(html).not.toContain("Anterior");
  });

  it("a date range includes its last day", async () => {
    queue({ expenses: [example[1]] });
    const html = await render({ de: "2026-10-05", ate: "2026-10-05" });
    expect(html).toContain("Dia 05/10/2026");
    expect(chain("expenses")).toContainEqual(["gte", ["spent_on", "2026-10-05"]]);
    expect(chain("expenses")).toContainEqual(["lt", ["spent_on", "2026-10-06"]]);
    expect(html).toContain("Ana deve 56,00 € a Bruno.");
  });

  it("an invalid range falls back to the current month with a notice", async () => {
    queue();
    const html = await render({ de: "2026-10-10", ate: "2026-10-01" });
    expect(html).toContain('data-testid="invalid-range"');
    expect(html).toContain("Outubro de 2026");
  });

  it("shows an alert, not a wrong balance, when a query fails", async () => {
    for (const failing of [{ expenses: null }, { settlements: null }]) {
      calls.length = 0;
      queue(failing);
      const html = await render();
      expect(html).toContain('role="alert"');
      expect(html).not.toContain(" deve ");
      expect(html).not.toContain("Ninguém deve");
    }
  });

  it("shows an alert when a row does not involve the two members", async () => {
    queue({ expenses: [{ ...example[0], paid_by: "ghost" }] });
    expect(await render()).toContain('role="alert"');
  });

  it("asks to invite the other member while the family has one", async () => {
    queue({ members: [{ id: "m1", display_name: "Ana" }] });
    const html = await render();
    expect(html).toContain("quando o outro responsável entrar");
    expect(calls.some((c) => c.table === "expenses")).toBe(false);
  });

  it("says when Supabase is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(await render()).toContain("Supabase ainda não configurado");
  });
});

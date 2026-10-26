import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Each supabase.from(table) call returns a chainable query that resolves to the next queued result.
const results: Record<string, unknown[]> = {};
function query(table: string) {
  const next = () => Promise.resolve(results[table].shift());
  const q: Record<string, unknown> = {
    then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => next().then(ok, fail),
    maybeSingle: next,
  };
  for (const m of ["select", "eq", "order"]) q[m] = () => q;
  return q;
}
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) }, from: query }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, replace() {} }) }));

import CustodyRulePage from "./page";

const me = { data: { family_id: "f1", families: { timezone: "Europe/Lisbon" } } };
const members = {
  data: [
    { id: "m1", user_id: "u1", display_name: "Ana" },
    { id: "m2", user_id: "u2", display_name: "Bruno" },
  ],
};
const v1 = {
  id: "r1",
  starts_on: "2026-01-04",
  first_member_id: "m1",
  handover_weekday: 0,
  handover_time: "18:00:00",
  valid_from: "2026-01-04",
  valid_to: null,
  created_at: "2026-01-01T10:00:00.000000+00:00",
  created_by: "u1",
};
const v2 = {
  ...v1,
  id: "r2",
  starts_on: "2026-06-05",
  first_member_id: "m2",
  handover_weekday: 5,
  handover_time: "19:00:00",
  valid_from: "2026-06-01",
  created_at: "2026-05-20T10:00:00.000000+00:00",
  created_by: "u2",
};

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcd1234.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
});
afterEach(() => vi.unstubAllEnvs());

async function render() {
  return renderToStaticMarkup(await CustodyRulePage());
}

describe("/guarda", () => {
  it("asks for the first rule when there is none", async () => {
    results.members = [me, members];
    results.custody_rules = [{ data: [] }];
    const html = await render();
    expect(html).toContain("Nenhuma regra definida ainda.");
    expect(html).toContain("Guardar regra");
    // No "valid from" field for the first version: it applies from the first handover.
    expect(html).not.toContain('id="validFrom"');
    expect(html).toContain(">Ana</option>");
    expect(html).toContain(">Bruno</option>");
  });

  it("shows the current version and keeps every previous one in the history", async () => {
    results.members = [me, members];
    results.custody_rules = [{ data: [v2, v1] }]; // created_at descending, as queried
    const html = await render();
    expect(html).toContain("Sexta-feira às 19:00; primeira troca em 05/06/2026 com Bruno");
    const history = html.slice(html.indexOf('data-testid="rule-versions"'));
    expect(history.match(/<li>/g)).toHaveLength(2);
    expect(history).toContain("<strong>Atual: </strong>Sexta-feira às 19:00");
    expect(history).toContain("Domingo às 18:00; primeira troca em 04/01/2026 com Ana; vale a partir de 04/01/2026");
    expect(history).toContain("por Bruno");
    expect(history).toContain("por Ana");
    // A change is saved as a new version, with a "valid from" date.
    expect(html).toContain("Guardar nova versão");
    expect(html).toContain('id="validFrom"');
  });

  it("explains when Supabase is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(await render()).toContain("Supabase ainda não configurado");
  });
});

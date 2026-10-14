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
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) }, from: query }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));

import OverridesPage from "./page";

const me = { data: { family_id: "f1", families: { timezone: "Europe/Lisbon" } } };
const members = {
  data: [
    { id: "m1", user_id: "u1", display_name: "Ana", color: "#2f6f5e" },
    { id: "m2", user_id: "u2", display_name: "Bruno", color: "#fde047" },
  ],
};
const rules = {
  data: [
    { handover_time: "19:30:00", created_at: "2026-06-01T10:00:00+00:00" },
    { handover_time: "18:00:00", created_at: "2026-01-01T10:00:00+00:00" },
  ],
};
const natal = {
  id: "o1",
  starts_at: "2026-12-24T18:00:00+00:00",
  ends_at: "2026-12-26T18:00:00+00:00",
  member_id: "m2",
  reason: "Natal",
  created_at: "2026-10-01T10:00:00+00:00",
  created_by: "u1",
};
const ongoing = {
  id: "o2",
  starts_at: "2026-10-12T17:00:00+00:00",
  ends_at: "2026-10-16T17:00:00+00:00",
  member_id: "m1",
  reason: "Férias",
  created_at: "2026-10-01T11:00:00+00:00",
  created_by: "u2",
};
const past = {
  id: "o3",
  starts_at: "2026-08-01T17:00:00+00:00",
  ends_at: "2026-08-15T17:00:00+00:00",
  member_id: "m2",
  reason: "Férias de verão",
  created_at: "2026-07-01T10:00:00+00:00",
  created_by: "u1",
};

function queue(overrides: unknown[]) {
  results.members = [me, members];
  results.custody_rules = [rules];
  results.custody_overrides = [{ data: overrides }];
}

async function render() {
  return renderToStaticMarkup(await OverridesPage());
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("overrides page (RF-07)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcd1234.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-14T09:00:00Z")); // Wednesday, 10:00 in Lisbon
    calls.length = 0;
  });

  it("lists current and upcoming exceptions with member, reason and period in the family zone", async () => {
    queue([natal, ongoing, past]);
    const html = await render();

    const upcoming = /data-testid="upcoming-overrides">(.*?)<\/ul>/.exec(html)![1];
    const items = [...upcoming.matchAll(/<li data-testid="override">(.*?)<\/li>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""));
    expect(items).toEqual([
      " Férias: com Ana de 12/10/2026 18:00 a 16/10/2026 18:00. Criada por Bruno. Remover",
      " Natal: com Bruno de 24/12/2026 18:00 a 26/12/2026 18:00. Criada por Ana. Remover",
    ]);
    expect(upcoming).toContain("background:#fde047");

    // Past exceptions are folded and cannot be removed from here.
    const folded = /data-testid="past-overrides">(.*?)<\/ul>/.exec(html)![1];
    expect(folded).toContain("Férias de verão");
    expect(folded).not.toContain("Remover");
    expect(html).toContain("Exceções passadas (1)");

    // Only the caller's family is read (RLS does the rest).
    const overrideCall = calls.find((c) => c.table === "custody_overrides")!;
    expect(overrideCall.chain).toContainEqual(["eq", ["family_id", "f1"]]);
  });

  it("offers the form with presets, starting today at the current rule's handover time", async () => {
    queue([]);
    const html = await render();
    expect(html).toContain("Nenhuma exceção prevista.");
    expect(html).not.toContain("Exceções passadas");
    expect(html).toContain('id="startDate" type="date" value="2026-10-14"');
    expect(html).toContain('id="endDate" type="date" value="2026-10-15"');
    expect(html).toMatch(/id="startTime"[^>]*value="19:30"/);
    for (const preset of ["Troca de dias", "Férias", "Feriado"]) expect(html).toContain(`>${preset}</button>`);
    expect(html).toContain('<option value="m1" selected="">Ana</option>');
    expect(html).toContain('<option value="m2">Bruno</option>');
    expect(html).toContain('href="/calendario"');
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

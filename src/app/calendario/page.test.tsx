import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Records every supabase.from(table) call and the chain applied to it; the n-th maybeSingle()
// resolves to results[n].
let results: unknown[] = [];
const calls: { table: string; chain: [string, unknown[]][] }[] = [];
function query(table: string) {
  const entry = { table, chain: [] as [string, unknown[]][] };
  calls.push(entry);
  const q: Record<string, unknown> = { maybeSingle: () => Promise.resolve(results[calls.length - 1]) };
  for (const m of ["select", "eq", "gt", "lt"]) {
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

import CalendarPage from "./page";

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
  const families = {
    timezone: "Europe/Lisbon",
    members: [
      { id: "m1", display_name: "Ana", color: "#2f6f5e" },
      { id: "m2", display_name: "Bruno", color: "#fde047" },
    ],
    custody_rules: [rule],
    custody_overrides: [],
    ...extra,
  };
  return [{ data: { families: { timezone: families.timezone } } }, { data: { family_id: "f1", families } }];
}

async function render(mes?: string) {
  return renderToStaticMarkup(await CalendarPage({ searchParams: Promise.resolve(mes ? { mes } : {}) }));
}

/** Attributes of the <td> for a date. */
function cell(html: string, date: string): string {
  const m = new RegExp(`<td[^>]*data-date="${date}"[^>]*>.*?</td>`).exec(html);
  if (!m) throw new Error(`no cell for ${date}`);
  return m[0];
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("calendar page (RF-06)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcd1234.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-14T09:00:00Z")); // Wednesday, 10:00 in Lisbon
    calls.length = 0;
  });

  it("shows the current month with each day in the holder's color and the handovers marked", async () => {
    results = family();
    const html = await render();
    expect(html).toContain('data-testid="month-title">Outubro de 2026<');
    expect(html.match(/<tr>/g)).toHaveLength(6); // header + 5 weeks
    expect(html.match(/<td /g)).toHaveLength(35);

    expect(cell(html, "2026-10-14")).toContain("background:#2f6f5e");
    expect(cell(html, "2026-10-14")).toContain('aria-current="date"');
    expect(cell(html, "2026-10-14")).toContain('aria-label="14/10: com Ana"');
    expect(cell(html, "2026-10-21")).toContain("background:#fde047");
    expect(cell(html, "2026-10-21")).toContain('data-holders="m2"');

    const sunday = cell(html, "2026-10-18");
    expect(sunday).toContain("background:linear-gradient(to right, #2f6f5e 0% 75%, #fde047 75% 100%)");
    expect(sunday).toContain('data-holders="m1,m2"');
    expect(sunday).toContain('aria-label="18/10: com Ana; troca às 18:00 para Bruno"');
    expect(sunday).toContain("⇄ 18:00");

    const marked = [...html.matchAll(/data-date="([\d-]+)"[^>]*>(?:(?!<\/td>).)*data-testid="handover"/g)].map((m) => m[1]);
    expect(marked).toEqual(["2026-10-04", "2026-10-11", "2026-10-18", "2026-10-25", "2026-11-01"]);
    expect(cell(html, "2026-09-28")).toContain('class="day outside"');

    expect(html).toContain('href="/calendario?mes=2026-09"');
    expect(html).toContain('href="/calendario?mes=2026-11"');
    expect(html).toMatch(/background:#2f6f5e"><\/span> Ana/);
    expect(html).toMatch(/background:#fde047"><\/span> Bruno/);
  });

  it("opens the month in ?mes= and limits overrides to the days shown", async () => {
    results = family();
    const html = await render("2027-02");
    expect(html).toContain("Fevereiro de 2027");
    expect(html.match(/<td /g)).toHaveLength(28);
    expect(html).not.toContain('aria-current="date"');

    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.table === "members")).toBe(true);
    const chain = Object.fromEntries(calls[1].chain);
    expect(chain.eq).toEqual(["user_id", "u1"]);
    // 2027-02-01 00:00 and 2027-03-01 00:00 in Lisbon (WET).
    expect(chain.gt).toEqual(["families.custody_overrides.ends_at", "2027-02-01T00:00:00.000Z"]);
    expect(chain.lt).toEqual(["families.custody_overrides.starts_at", "2027-03-01T00:00:00.000Z"]);
  });

  it("falls back to the current month for an invalid ?mes=", async () => {
    results = family();
    expect(await render("2026-13")).toContain("Outubro de 2026");
  });

  it("shows an override's reason on its days", async () => {
    results = family({
      custody_overrides: [
        {
          id: "o1",
          starts_at: "2026-10-07T00:00:00+00:00",
          ends_at: "2026-10-08T00:00:00+00:00",
          member_id: "m1",
          reason: "Aniversário",
          created_at: "2026-10-01T10:00:00+00:00",
        },
      ],
    });
    const html = await render();
    expect(cell(html, "2026-10-07")).toContain("troca às 01:00 para Ana");
    expect(cell(html, "2026-10-08")).toContain('aria-label="08/10: com Ana (Aniversário); troca às 01:00 para Bruno"');
  });

  it("shows each exception in the grid with its reason and lists the month's exceptions (RF-07)", async () => {
    results = family({
      custody_overrides: [
        {
          id: "o1",
          starts_at: "2026-10-16T17:00:00+00:00", // Friday 18:00 in Lisbon, in Ana's week
          ends_at: "2026-10-22T17:00:00+00:00",
          member_id: "m1",
          reason: "Férias",
          created_at: "2026-10-01T10:00:00+00:00",
        },
      ],
    });
    const html = await render();
    // Labelled where it starts and at the start of the next week row; all its days are marked.
    const labelled = [...html.matchAll(/data-date="([\d-]+)"(?:(?!<\/td>).)*data-testid="reason">Férias</g)].map((m) => m[1]);
    expect(labelled).toEqual(["2026-10-16", "2026-10-19"]);
    for (const date of ["2026-10-16", "2026-10-18", "2026-10-22"]) expect(cell(html, date)).toContain("day exception");
    expect(cell(html, "2026-10-15")).not.toContain("exception");
    // The rule's Sunday handover is overridden: Ana all day.
    expect(cell(html, "2026-10-18")).toContain("background:#2f6f5e");
    expect(cell(html, "2026-10-18")).not.toContain('data-testid="handover"');
    expect(cell(html, "2026-10-22")).toContain('aria-label="22/10: com Ana (Férias); troca às 18:00 para Bruno"');

    const list = /data-testid="month-exceptions">(.*?)<\/ul>/.exec(html)![1].replace(/<[^>]+>/g, "");
    expect(list).toBe(" Férias: com Ana de 16/10/2026 18:00 a 22/10/2026 18:00");
    expect(html).toContain('href="/excecoes"');
  });

  it("says when the month has no exceptions", async () => {
    results = family();
    expect(await render()).toContain("Nenhuma exceção neste mês.");
  });

  it("links to the rule screen when no rule exists", async () => {
    results = family({ custody_rules: [] });
    const html = await render();
    expect(html).toContain("A regra de guarda ainda não foi definida.");
    expect(html).toContain('href="/guarda"');
    expect(html).not.toContain('data-testid="handover"');
  });

  it("stamps when the page was generated, for the offline copy (RF-16)", async () => {
    results = family();
    const html = await render();
    expect(html).toContain('data-testid="saved-at">Atualizado em 14/10/2026 10:00<');
    // Online at render time: no offline notice in the markup.
    expect(html).not.toContain('data-testid="offline-notice"');
  });

  it("handles a missing family", async () => {
    results = [{ data: null }];
    expect(await render()).toContain("Não foi possível carregar a família.");
  });

  it("renders without Supabase configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    expect(await render()).toContain("Supabase ainda não configurado");
  });
});

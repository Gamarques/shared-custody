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
  for (const m of ["select", "eq", "is", "gt", "order", "limit"]) q[m] = () => q;
  return q;
}
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) }, from: query }),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "app.example", "x-forwarded-proto": "https" }),
}));

import InviteOtherPage from "./page";

const me = { data: { family_id: "f1", families: { name: "Família Silva" } } };

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcd1234.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
});
afterEach(() => vi.unstubAllEnvs());

async function render() {
  return renderToStaticMarkup(await InviteOtherPage());
}

describe("/convidar", () => {
  it("offers to create a link when there is no pending invite", async () => {
    results.members = [me, { count: 1 }];
    results.invites = [{ data: [] }];
    expect(await render()).toContain("Criar ligação de convite");
  });

  it("shows the pending invite link", async () => {
    const token = "c".repeat(64);
    results.members = [me, { count: 1 }];
    results.invites = [{ data: [{ token, email: "bruno@example.com", expires_at: "2026-10-21T10:00:00Z" }] }];
    const html = await render();
    expect(html).toContain(`https://app.example/convite/${token}`);
    expect(html).toContain("Só bruno@example.com poderá aceitar");
    expect(html).toContain("mailto:bruno%40example.com");
  });

  it("blocks inviting when the family already has 2 members", async () => {
    results.members = [me, { count: 2 }];
    results.invites = [];
    const html = await render();
    expect(html).toContain("já tem os dois responsáveis");
    expect(html).not.toContain("Criar ligação de convite");
  });
});

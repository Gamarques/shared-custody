import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminFamily, AdminUser } from "@/lib/admin/admin";

// /admin guard and rendering. The supabase server client is faked: getClaims decides whether
// there is a session, rpc() answers is_app_admin and the two list functions.
let claims: unknown;
let rpcResults: Record<string, { data: unknown; error: unknown }>;
const rpcCalls: string[] = [];
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getClaims: async () => claims },
    rpc: async (fn: string) => {
      rpcCalls.push(fn);
      return rpcResults[fn] ?? { data: null, error: { code: "42501" } };
    },
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));
// The Server Actions are tested in actions.test.ts.
vi.mock("./actions", () => ({ removeMemberAction: vi.fn(), deleteFamilyAction: vi.fn() }));

import AdminPage from "./page";
import { AdminMenuLink } from "../SessionBar";

const family: AdminFamily = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Família Silva Costa",
  currency: "EUR",
  timezone: "Europe/Lisbon",
  created_at: "2026-09-01T10:00:00Z",
  members: [
    {
      member_id: "m1",
      user_id: "u1",
      email: "ana@example.com",
      display_name: "Ana",
      color: "#2f6f5e",
      role: "owner",
      joined_at: "2026-09-01T10:00:00Z",
    },
    {
      member_id: "m2",
      user_id: "u2",
      email: "bruno@example.com",
      display_name: "Bruno",
      color: "#c2410c",
      role: "member",
      joined_at: "2026-09-02T10:00:00Z",
    },
  ],
  children_count: 1,
  expenses_count: 5,
  open_expenses_count: 2,
  last_activity_at: "2026-11-02T18:30:00Z",
};
const users: AdminUser[] = [
  { id: "u9", email: "root@example.com", created_at: "2026-08-01T10:00:00Z", last_sign_in_at: "2026-11-03T08:00:00Z", is_admin: true, families: [] },
  { id: "u1", email: "ana@example.com", created_at: "2026-09-01T10:00:00Z", last_sign_in_at: null, is_admin: false, families: [{ id: family.id, name: family.name }] },
];

function signedIn(admin: boolean | "error") {
  claims = { data: { claims: { sub: "u9", email: "root@example.com" } }, error: null };
  rpcResults = {
    is_app_admin: admin === "error" ? { data: null, error: { code: "PGRST202" } } : { data: admin, error: null },
    admin_list_families: { data: [family], error: null },
    admin_list_users: { data: users, error: null },
  };
}

async function render(params: Record<string, string> = {}) {
  return renderToStaticMarkup(await AdminPage({ searchParams: Promise.resolve(params) }));
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcd1234.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  rpcCalls.length = 0;
});
afterEach(() => vi.unstubAllEnvs());

describe("/admin guard", () => {
  it("sends a visitor without a session to /login, back to /admin afterwards", async () => {
    claims = { data: null, error: null };
    rpcResults = {};
    await expect(render()).rejects.toThrow("redirect:/login?next=/admin");
    expect(rpcCalls).toEqual([]);
  });

  it("answers 404 to a signed-in user who is not an admin, without listing anything", async () => {
    signedIn(false);
    await expect(render()).rejects.toThrow("notFound");
    expect(rpcCalls).toEqual(["is_app_admin"]);
  });

  it("answers 404 when the admin check itself fails", async () => {
    signedIn("error");
    await expect(render()).rejects.toThrow("notFound");
    expect(rpcCalls).not.toContain("admin_list_families");
  });
});

describe("/admin for an admin", () => {
  it("lists every family with members, counters and the two actions", async () => {
    signedIn(true);
    const html = await render();
    expect(rpcCalls).toEqual(expect.arrayContaining(["is_app_admin", "admin_list_families", "admin_list_users"]));
    expect(html).toContain("Administração");
    expect(html).toContain("Família Silva Costa");
    expect(html).toContain("ana@example.com");
    expect(html).toContain("bruno@example.com");
    expect(html).toContain("2 despesas em aberto");
    expect(html.match(/Remover da família/g)).toHaveLength(2);
    expect(html).toContain("Eliminar família");
    expect(html).toMatch(/aria-current="page"[^>]*>Famílias/);
  });

  it("shows the users tab with family and admin flag", async () => {
    signedIn(true);
    const html = await render({ vista: "utilizadores" });
    expect(html).toContain('data-testid="admin-users"');
    expect(html).toContain("root@example.com");
    expect(html).toContain("Sem família");
    expect(html).toContain(">Admin<");
    expect(html).not.toContain("Eliminar família");
  });

  it("reports receipts left in Storage after a delete", async () => {
    signedIn(true);
    const html = await render({ aviso: "recibos", familia: family.id });
    expect(html).toContain("algumas fotografias de recibos ficaram no Storage");
  });
});

describe("Admin link in the account menu", () => {
  it("is rendered only for admins", async () => {
    signedIn(true);
    expect(renderToStaticMarkup((await AdminMenuLink())!)).toContain('href="/admin"');
    signedIn(false);
    expect(await AdminMenuLink()).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import type { AdminFamily, AdminUser } from "@/lib/admin/admin";
import { createDemoClient, type DemoRequest } from "./fake-client";
import { createDemoStore } from "./seed";
import { DEMO_ANA, DEMO_BRUNO, DEMO_RITA } from "./users";

// Demo mode mirrors the admin functions of 20261103000100_app_admins.sql: Ana is the admin.

const NOW = new Date("2026-10-15T12:00:00Z");

function setup(user: { id: string; email: string } = DEMO_ANA, variant?: "no-family") {
  const store = createDemoStore(NOW, variant);
  store.now = () => NOW;
  const client = createDemoClient((r: DemoRequest) => store.execute(r, user.id), user);
  return { store, client, familyId: String(store.tables.families[0].id) };
}

describe("demo admin", () => {
  it("Ana is an admin, Bruno is not and gets 42501 on every admin function", async () => {
    expect((await setup().client.rpc("is_app_admin")).data).toBe(true);
    const { client, familyId } = setup(DEMO_BRUNO);
    expect((await client.rpc("is_app_admin")).data).toBe(false);
    for (const [fn, args] of [
      ["admin_list_families", {}],
      ["admin_list_users", {}],
      ["admin_remove_member", { p_family_id: familyId, p_user_id: DEMO_ANA.id }],
      ["admin_delete_family", { p_family_id: familyId }],
    ] as const) {
      expect((await client.rpc(fn, args)).error?.code).toBe("42501");
    }
  });

  it("lists the seed family and every user", async () => {
    const { client } = setup();
    const families = (await client.rpc("admin_list_families")).data as AdminFamily[];
    expect(families).toHaveLength(1);
    expect(families[0]).toMatchObject({ name: "Família Silva Costa", children_count: 1, currency: "EUR" });
    expect(families[0].members.map((m) => m.email)).toEqual([DEMO_ANA.email, DEMO_BRUNO.email]);
    expect(families[0].open_expenses_count).toBeGreaterThan(0);
    const users = (await client.rpc("admin_list_users")).data as AdminUser[];
    expect(users.map((u) => u.email).sort()).toEqual([DEMO_ANA.email, DEMO_BRUNO.email, DEMO_RITA.email].sort());
    expect(users.find((u) => u.email === DEMO_RITA.email)?.families).toEqual([]);
    expect(users.find((u) => u.email === DEMO_ANA.email)?.is_admin).toBe(true);
  });

  it("refuses to remove a member with expenses (AD001)", async () => {
    const { client, familyId } = setup();
    expect((await client.rpc("admin_remove_member", { p_family_id: familyId, p_user_id: DEMO_BRUNO.id })).error?.code).toBe("AD001");
  });

  it("removes a member without financial history, with their overrides and pending invites", async () => {
    // no-family variant: Bruno owns a family alone, with a pending invite he created.
    const { store, client } = setup(DEMO_ANA, "no-family");
    const familyId = String(store.tables.families[0].id);
    expect(store.tables.invites).toHaveLength(1);
    expect((await client.rpc("admin_remove_member", { p_family_id: familyId, p_user_id: DEMO_BRUNO.id })).error).toBeNull();
    expect(store.tables.members).toEqual([]);
    expect(store.tables.invites).toEqual([]);
    expect(store.adminActions.map((a) => a.action)).toEqual(["remove_member"]);
  });

  it("deletes the family and lets the admin remove its receipt files", async () => {
    const { store, client, familyId } = setup();
    store.objects.set(`${familyId}/r.jpg`, { contentType: "image/jpeg", base64: "" });
    expect((await client.rpc("admin_delete_family", { p_family_id: familyId })).error).toBeNull();
    for (const table of ["families", "members", "expenses", "expense_audit", "settlements", "custody_rules", "custody_overrides", "invites", "children"]) {
      expect({ table, rows: store.tables[table].length }).toEqual({ table, rows: 0 });
    }
    const listed = await client.storage.from("receipts").list(familyId, { limit: 100 });
    expect(listed.data?.map((o) => o.name)).toEqual(["r.jpg"]);
    await client.storage.from("receipts").remove([`${familyId}/r.jpg`]);
    expect(store.objects.size).toBe(0);
    expect((await client.rpc("admin_delete_family", { p_family_id: familyId })).error?.code).toBe("P0002");
  });
});

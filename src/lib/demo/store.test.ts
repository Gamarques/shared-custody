import { describe, expect, it } from "vitest";
import { computeBalance } from "@/lib/balance/balance";
import { getCustodyHolder } from "@/lib/custody/holder";
import { createDemoClient, type DemoRequest, type Row } from "./fake-client";
import { createDemoStore, DEMO_TIMEZONE } from "./seed";
import { DemoStore, parseSelect } from "./store";
import { DEMO_ANA, DEMO_BRUNO } from "./users";

// Mid-month, so every seeded day of the current month is in the past.
const NOW = new Date("2026-10-15T12:00:00Z");

function setup(user: { id: string; email: string } = DEMO_ANA) {
  const store = createDemoStore(NOW);
  store.now = () => NOW;
  const client = createDemoClient((r: DemoRequest) => store.execute(r, user.id), user);
  const family = store.tables.families[0];
  const ana = store.tables.members.find((m) => m.user_id === DEMO_ANA.id)!;
  const bruno = store.tables.members.find((m) => m.user_id === DEMO_BRUNO.id)!;
  return { store, client, familyId: String(family.id), ana, bruno };
}

describe("parseSelect", () => {
  it("parses columns and nested embeds", () => {
    expect(parseSelect("family_id, families(timezone, children(name, created_at), members(id))")).toEqual([
      { kind: "column", name: "family_id" },
      {
        kind: "embed",
        name: "families",
        children: [
          { kind: "column", name: "timezone" },
          { kind: "embed", name: "children", children: [{ kind: "column", name: "name" }, { kind: "column", name: "created_at" }] },
          { kind: "embed", name: "members", children: [{ kind: "column", name: "id" }] },
        ],
      },
    ]);
  });

  it("rejects unbalanced parentheses", () => {
    expect(() => parseSelect("families(timezone")).toThrow(/Unbalanced/);
  });
});

describe("demo seed", () => {
  it("has the family of Ana and Bruno in EUR and Europe/Lisbon, with a child", () => {
    const { store } = setup();
    expect(store.tables.families).toHaveLength(1);
    expect(store.tables.families[0]).toMatchObject({ currency: "EUR", timezone: "Europe/Lisbon", default_payer_share_bps: 5000 });
    expect(store.tables.members.map((m) => [m.display_name, m.role])).toEqual([
      ["Ana", "owner"],
      ["Bruno", "member"],
    ]);
    expect(store.tables.children.map((c) => c.name)).toEqual(["Leonor"]);
    expect(store.tables.invites[0].accepted_by).toBe(DEMO_BRUNO.id);
  });

  it("has a weekly rule and one override that the custody function understands", () => {
    const { store, ana, bruno } = setup();
    const [rule] = store.tables.custody_rules;
    expect(rule).toMatchObject({ handover_weekday: 0, handover_time: "18:00:00", first_member_id: ana.id, valid_to: null });
    expect(rule.valid_from).toBe(rule.starts_on);
    expect(store.tables.custody_overrides).toHaveLength(1);
    const override = store.tables.custody_overrides[0];
    const during = new Date(Date.parse(String(override.starts_at)) + 3_600_000);
    const schedule = {
      timezone: DEMO_TIMEZONE,
      memberIds: [String(ana.id), String(bruno.id)],
      rules: store.tables.custody_rules as never,
      overrides: store.tables.custody_overrides as never,
    };
    expect(getCustodyHolder(during, schedule)).toMatchObject({ memberId: bruno.id, source: "override", reason: "Feriado com os avós" });
    expect(getCustodyHolder(NOW, { ...schedule, overrides: [] })?.source).toBe("rule");
  });

  it("gives the plan's example: Ana owes Bruno 6.00 this month and over all time", () => {
    const { store, ana, bruno } = setup();
    const expenses = store.tables.expenses as never[];
    const settlements = store.tables.settlements as never[];
    const month = computeBalance(String(ana.id), String(bruno.id), expenses, settlements, { from: "2026-10-01", to: "2026-11-01" });
    expect(month).toMatchObject({ debtor: ana.id, creditor: bruno.id, amountCents: 600 });
    expect(month.disputed).toMatchObject({ count: 1, debtor: ana.id, amountCents: 2250 });
    expect(month.expenseCount).toBe(2);
    const all = computeBalance(String(ana.id), String(bruno.id), expenses, settlements);
    expect(all).toMatchObject({ debtor: ana.id, creditor: bruno.id, amountCents: 600 });
  });

  it("has confirmed, pending, disputed and deleted expenses, and a settlement", () => {
    const { store } = setup();
    const byName = Object.fromEntries(store.tables.expenses.map((e) => [e.description, e]));
    expect(byName["Material escolar"]).toMatchObject({ amount_cents: 10000, payer_share_bps: 5000, status: "confirmed" });
    expect(byName["Dentista"]).toMatchObject({ amount_cents: 8000, payer_share_bps: 3000, status: "pending" });
    expect(byName["Ténis de futebol"]).toMatchObject({ status: "disputed", decided_by: DEMO_ANA.id });
    expect(byName["Cinema"].deleted_at).not.toBeNull();
    expect(store.tables.settlements).toHaveLength(1);
  });

  it("writes audit rows for inserts, edits, decisions and the deletion", () => {
    const { store } = setup();
    const material = store.tables.expenses.find((e) => e.description === "Material escolar")!;
    const rows = store.tables.expense_audit.filter((a) => a.expense_id === material.id);
    expect(rows.map((a) => a.action)).toEqual(["insert", "update", "update"]);
    expect((rows[1].old_data as Row).amount_cents).toBe(9500);
    expect((rows[1].new_data as Row).amount_cents).toBe(10000);
    expect(rows[2].changed_by).toBe(DEMO_BRUNO.id);
    expect(store.tables.expense_audit.some((a) => a.action === "delete")).toBe(true);
  });

  it("never dates seed activity in the future", () => {
    const { store } = setup();
    for (const t of ["expenses", "settlements", "expense_audit", "custody_rules"]) {
      for (const row of store.tables[t]) {
        const at = String(row.created_at ?? row.changed_at);
        expect(Date.parse(at)).toBeLessThan(NOW.getTime());
      }
    }
  });
});

describe("fake client: reads", () => {
  it("selects with filters, order and embedded resources like the home", async () => {
    const { client } = setup();
    const { data, error } = await client
      .from("members")
      .select("family_id, families(timezone, children(name), members(id, display_name), custody_overrides(id, ends_at))")
      .eq("user_id", DEMO_ANA.id)
      .gt("families.custody_overrides.ends_at", "2030-01-01T00:00:00Z")
      .maybeSingle();
    expect(error).toBeNull();
    const families = (data as { families: Row }).families;
    expect(families.timezone).toBe("Europe/Lisbon");
    expect(families.children).toEqual([{ name: "Leonor" }]);
    expect((families.members as Row[]).map((m) => m.display_name).sort()).toEqual(["Ana", "Bruno"]);
    // The embedded filter only applies to the embedded table.
    expect(families.custody_overrides).toEqual([]);
  });

  it("filters by is/gte/lt/eq and orders descending", async () => {
    const { client, familyId } = setup();
    const { data } = await client
      .from("expenses")
      .select("description, spent_on")
      .eq("family_id", familyId)
      .is("deleted_at", null)
      .gte("spent_on", "2026-10-01")
      .lt("spent_on", "2026-11-01")
      .order("spent_on", { ascending: false });
    expect((data as Row[]).map((e) => e.description)).toEqual(["Ténis de futebol", "Dentista", "Material escolar"]);
  });

  it("counts with head: true", async () => {
    const { client, familyId } = setup();
    const res = await client.from("members").select("id", { count: "exact", head: true }).eq("family_id", familyId);
    expect(res).toMatchObject({ data: null, count: 2, error: null });
  });

  it("single() fails without exactly one row; maybeSingle() gives null", async () => {
    const { client } = setup();
    expect((await client.from("expenses").select("id").single()).error?.code).toBe("PGRST116");
    expect(await client.from("expenses").select("id").eq("id", "nope").maybeSingle()).toMatchObject({ data: null, error: null });
  });

  it("applies RLS: another family's rows are invisible", async () => {
    const { store } = setup();
    store.users.push({ id: "c0c0c0c0-0000-4000-8000-000000000003", email: "carla@demo.example" });
    store.createFamily("Outra", "Carla", "#1d4ed8", "c0c0c0c0-0000-4000-8000-000000000003");
    const carla = createDemoClient((r) => store.execute(r, "c0c0c0c0-0000-4000-8000-000000000003"), {
      id: "c0c0c0c0-0000-4000-8000-000000000003",
      email: "carla@demo.example",
    });
    expect((await carla.from("expenses").select("id")).data).toEqual([]);
    expect(((await carla.from("members").select("display_name")).data as Row[]).map((m) => m.display_name)).toEqual(["Carla"]);
  });

  it("answers auth calls with the demo user", async () => {
    const { client } = setup();
    expect((await client.auth.getClaims()).data.claims).toMatchObject({ sub: DEMO_ANA.id, email: DEMO_ANA.email });
    expect((await client.auth.getUser()).data.user).toEqual({ id: DEMO_ANA.id, email: DEMO_ANA.email });
  });
});

describe("fake client: writes", () => {
  it("inserts an expense as pending with an audit row, and it shows up in reads", async () => {
    const { client, store, familyId, ana } = setup();
    const { error, data } = await client.from("expenses").insert({
      family_id: familyId,
      paid_by: ana.id,
      amount_cents: 2550,
      spent_on: "2026-10-14",
      description: "Farmácia",
      category: "saude",
      payer_share_bps: 5000,
      receipt_path: null,
    });
    expect(error).toBeNull();
    expect(data).toBeNull(); // no select(): nothing returned, like PostgREST
    const row = store.tables.expenses.find((e) => e.description === "Farmácia")!;
    expect(row).toMatchObject({ status: "pending", created_by: DEMO_ANA.id, deleted_at: null });
    expect(store.tables.expense_audit.at(-1)).toMatchObject({ expense_id: row.id, action: "insert" });
  });

  it("rejects invalid expenses with the SQLSTATE the form maps", async () => {
    const { client, familyId, ana } = setup();
    const base = { family_id: familyId, paid_by: ana.id, spent_on: "2026-10-14", description: "x", category: "saude", payer_share_bps: 5000 };
    expect((await client.from("expenses").insert({ ...base, amount_cents: 0 })).error?.code).toBe("23514");
    expect((await client.from("expenses").insert({ ...base, amount_cents: 100, paid_by: "someone" })).error?.code).toBe("23503");
    expect((await client.from("expenses").insert({ ...base, amount_cents: 100, family_id: "other" })).error?.code).toBe("42501");
  });

  it("editing a confirmed expense sends it back to pending", async () => {
    const { client, store } = setup();
    const material = store.tables.expenses.find((e) => e.description === "Material escolar")!;
    const { error } = await client.from("expenses").update({ amount_cents: 12000 }).eq("id", material.id);
    expect(error).toBeNull();
    expect(material).toMatchObject({ amount_cents: 12000, status: "pending", decided_by: null });
  });

  it("does not let the status change outside confirm/dispute", async () => {
    const { client, store } = setup();
    const dentista = store.tables.expenses.find((e) => e.description === "Dentista")!;
    expect((await client.from("expenses").update({ status: "confirmed" }).eq("id", dentista.id)).error?.code).toBe("42501");
  });

  it("deletes logically and records a delete in the audit", async () => {
    const { client, store } = setup();
    const dentista = store.tables.expenses.find((e) => e.description === "Dentista")!;
    await client.from("expenses").update({ deleted_at: new Date().toISOString() }).eq("id", dentista.id);
    expect(dentista.deleted_at).not.toBeNull();
    expect(store.tables.expense_audit.at(-1)).toMatchObject({ expense_id: dentista.id, action: "delete" });
    expect((await client.from("expenses").update({ description: "y" }).eq("id", dentista.id)).error?.code).toBe("55000");
  });

  it("confirm_expense and dispute_expense follow decide_expense", async () => {
    const { client, store } = setup();
    const dentista = store.tables.expenses.find((e) => e.description === "Dentista")!;
    expect((await client.rpc("dispute_expense", { eid: dentista.id, comment: "  " })).error?.code).toBe("22023");
    const { data, error } = await client.rpc("confirm_expense", { eid: dentista.id });
    expect(error).toBeNull();
    expect(data).toMatchObject({ status: "confirmed", decided_by: DEMO_ANA.id });
    expect((await client.rpc("confirm_expense", { eid: dentista.id })).error?.code).toBe("55000");
    // Ana paid the school material: only Bruno decides it.
    const material = store.tables.expenses.find((e) => e.description === "Material escolar")!;
    expect((await client.rpc("confirm_expense", { eid: material.id })).error?.code).toBe("42501");
  });

  it("keeps the audit, custody rules and settlements append-only", async () => {
    const { client } = setup();
    expect((await client.from("expense_audit").delete().eq("action", "insert")).error?.code).toBe("42501");
    expect((await client.from("custody_rules").update({ handover_time: "10:00" }).eq("handover_weekday", 0)).error?.code).toBe("42501");
    expect((await client.from("settlements").delete().eq("amount_cents", 3000)).error?.code).toBe("42501");
  });

  it("inserts a new custody rule version and a settlement", async () => {
    const { client, store, familyId, ana, bruno } = setup();
    const rule = await client
      .from("custody_rules")
      .insert({ family_id: familyId, first_member_id: bruno.id, starts_on: "2026-10-18", handover_weekday: 0, handover_time: "19:30" });
    expect(rule.error).toBeNull();
    expect(store.tables.custody_rules).toHaveLength(2);
    expect(store.tables.custody_rules[1]).toMatchObject({ handover_time: "19:30:00", valid_from: "2026-10-15" });
    expect((await client.from("custody_rules").insert({ family_id: familyId, first_member_id: ana.id, starts_on: "2026-10-19", handover_weekday: 0, handover_time: "18:00" })).error?.code).toBe("23514");

    const s = await client
      .from("settlements")
      .insert({ family_id: familyId, from_member: ana.id, to_member: bruno.id, amount_cents: 600, settled_on: "2026-10-15", note: null });
    expect(s.error).toBeNull();
    const balance = computeBalance(String(ana.id), String(bruno.id), store.tables.expenses as never[], store.tables.settlements as never[]);
    expect(balance.amountCents).toBe(0);
  });

  it("adds and removes overrides; update with select() returns the rows", async () => {
    const { client, store, familyId, bruno } = setup();
    const added = await client.from("custody_overrides").insert({
      family_id: familyId,
      member_id: bruno.id,
      starts_at: "2026-12-24T18:00:00+00:00",
      ends_at: "2026-12-26T18:00:00+00:00",
      reason: "Natal",
    });
    expect(added.error).toBeNull();
    const natal = store.tables.custody_overrides.find((o) => o.reason === "Natal")!;
    expect(natal.starts_at).toBe("2026-12-24T18:00:00.000Z");
    await client.from("custody_overrides").delete().eq("id", natal.id);
    expect(store.tables.custody_overrides.some((o) => o.reason === "Natal")).toBe(false);

    const updated = await client.from("families").update({ default_payer_share_bps: 6000 }).eq("id", familyId).select("id");
    expect(updated).toMatchObject({ data: [{ id: familyId }], error: null });
  });

  it("refuses invites and a second family for a full family", async () => {
    const { client } = setup();
    expect((await client.rpc("create_invite", { invite_email: null })).error?.code).toBe("IV005");
    expect((await client.rpc("create_family", { family_name: "X", member_display_name: "Ana", member_color: "#2f6f5e" })).error?.code).toBe("23505");
  });

  it("runs the invite flow for a new family", async () => {
    const store = new DemoStore({ now: () => NOW });
    store.users.push({ ...DEMO_ANA }, { ...DEMO_BRUNO });
    const as = (u: { id: string; email: string }) => createDemoClient((r) => store.execute(r, u.id), u);
    expect((await as(DEMO_ANA).rpc("create_family", { family_name: "Nova", member_display_name: "Ana", member_color: "#2f6f5e" })).error).toBeNull();
    const invite = await as(DEMO_ANA).rpc("create_invite", { invite_email: "BRUNO@demo.example " });
    const token = (invite.data as { token: string }[])[0].token;
    expect(((await as(DEMO_BRUNO).rpc("get_invite", { invite_token: token })).data as Row[])[0]).toMatchObject({
      family_name: "Nova",
      inviter_name: "Ana",
      status: "valid",
      taken_colors: ["#2f6f5e"],
    });
    expect((await as(DEMO_BRUNO).rpc("accept_invite", { invite_token: token, member_display_name: "Bruno", member_color: "#2f6f5e" })).error?.code).toBe("IV006");
    expect((await as(DEMO_BRUNO).rpc("accept_invite", { invite_token: token, member_display_name: "Bruno", member_color: "#c2410c" })).error).toBeNull();
    expect(store.tables.members).toHaveLength(2);
  });

  it("stores receipts per family and signs a local URL", async () => {
    const { client, familyId } = setup();
    const storage = client.storage.from("receipts");
    const path = `${familyId}/r1.jpg`;
    const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" });
    expect((await storage.upload(path, jpeg, { contentType: "image/jpeg" })).error).toBeNull();
    expect((await storage.upload(path, jpeg, { contentType: "image/jpeg" })).error?.code).toBe("409");
    expect((await storage.upload("other-family/r.jpg", jpeg, { contentType: "image/jpeg" })).error?.code).toBe("403");
    const signed = await storage.createSignedUrl(path, 60);
    expect(signed.data?.signedUrl).toBe(`/api/demo/receipt?path=${encodeURIComponent(path)}`);
    await storage.remove([path]);
    expect((await storage.createSignedUrl(path, 60)).error).not.toBeNull();
  });
});

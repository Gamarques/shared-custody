import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, sqlState, type TestDb } from "@/test/pg";
import { toExpenseUpdate, type ExpenseFormInput } from "./expense-form";

// T-18 / RF-17: edit and logical deletion under RLS and the server rules, on PGlite with the
// real migrations.

let t: TestDb;
let ana: string;
let bruno: string;
let carla: string;
let familyId: string;
let anaMember: string;
let eid: string;

type Row = { status: string; dispute_comment: string | null; decided_by: string | null; deleted_at: string | null };

const asUser = (u: string, sql: string, params: unknown[] = []) => t.as(u, () => t.db.query(sql, params));
const row = async (): Promise<Row> =>
  (await t.db.query<Row>("select status, dispute_comment, decided_by, deleted_at from expenses where id = $1", [eid])).rows[0];
const actions = async () =>
  (await t.db.query<{ action: string }>("select action from expense_audit where expense_id = $1 order by seq", [eid])).rows.map((r) => r.action);
/** Same query as the list screen. */
const listed = async (u: string) =>
  (await asUser(u, "select id from expenses where family_id = $1 and deleted_at is null", [familyId])).rows.length;

beforeEach(async () => {
  t = await createTestDb();
  ana = await t.createUser("ana@example.com");
  bruno = await t.createUser("bruno@example.com");
  carla = await t.createUser("carla@example.com");
  familyId = await t.as(ana, async () => {
    const { rows } = await t.db.query<{ id: string }>("select create_family('Família', 'Ana', '#2f6f5e') as id");
    return rows[0].id;
  });
  const token = await t.as(ana, async () => (await t.db.query<{ token: string }>("select token from create_invite(null)")).rows[0].token);
  await t.as(bruno, () => t.db.query("select accept_invite($1, 'Bruno', '#1d4ed8')", [token]));
  await t.as(carla, () => t.db.query("select create_family('Outra', 'Carla', '#a21caf')"));
  const { rows } = await t.db.query<{ id: string; user_id: string }>("select id, user_id from members");
  anaMember = rows.find((r) => r.user_id === ana)!.id;
  eid = await t.as(ana, async () => {
    const r = await t.db.query<{ id: string }>(
      `insert into expenses (family_id, paid_by, amount_cents, spent_on, description, category)
       values ($1, $2, 10000, '2026-10-10', 'Material escolar', 'escola') returning id`,
      [familyId, anaMember],
    );
    return r.rows[0].id;
  });
}, 30_000);

describe("edit (RF-17)", () => {
  it("toExpenseUpdate sends the screen's columns and keeps family and receipt", async () => {
    const form: ExpenseFormInput = {
      amount: "123,45",
      spentOn: "2026-10-11",
      description: " Livros ",
      category: "escola",
      paidBy: anaMember,
      payerPercent: "60",
    };
    const patch = toExpenseUpdate(form);
    expect(patch).toEqual({
      paid_by: anaMember,
      amount_cents: 12345,
      spent_on: "2026-10-11",
      description: "Livros",
      category: "escola",
      payer_share_bps: 6000,
    });
    const cols = Object.keys(patch);
    await asUser(
      bruno,
      `update expenses set ${cols.map((c, i) => `${c} = $${i + 1}`).join(", ")} where id = $${cols.length + 1}`,
      [...Object.values(patch), eid],
    );
    const { rows } = await t.db.query<{ amount_cents: number; description: string }>(
      "select amount_cents, description from expenses where id = $1",
      [eid],
    );
    expect(rows[0]).toEqual({ amount_cents: 12345, description: "Livros" });
  });

  it("editing a confirmed expense sends it back to pending and clears the decision", async () => {
    await asUser(bruno, "select confirm_expense($1)", [eid]);
    await asUser(ana, "update expenses set amount_cents = 12000 where id = $1", [eid]);
    expect(await row()).toMatchObject({ status: "pending", decided_by: null, dispute_comment: null });
    await asUser(bruno, "select confirm_expense($1)", [eid]); // can be decided again
    expect((await row()).status).toBe("confirmed");
  });

  it("editing a disputed expense also sends it back to pending", async () => {
    await asUser(bruno, "select dispute_expense($1, 'valor errado')", [eid]);
    await asUser(ana, "update expenses set amount_cents = 9000 where id = $1", [eid]);
    expect(await row()).toMatchObject({ status: "pending", dispute_comment: null });
  });

  it("an edit that changes nothing keeps a confirmed expense confirmed", async () => {
    await asUser(bruno, "select confirm_expense($1)", [eid]);
    await asUser(ana, "update expenses set description = description where id = $1", [eid]);
    expect((await row()).status).toBe("confirmed");
  });

  it("an edit cannot also forge a status", async () => {
    expect(await sqlState(asUser(ana, "update expenses set amount_cents = 1, status = 'confirmed' where id = $1", [eid]))).toBe("42501");
    expect((await row()).status).toBe("pending");
  });

  it("the edit is audited", async () => {
    await asUser(ana, "update expenses set amount_cents = 12000 where id = $1", [eid]);
    expect(await actions()).toEqual(["insert", "update"]);
  });

  it("amount above the limit or family change is refused", async () => {
    expect(await sqlState(asUser(ana, "update expenses set amount_cents = 100000001 where id = $1", [eid]))).toBe("23514");
    const { rows } = await t.db.query<{ family_id: string }>("select family_id from members where user_id = $1", [carla]);
    expect(await sqlState(asUser(ana, "update expenses set family_id = $1 where id = $2", [rows[0].family_id, eid]))).not.toBeNull();
  });

  it("another family cannot edit it", async () => {
    const r = await asUser(carla, "update expenses set description = 'hack' where id = $1", [eid]);
    expect(r.affectedRows).toBe(0);
  });
});

describe("logical deletion (RF-17)", () => {
  it("disappears from the list, stays in the table and in the audit", async () => {
    expect(await listed(bruno)).toBe(1);
    await asUser(bruno, "update expenses set deleted_at = now() where id = $1", [eid]);
    expect(await listed(ana)).toBe(0);
    expect(await listed(bruno)).toBe(0);
    expect((await row()).deleted_at).not.toBeNull();
    expect(await actions()).toEqual(["insert", "delete"]);
    const { rows } = await asUser(ana, "select action, changed_by from expense_audit where expense_id = $1 order by seq", [eid]);
    expect(rows).toEqual([
      { action: "insert", changed_by: ana },
      { action: "delete", changed_by: bruno },
    ]);
  });

  it("deleted_at is the server clock, not the client's", async () => {
    await asUser(ana, "update expenses set deleted_at = '2000-01-01' where id = $1", [eid]);
    const { rows } = await t.db.query<{ ok: boolean }>(
      "select deleted_at > now() - interval '1 minute' as ok from expenses where id = $1",
      [eid],
    );
    expect(rows[0].ok).toBe(true);
  });

  it("a deleted expense cannot be edited, restored, deleted again or decided", async () => {
    await asUser(ana, "update expenses set deleted_at = now() where id = $1", [eid]);
    expect(await sqlState(asUser(ana, "update expenses set description = 'x' where id = $1", [eid]))).toBe("55000");
    expect(await sqlState(asUser(ana, "update expenses set deleted_at = null where id = $1", [eid]))).toBe("55000");
    expect(await sqlState(asUser(ana, "update expenses set deleted_at = now() where id = $1", [eid]))).toBe("55000");
    expect(await sqlState(asUser(bruno, "select confirm_expense($1)", [eid]))).toBe("P0002");
    expect(await actions()).toEqual(["insert", "delete"]);
  });

  it("a hard DELETE is refused and another family cannot delete logically", async () => {
    expect((await asUser(ana, "delete from expenses where id = $1", [eid])).affectedRows).toBe(0);
    const r = await asUser(carla, "update expenses set deleted_at = now() where id = $1", [eid]);
    expect(r.affectedRows).toBe(0);
    expect((await row()).deleted_at).toBeNull();
  });
});

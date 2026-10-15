import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, sqlState, type TestDb } from "@/test/pg";

// T-17 / RF-12, RNF-03: every change of an expense writes an audit row; audit rows never change.
// Real migrations on PGlite.

let t: TestDb;
let ana: string;
let bruno: string;
let carla: string;
let familyId: string;
let anaMember: string;
let brunoMember: string;
let eid: string;

type AuditRow = {
  action: string;
  changed_by: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown>;
};

/** Audit rows of the expense, oldest first, read as the table owner. */
const audit = async (id = eid): Promise<AuditRow[]> =>
  (
    await t.db.query<AuditRow>(
      "select action, changed_by, old_data, new_data from expense_audit where expense_id = $1 order by seq",
      [id],
    )
  ).rows;

const asUser = (u: string, sql: string, params: unknown[] = []) => t.as(u, () => t.db.query(sql, params));

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
  brunoMember = rows.find((r) => r.user_id === bruno)!.id;
  eid = await t.as(ana, async () => {
    const r = await t.db.query<{ id: string }>(
      `insert into expenses (family_id, paid_by, amount_cents, spent_on, description, category)
       values ($1, $2, 10000, '2026-10-10', 'Material escolar', 'escola') returning id`,
      [familyId, anaMember],
    );
    return r.rows[0].id;
  });
}, 30_000);

describe("every change writes an audit row (RF-12)", () => {
  it("creation is recorded with the author and the full new row", async () => {
    const rows = await audit();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "insert", changed_by: ana, old_data: null });
    expect(rows[0].new_data).toMatchObject({ id: eid, amount_cents: 10000, description: "Material escolar", status: "pending" });
  });

  it("an edit is recorded with the row before and after", async () => {
    await asUser(ana, "update expenses set amount_cents = 12345, description = 'Livros' where id = $1", [eid]);
    const rows = await audit();
    expect(rows.map((r) => r.action)).toEqual(["insert", "update"]);
    expect(rows[1].changed_by).toBe(ana);
    expect(rows[1].old_data).toMatchObject({ amount_cents: 10000, description: "Material escolar" });
    expect(rows[1].new_data).toMatchObject({ amount_cents: 12345, description: "Livros" });
  });

  it("each editable column on its own produces one record", async () => {
    const edits: Array<[string, unknown]> = [
      ["amount_cents", 999],
      ["spent_on", "2026-10-01"],
      ["description", "Outra"],
      ["category", "saude"],
      ["paid_by", brunoMember],
      ["payer_share_bps", 3000],
      ["receipt_path", `${familyId}/r.jpg`],
    ];
    for (const [col, value] of edits) {
      await asUser(ana, `update expenses set ${col} = $1 where id = $2`, [value, eid]);
    }
    const rows = await audit();
    expect(rows).toHaveLength(1 + edits.length);
    expect(rows.slice(1).every((r) => r.action === "update")).toBe(true);
    expect(rows.at(-1)!.new_data.receipt_path).toBe(`${familyId}/r.jpg`);
  });

  it("an update that changes nothing writes nothing", async () => {
    await asUser(ana, "update expenses set description = description where id = $1", [eid]);
    expect(await audit()).toHaveLength(1);
  });

  it("confirm and dispute by the other member are recorded under their name", async () => {
    await asUser(bruno, "select dispute_expense($1, 'valor errado')", [eid]);
    await asUser(bruno, "select confirm_expense($1)", [eid]);
    const rows = await audit();
    expect(rows.map((r) => [r.action, r.changed_by, r.new_data.status])).toEqual([
      ["insert", ana, "pending"],
      ["update", bruno, "disputed"],
      ["update", bruno, "confirmed"],
    ]);
    expect(rows[1].new_data.dispute_comment).toBe("valor errado");
  });

  it("a logical deletion is recorded as 'delete' and the row stays", async () => {
    await asUser(ana, "update expenses set deleted_at = now() where id = $1", [eid]);
    const rows = await audit();
    expect(rows.map((r) => r.action)).toEqual(["insert", "delete"]);
    expect(rows[1].old_data!.deleted_at).toBeNull();
    expect(rows[1].new_data.deleted_at).not.toBeNull();
  });

  it("changed_by is the caller, whatever the client sends", async () => {
    await asUser(bruno, "update expenses set description = 'x', created_by = $1 where id = $2", [carla, eid]);
    expect((await audit()).at(-1)!.changed_by).toBe(bruno);
  });

  it("the server clock sets changed_at", async () => {
    const { rows } = await t.db.query<{ ok: boolean }>(
      "select bool_and(changed_at between now() - interval '1 minute' and now() + interval '1 minute') as ok from expense_audit",
    );
    expect(rows[0].ok).toBe(true);
  });
});

describe("the audit table accepts no update and no delete (RNF-03)", () => {
  it("members read their family's audit", async () => {
    for (const u of [ana, bruno]) {
      const { rows } = await asUser(u, "select action from expense_audit where expense_id = $1", [eid]);
      expect(rows).toHaveLength(1);
    }
  });

  it("another family and anon read nothing", async () => {
    expect((await asUser(carla, "select * from expense_audit")).rows).toEqual([]);
    expect(await sqlState(t.as(null, () => t.db.query("select * from expense_audit")))).toBe("42501");
  });

  it("members cannot insert, update or delete audit rows", async () => {
    for (const u of [ana, bruno]) {
      expect(
        await sqlState(asUser(u, "insert into expense_audit (expense_id, family_id, action) values ($1, $2, 'update')", [eid, familyId])),
      ).toBe("42501");
      expect(await sqlState(asUser(u, "update expense_audit set action = 'delete'"))).toBe("42501");
      expect(await sqlState(asUser(u, "delete from expense_audit"))).toBe("42501");
      expect(await sqlState(asUser(u, "truncate expense_audit"))).toBe("42501");
    }
    expect(await audit()).toHaveLength(1);
  });

  it("even roles that bypass RLS and privileges cannot write, change or remove rows", async () => {
    expect(
      await sqlState(
        t.db.query("insert into expense_audit (expense_id, family_id, action, new_data) values ($1, $2, 'update', '{}')", [eid, familyId]),
      ),
    ).toBe("42501");
    expect(await sqlState(t.db.query("update expense_audit set changed_by = null"))).toBe("AU001");
    expect(await sqlState(t.db.query("update expense_audit set new_data = '{}'"))).toBe("AU001");
    expect(await sqlState(t.db.query("delete from expense_audit"))).toBe("AU001");
    expect(await sqlState(t.db.query("truncate expense_audit"))).toBe("AU001");
    const rows = await audit();
    expect(rows).toHaveLength(1);
    expect(rows[0].new_data.description).toBe("Material escolar");
  });

  it("an expense cannot be hard-deleted, so its history cannot be lost that way", async () => {
    expect(await sqlState(t.db.query("delete from expenses where id = $1", [eid]))).toBe("AU001");
    expect((await asUser(ana, "delete from expenses where id = $1", [eid])).affectedRows).toBe(0);
    expect(await audit()).toHaveLength(1);
  });

  it("deleting the whole family still cascades to its expenses and audit", async () => {
    await asUser(ana, "update expenses set description = 'y' where id = $1", [eid]);
    await t.db.query("delete from families where id = $1", [familyId]);
    const { rows } = await t.db.query<{ e: number; a: number }>(
      "select (select count(*) from expenses)::int as e, (select count(*) from expense_audit)::int as a",
    );
    expect(rows[0]).toEqual({ e: 0, a: 0 });
  });

  it("deleting another family leaves this family's audit untouched", async () => {
    const { rows } = await t.db.query<{ family_id: string }>("select family_id from members where user_id = $1", [carla]);
    await t.db.query("delete from families where id = $1", [rows[0].family_id]);
    expect(await audit()).toHaveLength(1);
  });
});

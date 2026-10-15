import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, sqlState, type TestDb } from "@/test/pg";

// T-16 / RF-11: only the other member decides; a dispute needs a comment. Real migrations on PGlite.

let t: TestDb;
let ana: string;
let bruno: string;
let carla: string;
let anaMember: string;
let eid: string;

type Row = { status: string; dispute_comment: string | null; decided_by: string | null };

const confirm = (u: string, id = eid) => t.as(u, () => t.db.query("select confirm_expense($1)", [id]));
const dispute = (u: string, c: string | null, id = eid) =>
  t.as(u, () => t.db.query("select dispute_expense($1, $2)", [id, c]));
const row = async (): Promise<Row> =>
  (await t.db.query<Row>("select status, dispute_comment, decided_by from expenses where id = $1", [eid])).rows[0];

beforeEach(async () => {
  t = await createTestDb();
  ana = await t.createUser("ana@example.com");
  bruno = await t.createUser("bruno@example.com");
  carla = await t.createUser("carla@example.com");
  const familyId = await t.as(ana, async () => {
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
      "insert into expenses (family_id, paid_by, amount_cents, spent_on, description) values ($1, $2, 1000, '2026-10-10', 'x') returning id",
      [familyId, anaMember],
    );
    return r.rows[0].id;
  });
}, 30_000);

describe("confirm / dispute (RF-11)", () => {
  it("the other member confirms", async () => {
    await confirm(bruno);
    const r = await row();
    expect(r.status).toBe("confirmed");
    expect(r.decided_by).toBe(bruno);
  });

  it("the payer cannot confirm or dispute own expense", async () => {
    expect(await sqlState(confirm(ana))).toBe("42501");
    expect(await sqlState(dispute(ana, "x"))).toBe("42501");
    expect((await row()).status).toBe("pending");
  });

  it("a dispute needs a comment", async () => {
    expect(await sqlState(dispute(bruno, "   "))).toBe("22023");
    expect(await sqlState(dispute(bruno, null))).toBe("22023");
    expect(await sqlState(dispute(bruno, "a".repeat(501)))).toBe("22023");
    expect((await row()).status).toBe("pending");
  });

  it("disputes with a trimmed comment", async () => {
    await dispute(bruno, "  valor errado ");
    const r = await row();
    expect(r.status).toBe("disputed");
    expect(r.dispute_comment).toBe("valor errado");
  });

  it("a disputed expense can still be confirmed later; confirmed is final", async () => {
    await dispute(bruno, "valor errado");
    await confirm(bruno);
    expect((await row()).status).toBe("confirmed");
    expect(await sqlState(dispute(bruno, "tarde"))).toBe("55000");
  });

  it("outsiders cannot see or decide it", async () => {
    expect(await sqlState(confirm(carla))).toBe("P0002");
    expect(await sqlState(dispute(carla, "x"))).toBe("P0002");
  });

  it("anon cannot call the functions", async () => {
    expect(await sqlState(t.as(null, () => t.db.query("select confirm_expense($1)", [eid])))).not.toBeNull();
  });

  it("direct UPDATE of status is rejected, even by the other member", async () => {
    for (const u of [ana, bruno]) {
      expect(
        await sqlState(t.as(u, () => t.db.query("update expenses set status = 'confirmed' where id = $1", [eid]))),
      ).toBe("42501");
    }
    expect(
      await sqlState(t.as(bruno, () => t.db.query("update expenses set dispute_comment = 'x' where id = $1", [eid]))),
    ).toBe("42501");
    expect((await row()).status).toBe("pending");
  });

  it("ordinary edits of other columns still work", async () => {
    await t.as(ana, () => t.db.query("update expenses set description = 'y' where id = $1", [eid]));
    const { rows } = await t.db.query<{ description: string }>("select description from expenses where id = $1", [eid]);
    expect(rows[0].description).toBe("y");
  });
});

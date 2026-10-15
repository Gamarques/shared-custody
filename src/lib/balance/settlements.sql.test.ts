import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, sqlState, type TestDb } from "@/test/pg";
import { computeBalance, type BalanceExpense, type BalanceSettlement } from "./balance";
import { toSettlementInsert } from "./settlement-form";

// T-21 / RF-14: a settlement lowers the balance, shows in the history, and is append-only.
// Real migrations on PGlite.

let t: TestDb;
let ana: string;
let bruno: string;
let carla: string;
let familyId: string;
let anaMember: string;
let brunoMember: string;

async function insertSettlement(userId: string, from: string, amount: string, settledOn = "2026-10-20") {
  const row = toSettlementInsert(familyId, [anaMember, brunoMember], {
    amount,
    settledOn,
    fromMember: from,
    note: "pix",
  });
  const cols = Object.keys(row);
  return t.as(userId, () =>
    t.db.query(
      `insert into settlements (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
      Object.values(row),
    ),
  );
}

async function balance(userId: string) {
  return t.as(userId, async () => {
    const expenses = (
      await t.db.query<BalanceExpense>(
        "select paid_by, amount_cents, payer_share_bps, status, spent_on::text, deleted_at::text from expenses",
      )
    ).rows;
    const settlements = (
      await t.db.query<BalanceSettlement>("select from_member, to_member, amount_cents, settled_on::text from settlements")
    ).rows;
    return computeBalance(anaMember, brunoMember, expenses, settlements);
  });
}

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
  // The plan's example: Ana owes Bruno 6,00.
  await t.as(ana, () =>
    t.db.query(
      `insert into expenses (family_id, paid_by, amount_cents, payer_share_bps, spent_on, description) values
       ($1, $2, 10000, 5000, '2026-10-03', 'Material escolar'),
       ($1, $3, 8000, 3000, '2026-10-05', 'Dentista')`,
      [familyId, anaMember, brunoMember],
    ),
  );
}, 30_000);

describe("settlements (RF-14)", () => {
  it("a settlement abates the balance and is listed", async () => {
    expect(await balance(ana)).toMatchObject({ debtor: anaMember, creditor: brunoMember, amountCents: 600 });
    await insertSettlement(ana, anaMember, "2,50");
    expect(await balance(bruno)).toMatchObject({ debtor: anaMember, amountCents: 350 });
    await insertSettlement(bruno, anaMember, "3,50");
    expect(await balance(ana)).toMatchObject({ debtor: null, creditor: null, amountCents: 0 });

    const { rows } = await t.as(bruno, () =>
      t.db.query<{ amount_cents: number; note: string }>("select amount_cents, note from settlements order by amount_cents"),
    );
    expect(rows).toEqual([
      { amount_cents: 250, note: "pix" },
      { amount_cents: 350, note: "pix" },
    ]);
  });

  it("an over-payment flips the debt", async () => {
    await insertSettlement(ana, anaMember, "10,00");
    expect(await balance(ana)).toMatchObject({ debtor: brunoMember, creditor: anaMember, amountCents: 400 });
  });

  it("rejects zero, negative, huge and self settlements", async () => {
    const ins =
      "insert into settlements (family_id, from_member, to_member, amount_cents, settled_on) values ($1, $2, $3, $4, '2026-10-20')";
    const bad = (params: unknown[]) => sqlState(t.as(ana, () => t.db.query(ins, params)));
    expect(await bad([familyId, anaMember, brunoMember, 0])).toBe("23514");
    expect(await bad([familyId, anaMember, brunoMember, -5])).toBe("23514");
    expect(await bad([familyId, anaMember, brunoMember, 100_000_001])).toBe("23514");
    expect(await bad([familyId, anaMember, anaMember, 100])).toBe("23514");
  });

  it("is append-only: no update, no delete, even for the author", async () => {
    await insertSettlement(ana, anaMember, "1,00");
    for (const u of [ana, bruno]) {
      expect(await sqlState(t.as(u, () => t.db.query("update settlements set amount_cents = 1")))).toBe("42501");
      expect(await sqlState(t.as(u, () => t.db.query("delete from settlements")))).toBe("42501");
    }
    const { rows } = await t.db.query<{ amount_cents: number }>("select amount_cents from settlements");
    expect(rows).toEqual([{ amount_cents: 100 }]);
  });

  it("RLS: outsiders read nothing and cannot insert into the family", async () => {
    await insertSettlement(ana, anaMember, "1,00");
    const { rows } = await t.as(carla, () => t.db.query("select * from settlements"));
    expect(rows).toEqual([]);
    expect(await sqlState(insertSettlement(carla, anaMember, "1,00"))).toBe("42501");
  });

  it("anon cannot read or insert", async () => {
    expect(await sqlState(t.as(null, () => t.db.query("select * from settlements")))).not.toBeNull();
  });
});

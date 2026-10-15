import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/test/pg";
import { toExpenseInsert, type ExpenseFormInput } from "@/lib/expenses/expense-form";
import { computeBalance, type BalanceExpense, type BalanceSettlement } from "./balance";

// T-19 / RF-13: the balance computed from rows read under RLS, on in-memory Postgres (PGlite)
// with the real migrations: the "Exemplo de saldo", then a dispute, a deletion and a settlement.

let t: TestDb;
let ana: string;
let bruno: string;
let carla: string;
let familyId: string;
let anaMember: string;
let brunoMember: string;

async function addExpense(userId: string, patch: Partial<ExpenseFormInput>): Promise<string> {
  const row = toExpenseInsert(familyId, {
    amount: "10,00",
    spentOn: "2026-10-10",
    description: "x",
    category: "outros",
    paidBy: anaMember,
    payerPercent: "50",
    ...patch,
  });
  const cols = Object.keys(row);
  return t.as(userId, async () => {
    const { rows } = await t.db.query<{ id: string }>(
      `insert into expenses (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
      Object.values(row),
    );
    return rows[0].id;
  });
}

/** What the balance screen reads: every expense and settlement visible to the user. */
async function load(userId: string): Promise<{ expenses: BalanceExpense[]; settlements: BalanceSettlement[] }> {
  return t.as(userId, async () => ({
    expenses: (
      await t.db.query<BalanceExpense>(
        "select paid_by, amount_cents, payer_share_bps, status, spent_on::text, deleted_at::text from expenses",
      )
    ).rows,
    settlements: (
      await t.db.query<BalanceSettlement>(
        "select from_member, to_member, amount_cents, settled_on::text from settlements",
      )
    ).rows,
  }));
}

async function balanceFor(userId: string) {
  const { expenses, settlements } = await load(userId);
  return computeBalance(anaMember, brunoMember, expenses, settlements, { from: "2026-10-01", to: "2026-11-01" });
}

beforeEach(async () => {
  t = await createTestDb();
  ana = await t.createUser("ana@example.com");
  bruno = await t.createUser("bruno@example.com");
  carla = await t.createUser("carla@example.com");
  familyId = await t.as(ana, async () => (await t.db.query<{ id: string }>("select create_family('Silva', 'Ana', '#2f6f5e') as id")).rows[0].id);
  const token = await t.as(ana, async () => (await t.db.query<{ token: string }>("select token from create_invite(null)")).rows[0].token);
  await t.as(bruno, () => t.db.query("select accept_invite($1, 'Bruno', '#1d4ed8')", [token]));
  await t.as(carla, () => t.db.query("select create_family('Outra', 'Carla', '#a21caf')"));
  const { rows } = await t.db.query<{ id: string; user_id: string }>("select id, user_id from members");
  anaMember = rows.find((r) => r.user_id === ana)!.id;
  brunoMember = rows.find((r) => r.user_id === bruno)!.id;

  await addExpense(ana, { description: "Material escolar", amount: "100,00", paidBy: anaMember, payerPercent: "50" });
  await addExpense(bruno, { description: "Dentista", amount: "80,00", paidBy: brunoMember, payerPercent: "30" });
});

describe("balance from the database (RF-13)", () => {
  it("the example: Ana owes Bruno 6,00, seen the same by both members", async () => {
    for (const user of [ana, bruno]) {
      expect(await balanceFor(user)).toMatchObject({ debtor: anaMember, creditor: brunoMember, amountCents: 6_00 });
    }
  });

  it("a disputed expense moves to the 'em disputa' line", async () => {
    const id = await addExpense(bruno, { description: "Óculos", amount: "45,50", paidBy: brunoMember, payerPercent: "50" });
    await t.as(ana, () => t.db.query("select dispute_expense($1, 'Não combinamos')", [id]));
    const b = await balanceFor(bruno);
    expect(b).toMatchObject({ debtor: anaMember, amountCents: 6_00, expenseCount: 2 });
    expect(b.disputed).toMatchObject({ debtor: anaMember, creditor: brunoMember, amountCents: 22_75, count: 1 });
  });

  it("a logically deleted expense no longer counts", async () => {
    const id = await addExpense(ana, { description: "Duplicada", amount: "30,00", paidBy: anaMember });
    expect(await balanceFor(ana)).toMatchObject({ debtor: brunoMember, amountCents: 9_00 });
    await t.as(ana, () => t.db.query("update expenses set deleted_at = now() where id = $1", [id]));
    expect(await balanceFor(ana)).toMatchObject({ debtor: anaMember, amountCents: 6_00 });
  });

  it("a settlement from Ana to Bruno of 6,00 closes the balance at zero", async () => {
    await t.as(ana, () =>
      t.db.query(
        "insert into settlements (family_id, from_member, to_member, amount_cents, settled_on) values ($1, $2, $3, 600, '2026-10-20')",
        [familyId, anaMember, brunoMember],
      ),
    );
    expect(await balanceFor(bruno)).toMatchObject({ debtor: null, creditor: null, amountCents: 0 });
  });

  it("RLS: a member of another family reads no expense or settlement, so no balance", async () => {
    const rows = await load(carla);
    expect(rows).toEqual({ expenses: [], settlements: [] });
  });
});

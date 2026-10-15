import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/test/pg";
import { toExpenseInsert, type ExpenseFormInput } from "@/lib/expenses/expense-form";
import { computeBalance, type BalanceExpense, type BalanceSettlement } from "./balance";
import { parseBalancePeriod, periodBounds } from "./balance-view";

// T-20 / RF-13: the reads of the balance screen (/saldo) under RLS, on in-memory Postgres
// (PGlite) with the real migrations. Same filters as the page: family, deleted_at is null and
// the [from, to) bounds of the period, on expenses.spent_on and settlements.settled_on.

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

async function addSettlement(userId: string, from: string, to: string, cents: number, on: string) {
  await t.as(userId, () =>
    t.db.query(
      "insert into settlements (family_id, from_member, to_member, amount_cents, settled_on) values ($1, $2, $3, $4, $5)",
      [familyId, from, to, cents, on],
    ),
  );
}

/** The screen for `userId` with the query string `params`, as of October 2026. */
async function screen(userId: string, params: Record<string, string> = {}) {
  const { period } = parseBalancePeriod(params, "2026-10");
  const { from, to } = periodBounds(period);
  const fam = await t.as(userId, async () =>
    (await t.db.query<{ family_id: string }>("select family_id from members where user_id = auth.uid()")).rows[0],
  );
  const bounds = (col: string, first: number) =>
    [from && `${col} >= $${first}`, to && `${col} < $${from ? first + 1 : first}`].filter(Boolean).map((c) => ` and ${c}`).join("");
  const args = [from, to].filter(Boolean);
  return t.as(userId, async () => {
    const expenses = (
      await t.db.query<BalanceExpense>(
        "select paid_by, amount_cents, payer_share_bps, status, spent_on::text from expenses " +
          `where family_id = $1 and deleted_at is null${bounds("spent_on", 2)}`,
        [fam?.family_id ?? null, ...args],
      )
    ).rows;
    const settlements = (
      await t.db.query<BalanceSettlement>(
        "select from_member, to_member, amount_cents, settled_on::text from settlements " +
          `where family_id = $1${bounds("settled_on", 2)}`,
        [fam?.family_id ?? null, ...args],
      )
    ).rows;
    return { expenses, settlements, period: { from, to } };
  });
}

async function balanceSeenBy(userId: string, params: Record<string, string> = {}) {
  const { expenses, settlements, period } = await screen(userId, params);
  return computeBalance(anaMember, brunoMember, expenses, settlements, period);
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

  // October: the plan's example (Ana owes Bruno 6,00). September: Ana paid 40,00 at 50%.
  await addExpense(ana, { description: "Material escolar", amount: "100,00", spentOn: "2026-10-03", paidBy: anaMember, payerPercent: "50" });
  await addExpense(bruno, { description: "Dentista", amount: "80,00", spentOn: "2026-10-31", paidBy: brunoMember, payerPercent: "30" });
  await addExpense(ana, { description: "Sapatos", amount: "40,00", spentOn: "2026-09-30", paidBy: anaMember, payerPercent: "50" });
});

describe("balance screen reads (RF-13, T-20)", () => {
  it("each month shows its own debt, the same for both members", async () => {
    for (const user of [ana, bruno]) {
      expect(await balanceSeenBy(user)).toMatchObject({ debtor: anaMember, creditor: brunoMember, amountCents: 6_00, expenseCount: 2 });
      expect(await balanceSeenBy(user, { mes: "2026-09" })).toMatchObject({ debtor: brunoMember, amountCents: 20_00, expenseCount: 1 });
    }
  });

  it("'todos' nets every month: Bruno owes Ana 14,00", async () => {
    expect(await balanceSeenBy(bruno, { mes: "todos" })).toMatchObject({ debtor: brunoMember, creditor: anaMember, amountCents: 14_00 });
  });

  it("a range includes its last day and excludes the day after", async () => {
    expect(await balanceSeenBy(ana, { de: "2026-09-30", ate: "2026-10-30" })).toMatchObject({ debtor: brunoMember, amountCents: 70_00 });
    expect(await balanceSeenBy(ana, { de: "2026-10-31", ate: "2026-10-31" })).toMatchObject({ debtor: anaMember, amountCents: 56_00 });
  });

  it("disputed expenses go to the 'em disputa' line; deleted ones are not read", async () => {
    const disputed = await addExpense(bruno, { description: "Óculos", amount: "45,50", spentOn: "2026-10-08", paidBy: brunoMember });
    await t.as(ana, () => t.db.query("select dispute_expense($1, 'Não combinamos')", [disputed]));
    const deleted = await addExpense(ana, { description: "Duplicada", amount: "30,00", spentOn: "2026-10-09" });
    await t.as(ana, () => t.db.query("update expenses set deleted_at = now() where id = $1", [deleted]));

    const { expenses } = await screen(bruno);
    expect(expenses).toHaveLength(3);
    const b = computeBalance(anaMember, brunoMember, expenses, [], { from: "2026-10-01", to: "2026-11-01" });
    expect(b).toMatchObject({ debtor: anaMember, amountCents: 6_00, expenseCount: 2 });
    expect(b.disputed).toMatchObject({ debtor: anaMember, creditor: brunoMember, amountCents: 22_75, count: 1 });
  });

  it("only settlements inside the period count", async () => {
    await addSettlement(ana, anaMember, brunoMember, 6_00, "2026-10-20");
    await addSettlement(bruno, brunoMember, anaMember, 20_00, "2026-11-01");
    expect(await balanceSeenBy(bruno)).toMatchObject({ debtor: null, creditor: null, amountCents: 0 });
    expect(await balanceSeenBy(bruno, { mes: "2026-11" })).toMatchObject({ debtor: anaMember, amountCents: 20_00 });
  });

  it("RLS: a member of another family reads nothing of this family, even asking for its id", async () => {
    await addSettlement(ana, anaMember, brunoMember, 6_00, "2026-10-20");
    const own = await screen(carla, { mes: "todos" });
    expect(own.expenses).toEqual([]);
    expect(own.settlements).toEqual([]);
    const probe = await t.as(carla, async () => ({
      expenses: (await t.db.query("select 1 from expenses where family_id = $1", [familyId])).rows,
      settlements: (await t.db.query("select 1 from settlements where family_id = $1", [familyId])).rows,
    }));
    expect(probe).toEqual({ expenses: [], settlements: [] });
  });
});

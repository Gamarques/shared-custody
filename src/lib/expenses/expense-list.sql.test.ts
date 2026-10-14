import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/test/pg";
import { toExpenseInsert, type ExpenseFormInput } from "./expense-form";
import { monthDateRange } from "./expense-list";

// T-15 / RF-10: the list query the screen sends (month range, category, payer, not deleted)
// under RLS, on in-memory Postgres (PGlite) with the real migrations.

let t: TestDb;
let ana: string;
let bruno: string;
let carla: string;
let familyId: string;
let otherFamilyId: string;
let anaMember: string;
let brunoMember: string;
let carlaMember: string;

async function add(userId: string, fid: string, patch: Partial<ExpenseFormInput>) {
  const row = toExpenseInsert(fid, {
    amount: "10,00",
    spentOn: "2026-10-10",
    description: "x",
    category: "outros",
    paidBy: anaMember,
    payerPercent: "50",
    ...patch,
  });
  const cols = Object.keys(row);
  await t.as(userId, () =>
    t.db.query(`insert into expenses (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(row)),
  );
}

type Filter = { month?: string; category?: string; paidBy?: string };

/** Same predicates as src/app/despesas/page.tsx. */
async function list(userId: string, f: Filter = {}): Promise<{ description: string; total: number }> {
  const where = ["deleted_at is null"];
  const args: unknown[] = [];
  if (f.month) {
    const { from, to } = monthDateRange(f.month);
    args.push(from, to);
    where.push(`spent_on >= $${args.length - 1}`, `spent_on < $${args.length}`);
  }
  if (f.category) {
    args.push(f.category);
    where.push(`category = $${args.length}`);
  }
  if (f.paidBy) {
    args.push(f.paidBy);
    where.push(`paid_by = $${args.length}`);
  }
  return t.as(userId, async () => {
    const { rows } = await t.db.query<{ description: string; amount_cents: number }>(
      `select description, amount_cents from expenses where ${where.join(" and ")} order by spent_on desc, created_at desc`,
      args,
    );
    return {
      description: rows.map((r) => r.description).join(","),
      total: rows.reduce((s, r) => s + r.amount_cents, 0),
    };
  });
}

beforeEach(async () => {
  t = await createTestDb();
  ana = await t.createUser("ana@example.com");
  bruno = await t.createUser("bruno@example.com");
  carla = await t.createUser("carla@example.com");
  familyId = await t.as(ana, async () => (await t.db.query<{ id: string }>("select create_family('Silva', 'Ana', '#2f6f5e') as id")).rows[0].id);
  const token = await t.as(ana, async () => (await t.db.query<{ token: string }>("select token from create_invite(null)")).rows[0].token);
  await t.as(bruno, () => t.db.query("select accept_invite($1, 'Bruno', '#1d4ed8')", [token]));
  otherFamilyId = await t.as(carla, async () => (await t.db.query<{ id: string }>("select create_family('Outra', 'Carla', '#a21caf') as id")).rows[0].id);
  const { rows } = await t.db.query<{ id: string; user_id: string }>("select id, user_id from members");
  anaMember = rows.find((r) => r.user_id === ana)!.id;
  brunoMember = rows.find((r) => r.user_id === bruno)!.id;
  carlaMember = rows.find((r) => r.user_id === carla)!.id;

  await add(ana, familyId, { description: "out-saude-ana", amount: "10,50", spentOn: "2026-10-12", category: "saude", paidBy: anaMember });
  await add(bruno, familyId, { description: "out-escola-bruno", amount: "20,00", spentOn: "2026-10-03", category: "escola", paidBy: brunoMember });
  await add(ana, familyId, { description: "set-saude-ana", amount: "5,25", spentOn: "2026-09-30", category: "saude", paidBy: anaMember });
  await add(ana, familyId, { description: "nov-lazer-ana", amount: "7,00", spentOn: "2026-11-01", category: "lazer", paidBy: anaMember });
  await add(carla, otherFamilyId, { description: "outra-familia", amount: "99,00", spentOn: "2026-10-05", paidBy: carlaMember });
}, 30_000);

describe("expense list query (RF-10)", () => {
  it("month filter is [first day, next month's first day)", async () => {
    expect(await list(ana, { month: "2026-10" })).toEqual({ description: "out-saude-ana,out-escola-bruno", total: 3050 });
    expect(await list(ana, { month: "2026-09" })).toEqual({ description: "set-saude-ana", total: 525 });
    expect(await list(ana, { month: "2026-11" })).toEqual({ description: "nov-lazer-ana", total: 700 });
  });

  it("filters by category and by payer, alone or combined", async () => {
    expect(await list(ana, { category: "saude" })).toEqual({ description: "out-saude-ana,set-saude-ana", total: 1575 });
    expect(await list(ana, { month: "2026-10", paidBy: brunoMember })).toEqual({ description: "out-escola-bruno", total: 2000 });
    expect(await list(ana, { month: "2026-10", category: "saude", paidBy: brunoMember })).toEqual({ description: "", total: 0 });
  });

  it("both members see the same list; another family's expenses never appear", async () => {
    expect(await list(bruno)).toEqual(await list(ana));
    expect((await list(ana)).description).not.toContain("outra-familia");
    expect(await list(carla)).toEqual({ description: "outra-familia", total: 9900 });
  });

  it("logically deleted expenses leave the list and the total", async () => {
    await t.db.query("update expenses set deleted_at = now() where description = 'out-saude-ana'");
    expect(await list(ana, { month: "2026-10" })).toEqual({ description: "out-escola-bruno", total: 2000 });
  });
});

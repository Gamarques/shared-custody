import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, sqlState, type TestDb } from "@/test/pg";
import { computeBalance, type BalanceExpense, type BalanceSettlement } from "@/lib/balance/balance";
import { toSettlementInsert } from "@/lib/balance/settlement-form";
import type { CustodyOverride, CustodyRule } from "@/lib/custody/holder";
import { toCustodyOverrideInsert } from "@/lib/custody/override-form";
import { toCustodyRuleInsert } from "@/lib/custody/rule-form";
import { buildTodayView, type HomeMember } from "@/lib/custody/today";
import { expensesToCsv } from "@/lib/expenses/expense-csv";
import { toExpenseInsert, toExpenseUpdate } from "@/lib/expenses/expense-form";
import { buildHistory, type AuditRow } from "@/lib/expenses/expense-history";

// T-24: the whole MVP journey of two guardians, in order, on one database with every migration
// applied. Each step goes through the same helpers the screens use (form -> row) and the same
// SQL functions the client calls (create_family, accept_invite, confirm_expense, ...), as the
// signed-in user who would perform it. A user of another family watches every step and must
// never see or change anything. What this cannot cover (real PostgREST/GoTrue, browsers,
// devices) is in docs/qa-e2e.md and docs/MANUAL-STEPS.md (T-24).

const TZ = "Europe/Lisbon";
// Wednesday 2026-10-14, 10:00 in Lisbon.
const NOW = new Date("2026-10-14T09:00:00Z");

let t: TestDb;
let ana: string;
let bruno: string;
let carla: string;
let dario: string;
let familyId: string;
let anaMember: string;
let brunoMember: string;

type Row = Record<string, unknown>;

/** `insert into table (...) values (...) returning *` for a row built by a form helper. */
async function insert(table: string, row: Row): Promise<Row> {
  const cols = Object.keys(row);
  const params = cols.map((c) => row[c]);
  const sql = `insert into ${table} (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning *`;
  return (await t.db.query<Row>(sql, params)).rows[0];
}

async function update(table: string, id: string, row: Row): Promise<number> {
  const cols = Object.keys(row);
  const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(", ");
  const res = await t.db.query(`update ${table} set ${sets} where id = $1`, [id, ...cols.map((c) => row[c])]);
  return res.affectedRows ?? 0;
}

async function rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await t.db.query<T>(sql, params)).rows;
}

/** The home's reads (HOME_SELECT in src/app/page.tsx) for the signed-in user, as one view. */
async function homeView(userId: string) {
  return t.as(userId, async () => {
    const me = `(select family_id from members where user_id = auth.uid())`;
    const [family] = await rows<{ timezone: string }>(`select timezone from families where id = ${me}`);
    if (!family) return null;
    const members = await rows<HomeMember>(`select id, display_name, color from members where family_id = ${me} order by created_at`);
    const rules = await rows<CustodyRule>(
      `select id, starts_on::text, first_member_id, handover_weekday, handover_time::text, valid_from::text,
              valid_to::text, to_json(created_at) #>> '{}' as created_at
       from custody_rules where family_id = ${me}`,
    );
    const overrides = await rows<CustodyOverride>(
      `select id, to_json(starts_at) #>> '{}' as starts_at, to_json(ends_at) #>> '{}' as ends_at, member_id, reason,
              to_json(created_at) #>> '{}' as created_at
       from custody_overrides where family_id = ${me} and ends_at > $1`,
      [NOW.toISOString()],
    );
    const [child] = await rows<{ name: string }>(`select name from children where family_id = ${me} order by created_at limit 1`);
    return buildTodayView({ now: NOW, timezone: family.timezone, members, rules, overrides, childName: child?.name ?? null });
  });
}

/** The balance screen's reads (/saldo, whole period) for the signed-in user. */
async function balanceOf(userId: string) {
  return t.as(userId, async () => {
    const expenses = await rows<BalanceExpense>(
      `select paid_by, amount_cents, payer_share_bps, status, spent_on::text, deleted_at::text
       from expenses where deleted_at is null`,
    );
    const settlements = await rows<BalanceSettlement>(
      "select from_member, to_member, amount_cents, settled_on::text from settlements",
    );
    return computeBalance(anaMember, brunoMember, expenses, settlements);
  });
}

/** How many rows of the family the outsider can see, over every table. */
async function outsiderSees(): Promise<number> {
  return t.as(carla, async () => {
    let total = 0;
    for (const table of ["families", "members", "invites", "children", "custody_rules", "custody_overrides", "expenses", "settlements", "expense_audit"]) {
      const col = table === "families" ? "id" : "family_id";
      total += (await rows<{ n: number }>(`select count(*)::int as n from ${table} where ${col} = $1`, [familyId]))[0].n;
    }
    return total;
  });
}

beforeAll(async () => {
  t = await createTestDb();
  ana = await t.createUser("ana@example.com");
  bruno = await t.createUser("bruno@example.com");
  carla = await t.createUser("carla@example.com");
  dario = await t.createUser("dario@example.com");
  // Carla has her own family the whole time.
  await t.as(carla, () => t.db.query("select create_family('Outra', 'Carla', '#7c3aed')"));
});

describe("end-to-end journey of two guardians (T-24)", () => {
  it("1. Ana signs in, creates the family (RF-02, RF-03)", async () => {
    familyId = await t.as(ana, async () => {
      const [r] = await rows<{ id: string }>("select create_family('Família Silva', 'Ana', '#2f6f5e') as id");
      return r.id;
    });
    expect(familyId).toBeTruthy();
    expect(await homeView(ana)).toMatchObject({ kind: "no-rule", childName: "A criança" });
    expect(await outsiderSees()).toBe(0);
  });

  it("2. Ana invites Bruno; Bruno joins; a third person cannot (RF-02)", async () => {
    const token = await t.as(ana, async () => {
      const [r] = await rows<{ token: string }>("select token from create_invite('bruno@example.com')");
      return r.token;
    });
    const preview = await t.as(bruno, () => rows<{ status: string; taken_colors: string[] }>("select * from get_invite($1)", [token]));
    expect(preview[0]).toMatchObject({ status: "valid", taken_colors: ["#2f6f5e"] });

    await t.as(bruno, () => t.db.query("select accept_invite($1, 'Bruno', '#fde047')", [token]));
    const members = await t.as(ana, () => rows<{ id: string; display_name: string; role: string }>("select id, display_name, role from members order by created_at"));
    expect(members.map((m) => [m.display_name, m.role])).toEqual([["Ana", "owner"], ["Bruno", "member"]]);
    anaMember = members[0].id;
    brunoMember = members[1].id;

    expect(await t.as(dario, () => sqlState(t.db.query("select accept_invite($1, 'Dario', '#000000')", [token])))).toBe("IV002");
    expect(await t.as(ana, () => sqlState(t.db.query("select create_invite(null)")))).toBe("IV005");
    expect(await outsiderSees()).toBe(0);
  });

  it("3. the child's name and the custody rule (RF-03, RF-04)", async () => {
    await t.as(ana, () => insert("children", { family_id: familyId, name: "Lia" }));
    await t.as(ana, () =>
      insert(
        "custody_rules",
        // First handover Sunday 2026-09-06 at 18:00, with Ana.
        toCustodyRuleInsert(familyId, { firstMemberId: anaMember, startsOn: "2026-09-06", handoverWeekday: 0, handoverTime: "18:00", validFrom: null }),
      ),
    );
    // Five whole weeks since the first handover on 2026-10-11 18:00: odd index, Bruno.
    const view = await homeView(bruno);
    expect(view).toMatchObject({
      kind: "schedule",
      childName: "Lia",
      current: { name: "Bruno", reason: null },
      next: { atMs: Date.parse("2026-10-18T17:00:00Z"), to: { name: "Ana" } },
    });
    expect(await outsiderSees()).toBe(0);
  });

  it("4. an exception overrides the rule on the home (RF-05, RF-07)", async () => {
    await t.as(bruno, () =>
      insert(
        "custody_overrides",
        toCustodyOverrideInsert(
          familyId,
          { memberId: anaMember, startDate: "2026-10-13", startTime: "00:00", endDate: "2026-10-16", endTime: "00:00", reason: "Férias" },
          TZ,
        ),
      ),
    );
    for (const user of [ana, bruno]) {
      expect(await homeView(user)).toMatchObject({
        current: { name: "Ana", reason: "Férias" },
        next: { atMs: Date.parse("2026-10-15T23:00:00Z"), to: { name: "Bruno" } },
      });
    }
    // The outsider cannot add one to this family either.
    const forged = toCustodyOverrideInsert(
      familyId,
      { memberId: anaMember, startDate: "2026-10-20", startTime: "00:00", endDate: "2026-10-21", endTime: "00:00", reason: "x" },
      TZ,
    );
    expect(await t.as(carla, () => sqlState(insert("custody_overrides", forged)))).toBe("42501");
  });

  let anaSchool: string;
  let brunoDentist: string;
  let brunoShoes: string;
  let anaMistake: string;

  it("5. both record expenses with a share per expense (RF-08, RF-09)", async () => {
    const form = (amount: string, description: string, category: string, paidBy: string, payerPercent: string, spentOn: string) => ({
      amount, description, category, paidBy, payerPercent, spentOn,
    });
    anaSchool = (await t.as(ana, () => insert("expenses", toExpenseInsert(familyId, form("100,00", "Material escolar", "escola", anaMember, "50", "2026-10-01"))))).id as string;
    brunoDentist = (await t.as(bruno, () => insert("expenses", toExpenseInsert(familyId, form("80,00", "Dentista", "saude", brunoMember, "30", "2026-10-02"))))).id as string;
    brunoShoes = (await t.as(bruno, () => insert("expenses", toExpenseInsert(familyId, form("45,50", "Ténis de São João", "vestuario", brunoMember, "50", "2026-10-03"))))).id as string;
    anaMistake = (await t.as(ana, () => insert("expenses", toExpenseInsert(familyId, form("9,99", "Duplicada", "outros", anaMember, "50", "2026-10-04"))))).id as string;

    const saved = await t.as(ana, () => rows<{ amount_cents: number; payer_share_bps: number; status: string }>(
      "select amount_cents, payer_share_bps, status from expenses where id = $1", [anaSchool],
    ));
    expect(saved[0]).toEqual({ amount_cents: 10_000, payer_share_bps: 5000, status: "pending" });
    expect(await outsiderSees()).toBe(0);
  });

  it("6. the other guardian confirms or disputes; the payer cannot decide (RF-11)", async () => {
    expect(await t.as(ana, () => sqlState(t.db.query("select confirm_expense($1)", [anaSchool])))).not.toBeNull();
    await t.as(bruno, () => t.db.query("select confirm_expense($1)", [anaSchool]));
    await t.as(ana, () => t.db.query("select confirm_expense($1)", [brunoDentist]));
    expect(await t.as(ana, () => sqlState(t.db.query("select dispute_expense($1, '')", [brunoShoes])))).not.toBeNull();
    await t.as(ana, () => t.db.query("select dispute_expense($1, 'Não combinámos')", [brunoShoes]));
    expect(await t.as(carla, () => sqlState(t.db.query("select confirm_expense($1)", [anaMistake])))).not.toBeNull();

    const status = await t.as(bruno, () => rows<{ description: string; status: string }>(
      "select description, status from expenses order by spent_on",
    ));
    expect(status.map((s) => s.status)).toEqual(["confirmed", "confirmed", "disputed", "pending"]);
  });

  it("7. editing a confirmed expense sends it back to pending; deleting is logical (RF-17, rule 5)", async () => {
    expect(
      await t.as(ana, () =>
        update("expenses", anaSchool, toExpenseUpdate({
          amount: "100,00", description: "Material escolar (cadernos)", category: "escola", paidBy: anaMember, payerPercent: "50", spentOn: "2026-10-01",
        })),
      ),
    ).toBe(1);
    await t.as(ana, () => update("expenses", anaMistake, { deleted_at: new Date().toISOString() }));

    const [edited] = await t.as(bruno, () => rows<{ status: string }>("select status from expenses where id = $1", [anaSchool]));
    expect(edited.status).toBe("pending");
    const listed = await t.as(bruno, () => rows<{ id: string }>("select id from expenses where deleted_at is null"));
    expect(listed.map((r) => r.id)).not.toContain(anaMistake);
    // Hard delete is impossible for members.
    expect(await t.as(ana, async () => (await t.db.query("delete from expenses where id = $1", [anaSchool])).affectedRows ?? 0)).toBe(0);
  });

  it("8. every change is in the immutable audit (RF-12, RNF-03)", async () => {
    // Same read as /despesas/<id>/historico: newest first.
    const audit = await t.as(bruno, () => rows<AuditRow>(
      `select seq::int, action, changed_by, to_json(changed_at) #>> '{}' as changed_at, old_data, new_data
       from expense_audit where expense_id = $1 order by seq desc`,
      [anaSchool],
    ));
    expect(audit.map((a) => a.action)).toEqual(["update", "update", "insert"]);
    const history = buildHistory(audit, {
      timeZone: TZ,
      currency: "EUR",
      memberNames: { [anaMember]: "Ana", [brunoMember]: "Bruno" },
      userNames: { [ana]: "Ana", [bruno]: "Bruno" },
    });
    expect(history.map((h) => [h.title, h.who])).toEqual([
      ["Alterou a despesa", "Ana"],
      ["Confirmou a despesa", "Bruno"],
      ["Criou a despesa", "Ana"],
    ]);

    const deleted = await t.as(ana, () => rows<{ action: string }>(
      "select action from expense_audit where expense_id = $1 order by changed_at, seq", [anaMistake],
    ));
    expect(deleted.map((a) => a.action)).toEqual(["insert", "delete"]);
    expect(await t.as(ana, () => sqlState(t.db.query("update expense_audit set action = 'insert'")))).not.toBeNull();
    expect(await t.as(ana, () => sqlState(t.db.query("delete from expense_audit")))).not.toBeNull();
  });

  it("9. the balance matches the plan's example, with the disputed line apart (RF-13)", async () => {
    for (const user of [ana, bruno]) {
      const b = await balanceOf(user);
      expect(b).toMatchObject({ debtor: anaMember, creditor: brunoMember, amountCents: 600, expenseCount: 2 });
      expect(b.disputed).toMatchObject({ debtor: anaMember, amountCents: 2275, count: 1 });
    }
  });

  it("10. a settlement brings the balance to zero (RF-14)", async () => {
    await t.as(ana, () =>
      insert("settlements", toSettlementInsert(familyId, [anaMember, brunoMember], { amount: "6,00", settledOn: "2026-10-05", fromMember: anaMember, note: "Transferência" })),
    );
    expect(await balanceOf(bruno)).toMatchObject({ debtor: null, amountCents: 0, netCents: 0 });
    expect(await t.as(ana, () => sqlState(t.db.query("update settlements set amount_cents = 1")))).not.toBeNull();
  });

  it("11. the month's CSV has every live expense with accents (RF-15)", async () => {
    const list = await t.as(ana, () => rows<Row>(
      `select spent_on::text, description, category, paid_by, amount_cents, payer_share_bps, status
       from expenses where deleted_at is null and spent_on >= '2026-10-01' and spent_on < '2026-11-01' order by spent_on`,
    ));
    const csv = expensesToCsv(list as never, { [anaMember]: "Ana", [brunoMember]: "Bruno" });
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("Ténis de São João");
    expect(csv).not.toContain("Duplicada");
    expect(csv.trim().split(/\r?\n/)).toHaveLength(1 + 3);
  });

  it("12. the outsider saw nothing and changed nothing during the whole journey (RNF-01)", async () => {
    expect(await outsiderSees()).toBe(0);
    expect(await t.as(carla, async () => (await t.db.query("update expenses set description = 'x' where family_id = $1", [familyId])).affectedRows ?? 0)).toBe(0);
    expect(await t.as(null, () => sqlState(t.db.query("select * from expenses")))).not.toBeNull();
  });
});

import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, sqlState, type TestDb } from "@/test/pg";

// Platform admin (20261103000100_app_admins.sql), on the real migrations in PGlite.
// Family 1 = Ana + Bruno, family 2 = Carla + Davi (fully used: expenses with audit, settlement,
// rule, override, invite, receipt), Eva has no family, Root is the admin and has no family.

let t: TestDb;
let ana: string, bruno: string, carla: string, davi: string, eva: string, root: string;
let f1: string, f2: string;
let anaMember: string, brunoMember: string;

const ADMIN_CALLS: Array<[string, () => unknown[]]> = [
  ["admin_list_families", () => []],
  ["admin_list_users", () => []],
  ["admin_remove_member", () => [f1, bruno]],
  ["admin_delete_family", () => [f1]],
];

function callSql(fn: string, argCount: number): string {
  const params = Array.from({ length: argCount }, (_, i) => `$${i + 1}`).join(", ");
  return `select * from ${fn}(${params})`;
}

async function asUser<T = Record<string, unknown>>(userId: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  return t.as(userId, async () => (await t.db.query<T>(sql, params)).rows);
}

async function familyOf(userId: string): Promise<string> {
  const { rows } = await t.db.query<{ family_id: string }>("select family_id from members where user_id = $1", [userId]);
  return rows[0].family_id;
}

async function memberId(userId: string): Promise<string> {
  const { rows } = await t.db.query<{ id: string }>("select id from members where user_id = $1", [userId]);
  return rows[0].id;
}

async function createFamily(name: string, owner: string, other: string): Promise<string> {
  await asUser(owner, "select create_family($1, 'Owner', '#2f6f5e')", [name]);
  const [{ token }] = await asUser<{ token: string }>(owner, "select token from create_invite(null)");
  await asUser(other, "select accept_invite($1, 'Other', '#1d4ed8')", [token]);
  return familyOf(owner);
}

/** Row counts of everything that belongs to a family, read as the table owner (no RLS). */
async function familyCounts(familyId: string): Promise<Record<string, number>> {
  const tables = ["members", "invites", "children", "custody_rules", "custody_overrides", "expenses", "settlements", "expense_audit"];
  const out: Record<string, number> = {};
  const { rows } = await t.db.query<{ n: number }>("select count(*)::int as n from families where id = $1", [familyId]);
  out.families = rows[0].n;
  for (const table of tables) {
    const r = await t.db.query<{ n: number }>(`select count(*)::int as n from ${table} where family_id = $1`, [familyId]);
    out[table] = r.rows[0].n;
  }
  const objects = await t.db.query<{ n: number }>(
    "select count(*)::int as n from storage.objects where bucket_id = 'receipts' and name like $1 || '/%'",
    [familyId],
  );
  out.receipts = objects.rows[0].n;
  return out;
}

/** Every row of family f, as the table owner, to compare before and after. */
async function snapshot(familyId: string): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const [table, col] of [
    ["families", "id"],
    ["members", "family_id"],
    ["custody_rules", "family_id"],
    ["custody_overrides", "family_id"],
    ["expenses", "family_id"],
    ["settlements", "family_id"],
    ["expense_audit", "family_id"],
  ]) {
    const { rows } = await t.db.query(`select to_jsonb(x) as row from ${table} x where ${col} = $1 order by id`, [familyId]);
    out.push(table, rows);
  }
  return out;
}

beforeAll(async () => {
  t = await createTestDb();
  [ana, bruno, carla, davi, eva, root] = await Promise.all(
    ["ana@example.com", "bruno@example.com", "carla@example.com", "davi@example.com", "eva@example.com", "root@example.com"].map(
      (e) => t.createUser(e),
    ),
  );
  // Seeding the owner is a manual step in production (docs/MANUAL-STEPS.md); here as the table owner.
  await t.db.query("insert into app_admins (user_id) values ($1)", [root]);

  f1 = await createFamily("Família Um", ana, bruno);
  anaMember = await memberId(ana);
  brunoMember = await memberId(bruno);
  // Family 1: one expense paid by Ana, an override for Bruno and a pending invite Bruno created.
  await asUser(
    ana,
    `insert into expenses (family_id, paid_by, amount_cents, spent_on, description) values ($1, $2, 1000, '2026-10-10', 'Livros')`,
    [f1, anaMember],
  );
  await asUser(
    ana,
    `insert into custody_rules (family_id, starts_on, first_member_id, handover_weekday, handover_time, valid_from)
     values ($1, '2026-10-04', $2, 0, '18:00', '2026-10-04')`,
    [f1, anaMember],
  );
  await asUser(
    bruno,
    `insert into custody_overrides (family_id, starts_at, ends_at, member_id, reason)
     values ($1, '2026-12-24 10:00+00', '2026-12-26 10:00+00', $2, 'Natal')`,
    [f1, brunoMember],
  );
  await t.db.query("insert into invites (family_id, created_by) values ($1, $2)", [f1, bruno]);

  // Family 2: everything an append-only table can hold.
  f2 = await createFamily("Família Dois", carla, davi);
  const carlaMember = await memberId(carla);
  const daviMember = await memberId(davi);
  await asUser(carla, "insert into children (family_id, name) values ($1, 'Kid')", [f2]);
  await asUser(
    carla,
    `insert into custody_rules (family_id, starts_on, first_member_id, handover_weekday, handover_time, valid_from)
     values ($1, '2026-10-04', $2, 0, '18:00', '2026-10-04')`,
    [f2, carlaMember],
  );
  await asUser(
    davi,
    `insert into custody_overrides (family_id, starts_at, ends_at, member_id, reason)
     values ($1, '2026-12-24 10:00+00', '2026-12-26 10:00+00', $2, 'Natal')`,
    [f2, daviMember],
  );
  const [{ id: e1 }] = await asUser<{ id: string }>(
    carla,
    `insert into expenses (family_id, paid_by, amount_cents, spent_on, description, receipt_path)
     values ($1, $2, 10000, '2026-10-10', 'Material', $3) returning id`,
    [f2, carlaMember, `${f2}/r1.jpg`],
  );
  await asUser(davi, "select confirm_expense($1)", [e1]);
  await asUser(carla, "update expenses set amount_cents = 12000 where id = $1", [e1]);
  const [{ id: e2 }] = await asUser<{ id: string }>(
    davi,
    `insert into expenses (family_id, paid_by, amount_cents, spent_on, description) values ($1, $2, 500, '2026-10-11', 'Erro') returning id`,
    [f2, daviMember],
  );
  await asUser(davi, "update expenses set deleted_at = now() where id = $1", [e2]);
  await asUser(
    davi,
    `insert into settlements (family_id, from_member, to_member, amount_cents, settled_on) values ($1, $2, $3, 600, '2026-10-12')`,
    [f2, daviMember, carlaMember],
  );
  await t.db.query("insert into invites (family_id, created_by) values ($1, $2)", [f2, carla]);
  await asUser(carla, "insert into storage.objects (bucket_id, name) values ('receipts', $1)", [`${f2}/r1.jpg`]);
}, 60_000);

describe("who is an admin", () => {
  it("is_app_admin() is true only for the admin", async () => {
    for (const [user, expected] of [
      [root, true],
      [ana, false],
      [eva, false],
    ] as const) {
      const [{ ok }] = await asUser<{ ok: boolean }>(user, "select is_app_admin() as ok");
      expect({ user, ok }).toEqual({ user, ok: expected });
    }
  });

  it("anon cannot even ask", async () => {
    expect(await sqlState(asUser(null, "select is_app_admin()"))).toBe("42501");
  });

  it("app_admins is unreachable for clients, admins included", async () => {
    for (const user of [ana, eva, root]) {
      expect(await sqlState(asUser(user, "select * from app_admins"))).toBe("42501");
      expect(await sqlState(asUser(user, "insert into app_admins (user_id) values ($1)", [user]))).toBe("42501");
      expect(await sqlState(asUser(user, "delete from app_admins"))).toBe("42501");
    }
    expect(await sqlState(asUser(null, "select * from app_admins"))).toBe("42501");
    const { rows } = await t.db.query<{ n: number }>("select count(*)::int as n from app_admins");
    expect(rows[0].n).toBe(1);
  });
});

describe("non-admins are refused", () => {
  it.each(ADMIN_CALLS)("%s: 42501 for a member, a user without a family and anon", async (fn, args) => {
    for (const user of [ana, carla, eva, null]) {
      const state = await sqlState(asUser(user, callSql(fn, args().length), args()));
      expect({ fn, user, state }).toEqual({ fn, user, state: "42501" });
    }
  });

  it("admin_actions reads empty and cannot be written", async () => {
    // Make sure there is something to hide.
    await asUser(root, "select admin_list_families()");
    for (const user of [ana, eva]) {
      expect(await asUser(user, "select * from admin_actions")).toEqual([]);
      expect(
        await sqlState(asUser(user, "insert into admin_actions (admin_id, action, target) values ($1, 'delete_family', '{}')", [user])),
      ).toBe("42501");
    }
    expect(await sqlState(asUser(null, "select * from admin_actions"))).toBe("42501");
    expect(await sqlState(asUser(root, "update admin_actions set action = 'delete_family'"))).toBe("42501");
    expect(await sqlState(asUser(root, "delete from admin_actions"))).toBe("42501");
  });

  it("nothing changed in either family", async () => {
    expect((await familyCounts(f1)).members).toBe(2);
    expect((await familyCounts(f2)).families).toBe(1);
  });
});

describe("admin reads across families", () => {
  it("admin_list_families returns every family with members and counters", async () => {
    const rows = await asUser<{
      id: string;
      name: string;
      currency: string;
      timezone: string;
      members: { email: string; display_name: string; color: string; role: string }[];
      children_count: number;
      expenses_count: number;
      open_expenses_count: number;
      last_activity_at: string;
    }>(root, "select * from admin_list_families()");
    expect(rows.map((r) => r.name).sort()).toEqual(["Família Dois", "Família Um"]);
    const two = rows.find((r) => r.id === f2)!;
    expect(two.currency).toBe("EUR");
    expect(two.timezone).toBe("Europe/Lisbon");
    expect(two.members.map((m) => [m.email, m.display_name, m.color, m.role])).toEqual([
      ["carla@example.com", "Owner", "#2f6f5e", "owner"],
      ["davi@example.com", "Other", "#1d4ed8", "member"],
    ]);
    // Deleted expense not counted; the edited one is pending again.
    expect([two.children_count, two.expenses_count, two.open_expenses_count]).toEqual([1, 1, 1]);
    expect(two.last_activity_at).not.toBeNull();
  });

  it("admin_list_users returns every auth user, with or without a family", async () => {
    const rows = await asUser<{ email: string; is_admin: boolean; families: { id: string; name: string }[]; created_at: string }>(
      root,
      "select * from admin_list_users()",
    );
    const byEmail = Object.fromEntries(rows.map((r) => [r.email, r]));
    expect(Object.keys(byEmail).sort()).toEqual(
      ["ana", "bruno", "carla", "davi", "eva", "root"].map((n) => `${n}@example.com`),
    );
    expect(byEmail["root@example.com"].is_admin).toBe(true);
    expect(byEmail["ana@example.com"].is_admin).toBe(false);
    expect(byEmail["ana@example.com"].families).toEqual([{ id: f1, name: "Família Um" }]);
    expect(byEmail["davi@example.com"].families).toEqual([{ id: f2, name: "Família Dois" }]);
    expect(byEmail["eva@example.com"].families).toEqual([]);
    expect(byEmail["eva@example.com"].created_at).not.toBeNull();
  });
});

describe("admin_remove_member", () => {
  it("refuses a member referenced by expenses or settlements (AD001) and unknown targets (P0002)", async () => {
    expect(await sqlState(asUser(root, "select admin_remove_member($1, $2)", [f1, ana]))).toBe("AD001");
    expect(await sqlState(asUser(root, "select admin_remove_member($1, $2)", [f2, davi]))).toBe("AD001");
    expect(await sqlState(asUser(root, "select admin_remove_member($1, $2)", [f1, carla]))).toBe("P0002");
    expect(await sqlState(asUser(root, "select admin_remove_member($1, $2)", [crypto.randomUUID(), bruno]))).toBe("P0002");
  });

  it("removes the membership, its overrides and its pending invites, and logs it", async () => {
    await asUser(root, "select admin_remove_member($1, $2)", [f1, bruno]);
    const counts = await familyCounts(f1);
    expect(counts).toMatchObject({ families: 1, members: 1, custody_overrides: 0, expenses: 1, custody_rules: 1 });
    const { rows: invites } = await t.db.query("select * from invites where family_id = $1 and created_by = $2 and accepted_at is null", [
      f1,
      bruno,
    ]);
    expect(invites).toEqual([]);
    // The auth user stays and can start over.
    const [{ n }] = await asUser<{ n: number }>(root, "select count(*)::int as n from admin_list_users() where email = 'bruno@example.com'");
    expect(n).toBe(1);
    const log = await asUser<{ admin_id: string; action: string; target: Record<string, string> }>(
      root,
      "select admin_id, action, target from admin_actions where action = 'remove_member'",
    );
    expect(log).toHaveLength(1);
    expect(log[0].admin_id).toBe(root);
    expect(log[0].target).toMatchObject({ family_id: f1, user_id: bruno, email: "bruno@example.com", family_name: "Família Um" });
  });
});

describe("admin_delete_family", () => {
  it("only admins see and remove receipt files of another family", async () => {
    const path = `${f2}/r1.jpg`;
    expect(await asUser(ana, "select name from storage.objects where bucket_id = 'receipts'")).toEqual([]);
    const del = await t.as(ana, () => t.db.query("delete from storage.objects where bucket_id = 'receipts'"));
    expect(del.affectedRows).toBe(0);
    expect(await asUser(root, "select name from storage.objects where bucket_id = 'receipts'")).toEqual([{ name: path }]);
    // Admins get no upload right.
    expect(
      await sqlState(asUser(root, "insert into storage.objects (bucket_id, name) values ('receipts', $1)", [`${f2}/x.jpg`])),
    ).toBe("42501");
  });

  it("deletes a family with expenses, audit rows, settlements, rule, overrides and invites", async () => {
    const before = await familyCounts(f2);
    expect(before).toMatchObject({ families: 1, members: 2, invites: 2, children: 1, custody_rules: 1, custody_overrides: 1, settlements: 1 });
    expect(before.expenses).toBe(2);
    expect(before.expense_audit).toBeGreaterThanOrEqual(4);
    const f1Before = await snapshot(f1);

    await asUser(root, "select admin_delete_family($1)", [f2]);

    // Every table is empty for that family. The receipt file is left for the app, which removes
    // it through the Storage API as the admin (a SQL delete would orphan the stored file).
    expect(await familyCounts(f2)).toEqual({
      families: 0, members: 0, invites: 0, children: 0, custody_rules: 0, custody_overrides: 0,
      expenses: 0, settlements: 0, expense_audit: 0, receipts: 1,
    });
    const removed = await t.as(root, () => t.db.query("delete from storage.objects where bucket_id = 'receipts' and name like $1 || '/%'", [f2]));
    expect(removed.affectedRows).toBe(1);

    expect(await snapshot(f1)).toEqual(f1Before);
    const log = await asUser<{ target: { family_name: string; members: unknown[]; expenses: number } }>(
      root,
      "select target from admin_actions where action = 'delete_family'",
    );
    expect(log).toHaveLength(1);
    expect(log[0].target).toMatchObject({ family_name: "Família Dois", expenses: 2 });
    expect(log[0].target.members).toHaveLength(2);
    // Its former members have no family any more; their auth users remain.
    expect(await asUser(carla, "select * from members")).toEqual([]);
    expect(await sqlState(asUser(root, "select admin_delete_family($1)", [f2]))).toBe("P0002");
  });

  it("afterwards, normal users still cannot delete or rewrite append-only rows, even with a forged bypass setting", async () => {
    const before = await snapshot(f1);
    const attempts = [
      "delete from families",
      "delete from expenses",
      "delete from settlements",
      "delete from custody_rules",
      "delete from expense_audit",
      "update settlements set amount_cents = 1",
      "update custody_rules set handover_time = '09:00'",
      "update expense_audit set action = 'delete'",
      "update expenses set status = 'confirmed'",
    ];
    // Ana in her own family, Carla (former member of the deleted family) and Eva from outside.
    for (const user of [ana, carla, eva]) {
      await t.as(user, async () => {
        for (const guc of ["shared_custody.admin_bypass", "app.admin_bypass"]) {
          await t.db.query("select set_config($1, 'on', false)", [guc]);
        }
        try {
          for (const sql of attempts) {
            const state = await sqlState(
              t.db.query(sql).then((r) => {
                if ((r.affectedRows ?? 0) > 0) throw Object.assign(new Error(`${sql} changed rows`), { code: "CHANGED" });
              }),
            );
            expect({ user, sql, state }).not.toEqual({ user, sql, state: "CHANGED" });
          }
          for (const [fn, args] of ADMIN_CALLS) {
            expect({ user, fn, state: await sqlState(t.db.query(callSql(fn, args().length), args())) }).toEqual({ user, fn, state: "42501" });
          }
        } finally {
          for (const guc of ["shared_custody.admin_bypass", "app.admin_bypass"]) {
            await t.db.query("select set_config($1, '', false)", [guc]);
          }
        }
      });
    }
    expect(await snapshot(f1)).toEqual(before);
    expect((await familyCounts(f1)).families).toBe(1);
  });
});

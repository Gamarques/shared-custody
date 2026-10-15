import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, sqlState, type TestDb } from "@/test/pg";

// RNF-01 / T-05: a user of another family neither reads nor writes any row.
// Runs the real migrations on an in-memory Postgres (PGlite) with a Supabase auth stub.
// Family 1 = Ana + Bruno, family 2 = Carla + Davi, Eva has no family.

/** Every table in the public schema and the column that holds its family id. */
const TABLES: Record<string, string> = {
  families: "id",
  members: "family_id",
  invites: "family_id",
  children: "family_id",
  custody_rules: "family_id",
  custody_overrides: "family_id",
  expenses: "family_id",
  settlements: "family_id",
  expense_audit: "family_id",
};

type Family = { id: string; owner: string; other: string; ownerMember: string; otherMember: string; expense: string };

let t: TestDb;
let f1: Family;
let f2: Family;
let eva: string;

async function one<T>(userId: string, sql: string, params: unknown[] = []): Promise<T> {
  return t.as(userId, async () => (await t.db.query<T>(sql, params)).rows[0]);
}

/** Creates a family of two through the real onboarding and invite functions. */
async function createFamily(name: string, owner: string, other: string): Promise<Omit<Family, "expense">> {
  const { id } = await one<{ id: string }>(owner, "select create_family($1, 'Owner', '#2f6f5e') as id", [name]);
  const { token } = await one<{ token: string }>(owner, "select token from create_invite(null)");
  await one(other, "select accept_invite($1, 'Other', '#1d4ed8')", [token]);
  const member = async (uid: string) =>
    (await one<{ id: string }>(owner, "select id from members where user_id = $1", [uid])).id;
  return { id, owner, other, ownerMember: await member(owner), otherMember: await member(other) };
}

/** One row in each family-owned table, written by the family's own members under RLS. */
async function seed(f: Omit<Family, "expense">): Promise<Family> {
  await one(f.owner, "insert into children (family_id, name) values ($1, 'Kid')", [f.id]);
  // 2026-10-04 is a Sunday (dow 0).
  await one(
    f.owner,
    `insert into custody_rules (family_id, starts_on, first_member_id, handover_weekday, handover_time, valid_from)
     values ($1, '2026-10-04', $2, 0, '18:00', '2026-10-04')`,
    [f.id, f.ownerMember],
  );
  await one(
    f.other,
    `insert into custody_overrides (family_id, starts_at, ends_at, member_id, reason)
     values ($1, '2026-12-24 10:00+00', '2026-12-26 10:00+00', $2, 'Natal')`,
    [f.id, f.otherMember],
  );
  const { id: expense } = await one<{ id: string }>(
    f.owner,
    `insert into expenses (family_id, paid_by, amount_cents, spent_on, description, category)
     values ($1, $2, 10000, '2026-10-10', 'Material escolar', 'escola') returning id`,
    [f.id, f.ownerMember],
  );
  await one(
    f.other,
    `insert into settlements (family_id, from_member, to_member, amount_cents, settled_on)
     values ($1, $2, $3, 600, '2026-10-12')`,
    [f.id, f.otherMember, f.ownerMember],
  );
  // The expense insert above wrote its expense_audit row through the audit trigger (T-17).
  await t.db.query("insert into invites (family_id, created_by) values ($1, $2)", [f.id, f.owner]);
  return { ...f, expense };
}

/** Everything family f has, read as the table owner (bypasses RLS). */
async function snapshot(familyId: string): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const [table, col] of Object.entries(TABLES)) {
    const { rows } = await t.db.query(`select to_jsonb(x) as row from ${table} x where ${col} = $1 order by id`, [familyId]);
    out[table] = rows;
  }
  return out;
}

/** Valid insert statements into family `f`, as an attacker would write them. */
function insertsInto(f: Family): Array<[string, string, unknown[]]> {
  return [
    ["families", "insert into families (id, name) values ($1, 'Fake')", [crypto.randomUUID()]],
    ["members", "insert into members (family_id, user_id, display_name, color) values ($1, $2, 'X', '#000000')", [f.id, eva]],
    ["invites", "insert into invites (family_id) values ($1)", [f.id]],
    ["children", "insert into children (family_id, name) values ($1, 'Intruder')", [f.id]],
    [
      "custody_rules",
      `insert into custody_rules (family_id, starts_on, first_member_id, handover_weekday, handover_time, valid_from)
       values ($1, '2026-10-04', $2, 0, '18:00', '2026-10-04')`,
      [f.id, f.ownerMember],
    ],
    [
      "custody_overrides",
      `insert into custody_overrides (family_id, starts_at, ends_at, member_id, reason)
       values ($1, now(), now() + interval '1 day', $2, 'x')`,
      [f.id, f.ownerMember],
    ],
    [
      "expenses",
      `insert into expenses (family_id, paid_by, amount_cents, spent_on, description)
       values ($1, $2, 1, '2026-10-10', 'x')`,
      [f.id, f.ownerMember],
    ],
    [
      "settlements",
      `insert into settlements (family_id, from_member, to_member, amount_cents, settled_on)
       values ($1, $2, $3, 1, '2026-10-10')`,
      [f.id, f.ownerMember, f.otherMember],
    ],
    [
      "expense_audit",
      "insert into expense_audit (expense_id, family_id, action) values ($1, $2, 'update')",
      [f.expense, f.id],
    ],
  ];
}

beforeAll(async () => {
  t = await createTestDb();
  const [ana, bruno, carla, davi] = await Promise.all(
    ["ana@example.com", "bruno@example.com", "carla@example.com", "davi@example.com"].map((e) => t.createUser(e)),
  );
  eva = await t.createUser("eva@example.com");
  f1 = await seed(await createFamily("Família 1", ana, bruno));
  f2 = await seed(await createFamily("Família 2", carla, davi));
}, 60_000);

describe("schema coverage", () => {
  it("every public table has RLS enabled and is covered by these tests", async () => {
    const { rows } = await t.db.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p') order by c.relname`,
    );
    expect(rows.map((r) => r.relname)).toEqual(Object.keys(TABLES).sort());
    expect(rows.filter((r) => !r.relrowsecurity)).toEqual([]);
  });

  it("no public view or materialized view exposes data around RLS", async () => {
    const { rows } = await t.db.query(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('v', 'm')`,
    );
    expect(rows).toEqual([]);
  });
});

describe("members see their own family (positive control)", () => {
  it("each member reads exactly one row of their family in every table", async () => {
    for (const user of [f1.owner, f1.other]) {
      for (const [table, col] of Object.entries(TABLES)) {
        const r = await one<{ mine: number; total: number }>(
          user,
          `select count(*) filter (where ${col} = $1)::int as mine, count(*)::int as total from ${table}`,
          [f1.id],
        );
        // Two members; two invites (the accepted one and a pending one).
        const expected = table === "members" || table === "invites" ? 2 : 1;
        expect({ table, ...r }).toEqual({ table, mine: expected, total: expected });
      }
    }
  });
});

describe("another family reads nothing (RNF-01)", () => {
  it.each(Object.entries(TABLES))("%s: no row of family 1 is visible to family 2", async (table, col) => {
    for (const user of [f2.owner, f2.other]) {
      const r = await one<{ theirs: number }>(user, `select count(*)::int as theirs from ${table} where ${col} = $1`, [f1.id]);
      expect(r.theirs).toBe(0);
      const { rows } = await t.as(user, () => t.db.query<{ fid: string }>(`select ${col} as fid from ${table}`));
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.fid === f2.id)).toBe(true);
    }
  });

  it.each(Object.keys(TABLES))("%s: a user without a family reads nothing", async (table) => {
    const r = await one<{ n: number }>(eva, `select count(*)::int as n from ${table}`);
    expect(r.n).toBe(0);
  });

  it.each(Object.keys(TABLES))("%s: anon has no access at all", async (table) => {
    expect(await sqlState(t.as(null, () => t.db.query(`select 1 from ${table}`)))).toBe("42501");
  });

  it("is_family_member() is false for another family and for anon", async () => {
    expect((await one<{ ok: boolean }>(f2.owner, "select is_family_member($1) as ok", [f1.id])).ok).toBe(false);
    expect((await one<{ ok: boolean }>(f1.owner, "select is_family_member($1) as ok", [f1.id])).ok).toBe(true);
    const anon = await t.as(null, async () => (await t.db.query<{ ok: boolean }>("select is_family_member($1) as ok", [f1.id])).rows[0]);
    expect(anon.ok).toBe(false);
  });
});

describe("another family writes nothing (RNF-01)", () => {
  it("inserts into family 1 by family 2 or by a user without a family all fail", async () => {
    const before = await snapshot(f1.id);
    for (const user of [f2.owner, eva]) {
      for (const [table, sql, params] of insertsInto(f1)) {
        const state = await sqlState(t.as(user, () => t.db.query(sql, params)));
        expect({ table, state }).toEqual({ table, state: "42501" });
      }
    }
    expect(await snapshot(f1.id)).toEqual(before);
  });

  it("updates and deletes aimed at family 1 touch zero rows", async () => {
    const before = await snapshot(f1.id);
    for (const user of [f2.owner, f2.other, eva]) {
      for (const [table, col] of Object.entries(TABLES)) {
        const upd = await sqlState(
          t.as(user, async () => {
            const r = await t.db.query(`update ${table} set ${col} = ${col} where ${col} = $1`, [f1.id]);
            expect({ table, affected: r.affectedRows }).toEqual({ table, affected: 0 });
          }),
        );
        // 42501 where the table has no UPDATE privilege at all (expense_audit).
        expect([null, "42501"]).toContain(upd);
        const del = await sqlState(
          t.as(user, async () => {
            const r = await t.db.query(`delete from ${table} where ${col} = $1`, [f1.id]);
            expect({ table, affected: r.affectedRows }).toEqual({ table, affected: 0 });
          }),
        );
        expect([null, "42501"]).toContain(del);
      }
    }
    expect(await snapshot(f1.id)).toEqual(before);
  });

  it("an unfiltered update or delete only reaches the caller's own family", async () => {
    const before = await snapshot(f1.id);
    await t.as(f2.owner, async () => {
      await t.db.query("update children set name = 'Renamed'");
      await t.db.query("update expenses set description = 'Changed'");
      await t.db.query("delete from custody_overrides");
    });
    expect(await snapshot(f1.id)).toEqual(before);
    const { rows } = await t.db.query<{ name: string }>("select name from children where family_id = $1", [f2.id]);
    expect(rows).toEqual([{ name: "Renamed" }]);
    // Put family 2's override back for the next tests.
    await one(
      f2.other,
      `insert into custody_overrides (family_id, starts_at, ends_at, member_id, reason)
       values ($1, '2026-12-24 10:00+00', '2026-12-26 10:00+00', $2, 'Natal')`,
      [f2.id, f2.otherMember],
    );
  });

  it("a row cannot be moved from one's own family into family 1", async () => {
    const before = await snapshot(f1.id);
    for (const table of ["children", "custody_rules", "custody_overrides", "expenses", "settlements"]) {
      const state = await sqlState(
        t.as(f2.owner, () => t.db.query(`update ${table} set family_id = $1 where family_id = $2`, [f1.id, f2.id])),
      );
      expect({ table, state }).toEqual({ table, state: "42501" });
    }
    expect(await snapshot(f1.id)).toEqual(before);
  });

  it("rows in one's own family cannot point at members of family 1", async () => {
    const cases: Array<[string, string, unknown[]]> = [
      [
        "expenses",
        `insert into expenses (family_id, paid_by, amount_cents, spent_on, description)
         values ($1, $2, 1, '2026-10-10', 'x')`,
        [f2.id, f1.ownerMember],
      ],
      [
        "custody_rules",
        `insert into custody_rules (family_id, starts_on, first_member_id, handover_weekday, handover_time, valid_from)
         values ($1, '2026-10-04', $2, 0, '18:00', '2026-10-04')`,
        [f2.id, f1.ownerMember],
      ],
      [
        "custody_overrides",
        `insert into custody_overrides (family_id, starts_at, ends_at, member_id, reason)
         values ($1, now(), now() + interval '1 day', $2, 'x')`,
        [f2.id, f1.otherMember],
      ],
      [
        "settlements",
        `insert into settlements (family_id, from_member, to_member, amount_cents, settled_on)
         values ($1, $2, $3, 1, '2026-10-10')`,
        [f2.id, f2.ownerMember, f1.ownerMember],
      ],
    ];
    for (const [table, sql, params] of cases) {
      const state = await sqlState(t.as(f2.owner, () => t.db.query(sql, params)));
      expect({ table, state }).toEqual({ table, state: "23503" });
    }
    const repoint = await sqlState(
      t.as(f2.owner, () => t.db.query("update expenses set paid_by = $1 where family_id = $2", [f1.ownerMember, f2.id])),
    );
    expect(repoint).toBe("23503");
  });

  it("audit rows are written only by the trigger, so none can point at another family", async () => {
    const state = await sqlState(
      t.db.query("insert into expense_audit (expense_id, family_id, action) values ($1, $2, 'update')", [f1.expense, f2.id]),
    );
    expect(state).toBe("42501");
    const { rows } = await t.db.query<{ n: number }>(
      "select count(*)::int as n from expense_audit a join expenses e on e.id = a.expense_id where e.family_id <> a.family_id",
    );
    expect(rows[0].n).toBe(0);
  });

  it("TRUNCATE, which ignores RLS, is not allowed to clients", async () => {
    for (const table of Object.keys(TABLES)) {
      const state = await sqlState(t.as(f2.owner, () => t.db.query(`truncate ${table} cascade`)));
      expect({ table, state }).toEqual({ table, state: "42501" });
    }
    expect((await snapshot(f1.id)).expenses).toHaveLength(1);
  });
});

describe("table rules inside a family", () => {
  it("expenses are never hard-deleted and audit rows are read-only for members", async () => {
    const del = await t.as(f1.owner, () => t.db.query("delete from expenses"));
    expect(del.affectedRows).toBe(0);
    expect(await sqlState(t.as(f1.owner, () => t.db.query("update expense_audit set action = 'delete'")))).toBe("42501");
    expect(await sqlState(t.as(f1.owner, () => t.db.query("delete from expense_audit")))).toBe("42501");
    expect((await snapshot(f1.id)).expense_audit).toHaveLength(1);
  });

  it("created_by is the caller and cannot be changed; payer share defaults from the family", async () => {
    const row = await one<{ id: string; created_by: string; payer_share_bps: number }>(
      f1.other,
      `insert into expenses (family_id, paid_by, amount_cents, spent_on, description, created_by)
       values ($1, $2, 8000, '2026-10-11', 'Dentista', $3) returning id, created_by, payer_share_bps`,
      [f1.id, f1.otherMember, f1.owner],
    );
    expect(row.created_by).toBe(f1.other);
    expect(row.payer_share_bps).toBe(5000);
    const upd = await one<{ created_by: string }>(
      f1.owner,
      "update expenses set created_by = $1, payer_share_bps = 3000 where id = $2 returning created_by",
      [f1.owner, row.id],
    );
    expect(upd.created_by).toBe(f1.other);
  });

  it("rejects non-integer, zero and negative amounts and out-of-range shares", async () => {
    const insert = (amount: unknown, share: number | null) =>
      sqlState(
        t.as(f1.owner, () =>
          t.db.query(
            `insert into expenses (family_id, paid_by, amount_cents, spent_on, description, payer_share_bps)
             values ($1, $2, $3, '2026-10-10', 'x', $4)`,
            [f1.id, f1.ownerMember, amount, share],
          ),
        ),
      );
    expect(await insert("10.5", null)).toBe("22P02");
    expect(await insert(0, null)).toBe("23514");
    expect(await insert(-100, null)).toBe("23514");
    expect(await insert(100, 10001)).toBe("23514");
  });

  it("custody rule start date must fall on the handover weekday", async () => {
    const state = await sqlState(
      t.as(f1.owner, () =>
        t.db.query(
          `insert into custody_rules (family_id, starts_on, first_member_id, handover_weekday, handover_time, valid_from)
           values ($1, '2026-10-05', $2, 0, '18:00', '2026-10-05')`,
          [f1.id, f1.ownerMember],
        ),
      ),
    );
    expect(state).toBe("23514");
  });
});

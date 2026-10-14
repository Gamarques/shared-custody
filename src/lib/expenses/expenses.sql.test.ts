import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, sqlState, type TestDb } from "@/test/pg";
import { initialExpenseForm, toExpenseInsert, type ExpenseFormInput } from "./expense-form";

// T-13 / RF-08, RF-09: the expense form and the family default share under RLS
// (migrations 20261014000300 and 20261014000600), on an in-memory Postgres (PGlite) with the
// real migrations and a Supabase auth stub.

let t: TestDb;
let ana: string;
let bruno: string;
let carla: string;
let familyId: string;
let otherFamilyId: string;
let anaMember: string;
let brunoMember: string;
let carlaMember: string;

type Row = {
  id: string;
  family_id: string;
  paid_by: string;
  amount_cents: number;
  spent_on: string;
  description: string;
  category: string;
  payer_share_bps: number;
  status: string;
  receipt_path: string | null;
  created_by: string | null;
  deleted_at: string | null;
  created_at: string;
};

const COLUMNS =
  "id, family_id, paid_by, amount_cents, spent_on::text, description, category, payer_share_bps, status, " +
  "receipt_path, created_by, deleted_at, to_json(created_at) #>> '{}' as created_at";

async function insert(userId: string | null, row: Record<string, unknown>): Promise<Row> {
  const cols = Object.keys(row);
  return t.as(userId, async () => {
    const { rows } = await t.db.query<Row>(
      `insert into expenses (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})
       returning ${COLUMNS}`,
      Object.values(row),
    );
    return rows[0];
  });
}

async function expenses(userId: string): Promise<Row[]> {
  return t.as(userId, async () => (await t.db.query<Row>(`select ${COLUMNS} from expenses order by created_at`)).rows);
}

async function familyDefault(userId: string, fid = familyId): Promise<number | undefined> {
  return t.as(userId, async () => {
    const { rows } = await t.db.query<{ bps: number }>("select default_payer_share_bps as bps from families where id = $1", [fid]);
    return rows[0]?.bps;
  });
}

/** What the screen sends to change the family default: `update families ... returning id`. */
async function setFamilyDefault(userId: string, bps: number, fid = familyId): Promise<number> {
  return t.as(userId, async () => {
    const { rows } = await t.db.query("update families set default_payer_share_bps = $1 where id = $2 returning id", [bps, fid]);
    return rows.length;
  });
}

function form(patch: Partial<ExpenseFormInput> = {}): ExpenseFormInput {
  return { amount: "100,00", spentOn: "2026-10-10", description: "Material escolar", category: "escola", paidBy: anaMember, payerPercent: "50", ...patch };
}

beforeEach(async () => {
  t = await createTestDb();
  ana = await t.createUser("ana@example.com");
  bruno = await t.createUser("bruno@example.com");
  carla = await t.createUser("carla@example.com");
  familyId = await t.as(ana, async () => {
    const { rows } = await t.db.query<{ id: string }>("select create_family('Família Silva', 'Ana', '#2f6f5e') as id");
    return rows[0].id;
  });
  const token = await t.as(ana, async () => {
    const { rows } = await t.db.query<{ token: string }>("select token from create_invite(null)");
    return rows[0].token;
  });
  await t.as(bruno, () => t.db.query("select accept_invite($1, 'Bruno', '#1d4ed8')", [token]));
  otherFamilyId = await t.as(carla, async () => {
    const { rows } = await t.db.query<{ id: string }>("select create_family('Outra', 'Carla', '#a21caf') as id");
    return rows[0].id;
  });
  const { rows } = await t.db.query<{ id: string; user_id: string }>("select id, user_id from members");
  anaMember = rows.find((r) => r.user_id === ana)!.id;
  brunoMember = rows.find((r) => r.user_id === bruno)!.id;
  carlaMember = rows.find((r) => r.user_id === carla)!.id;
}, 30_000);

describe("registering an expense (RF-08)", () => {
  it("stores what the form sends, in cents; both members read it", async () => {
    const e = await insert(ana, toExpenseInsert(familyId, form({ amount: "1.234,56" })));
    expect(e).toMatchObject({
      family_id: familyId,
      paid_by: anaMember,
      amount_cents: 123456,
      spent_on: "2026-10-10",
      description: "Material escolar",
      category: "escola",
      payer_share_bps: 5000,
      status: "pending",
      receipt_path: null,
      created_by: ana,
      deleted_at: null,
    });
    expect(await expenses(bruno)).toEqual([e]);
  });

  it("either member registers an expense paid by the other", async () => {
    const e = await insert(bruno, toExpenseInsert(familyId, form({ paidBy: anaMember, description: "Dentista" })));
    expect(e).toMatchObject({ paid_by: anaMember, created_by: bruno });
  });

  it("starts pending and alive, with server timestamps and author, whatever the client sends", async () => {
    const e = await insert(bruno, {
      ...toExpenseInsert(familyId, form()),
      status: "confirmed",
      deleted_at: "2026-10-01T00:00:00Z",
      created_at: "2099-01-01T00:00:00Z",
      created_by: ana,
    });
    expect(e.status).toBe("pending");
    expect(e.deleted_at).toBeNull();
    expect(e.created_at.startsWith("2099")).toBe(false);
    expect(e.created_by).toBe(bruno);
  });

  it("rejects amounts that are not positive cents within the limit", async () => {
    const row = toExpenseInsert(familyId, form());
    expect(await sqlState(insert(ana, { ...row, amount_cents: 0 }))).toBe("23514");
    expect(await sqlState(insert(ana, { ...row, amount_cents: -100 }))).toBe("23514");
    expect(await sqlState(insert(ana, { ...row, amount_cents: 100_000_001 }))).toBe("23514");
    expect(await sqlState(insert(ana, { ...row, amount_cents: 12.5 }))).not.toBeNull();
    expect((await insert(ana, { ...row, amount_cents: 100_000_000 })).amount_cents).toBe(100_000_000);
  });

  it("rejects an empty description, an unknown category and a share outside 0..100%", async () => {
    const row = toExpenseInsert(familyId, form());
    expect(await sqlState(insert(ana, { ...row, description: "  " }))).toBe("23514");
    expect(await sqlState(insert(ana, { ...row, category: "viagem" }))).toBe("23514");
    expect(await sqlState(insert(ana, { ...row, payer_share_bps: 10_001 }))).toBe("23514");
    expect(await sqlState(insert(ana, { ...row, payer_share_bps: -1 }))).toBe("23514");
  });

  it("the payer must belong to the family", async () => {
    expect(await sqlState(insert(ana, toExpenseInsert(familyId, form({ paidBy: carlaMember }))))).toBe("23503");
  });
});

describe("share per expense and family default (RF-09)", () => {
  it("the form comes filled with the family default and the edited value is stored", async () => {
    expect(await familyDefault(ana)).toBe(5000);
    expect(initialExpenseForm("2026-10-14", (await familyDefault(ana))!, anaMember).payerPercent).toBe("50");
    const e = await insert(bruno, toExpenseInsert(familyId, form({ paidBy: brunoMember, amount: "80", payerPercent: "30" })));
    expect(e).toMatchObject({ amount_cents: 8000, payer_share_bps: 3000 });
  });

  it("either member edits the default; new expenses get it, saved ones keep theirs", async () => {
    const before = await insert(ana, toExpenseInsert(familyId, form()));
    expect(await setFamilyDefault(bruno, 6000)).toBe(1);
    expect(await familyDefault(ana)).toBe(6000);
    expect(initialExpenseForm("2026-10-14", 6000, anaMember).payerPercent).toBe("60");

    // A row without a share (e.g. from another client) falls back to the current default.
    const { payer_share_bps: _omitted, ...withoutShare } = toExpenseInsert(familyId, form());
    expect((await insert(ana, withoutShare)).payer_share_bps).toBe(6000);
    expect((await expenses(ana)).find((e) => e.id === before.id)!.payer_share_bps).toBe(5000);
  });

  it("the default stays between 0 and 100%", async () => {
    expect(await sqlState(setFamilyDefault(ana, 10_001))).toBe("23514");
    expect(await sqlState(setFamilyDefault(ana, -1))).toBe("23514");
    expect(await setFamilyDefault(ana, 0)).toBe(1);
    expect(await setFamilyDefault(ana, 10_000)).toBe(1);
  });

  it("another family's default is neither read nor changed", async () => {
    expect(await familyDefault(carla)).toBeUndefined();
    expect(await setFamilyDefault(carla, 9000)).toBe(0);
    expect(await familyDefault(ana)).toBe(5000);
    expect(await setFamilyDefault(ana, 9000, otherFamilyId)).toBe(0);
    expect(await familyDefault(carla, otherFamilyId)).toBe(5000);
  });
});

describe("expenses are isolated by family", () => {
  let e: Row;

  beforeEach(async () => {
    e = await insert(ana, toExpenseInsert(familyId, form()));
  });

  it("users of another family neither read nor add expenses", async () => {
    expect(await expenses(carla)).toEqual([]);
    expect(await sqlState(insert(carla, toExpenseInsert(familyId, form())))).toBe("42501");
    // Not even with a payer of their own family.
    expect(await sqlState(insert(carla, toExpenseInsert(familyId, form({ paidBy: carlaMember }))))).toBe("42501");
    expect(await expenses(ana)).toEqual([e]);
  });

  it("nobody deletes an expense (logical delete only)", async () => {
    for (const user of [ana, bruno, carla]) {
      const r = await t.as(user, () => t.db.query("delete from expenses"));
      expect(r.affectedRows ?? 0).toBe(0);
    }
    expect(await expenses(ana)).toEqual([e]);
  });

  it("anon has no access", async () => {
    expect(await sqlState(t.as(null, () => t.db.query("select * from expenses")))).toBe("42501");
    expect(await sqlState(insert(null, toExpenseInsert(familyId, form())))).toBe("42501");
  });
});

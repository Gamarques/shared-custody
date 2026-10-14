import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, sqlState, type TestDb } from "@/test/pg";

// T-14 / RNF-06, RNF-08: private receipts bucket and its policies, on PGlite with the real
// migrations and a stub of the storage schema (src/test/pg.ts).

let t: TestDb;
let ana: string;
let bruno: string;
let carla: string;
let familyId: string;
let otherFamilyId: string;
let anaMember: string;

async function upload(userId: string | null, name: string, bucket = "receipts") {
  return t.as(userId, () =>
    t.db.query("insert into storage.objects (bucket_id, name) values ($1, $2)", [bucket, name]),
  );
}
async function visible(userId: string | null): Promise<string[]> {
  return t.as(userId, async () =>
    (await t.db.query<{ name: string }>("select name from storage.objects order by name")).rows.map((r) => r.name),
  );
}

beforeEach(async () => {
  t = await createTestDb();
  ana = await t.createUser("ana@example.com");
  bruno = await t.createUser("bruno@example.com");
  carla = await t.createUser("carla@example.com");
  familyId = await t.as(
    ana,
    async () => (await t.db.query<{ id: string }>("select create_family('F', 'Ana', '#2f6f5e') as id")).rows[0].id,
  );
  const token = await t.as(
    ana,
    async () => (await t.db.query<{ token: string }>("select token from create_invite(null)")).rows[0].token,
  );
  await t.as(bruno, () => t.db.query("select accept_invite($1, 'Bruno', '#1d4ed8')", [token]));
  otherFamilyId = await t.as(
    carla,
    async () => (await t.db.query<{ id: string }>("select create_family('O', 'Carla', '#a21caf') as id")).rows[0].id,
  );
  const { rows } = await t.db.query<{ id: string; user_id: string }>("select id, user_id from members");
  anaMember = rows.find((r) => r.user_id === ana)!.id;
}, 30_000);

describe("receipts bucket (RNF-06, RNF-08)", () => {
  it("is private, jpeg only and capped per file", async () => {
    const { rows } = await t.db.query<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>(
      "select public, file_size_limit::text, allowed_mime_types from storage.buckets where id = 'receipts'",
    );
    expect(rows[0].public).toBe(false);
    expect(Number(rows[0].file_size_limit)).toBeLessThanOrEqual(512 * 1024);
    expect(rows[0].allowed_mime_types).toEqual(["image/jpeg"]);
  });

  it("members upload and read in their family folder; the other family and anon see nothing", async () => {
    await upload(ana, `${familyId}/a.jpg`);
    await upload(bruno, `${familyId}/b.jpg`);
    expect(await visible(ana)).toEqual([`${familyId}/a.jpg`, `${familyId}/b.jpg`]);
    expect(await visible(bruno)).toHaveLength(2);
    expect(await visible(carla)).toEqual([]);
    expect(await visible(null)).toEqual([]);
  });

  it("refuses an upload into another family's folder, outside a family folder, or as anon", async () => {
    expect(await sqlState(upload(carla, `${familyId}/x.jpg`))).toBe("42501");
    expect(await sqlState(upload(ana, "loose.jpg"))).toBe("42501");
    expect(await sqlState(upload(ana, "not-a-uuid/x.jpg"))).toBe("42501");
    expect(await sqlState(upload(null, `${familyId}/x.jpg`))).not.toBeNull();
    expect(await sqlState(upload(ana, `${familyId}/x.jpg`, "other-bucket"))).not.toBeNull();
  });

  it("another family cannot replace or remove a receipt", async () => {
    await upload(ana, `${familyId}/a.jpg`);
    const touched = await t.as(carla, async () => {
      const u = await t.db.query("update storage.objects set name = name where bucket_id = 'receipts'");
      const d = await t.db.query("delete from storage.objects where bucket_id = 'receipts'");
      return (u.affectedRows ?? 0) + (d.affectedRows ?? 0);
    });
    expect(touched).toBe(0);
    expect(await visible(ana)).toHaveLength(1);
  });

  it("members can remove their own family's receipt", async () => {
    await upload(ana, `${familyId}/a.jpg`);
    await t.as(bruno, () => t.db.query("delete from storage.objects where name = $1", [`${familyId}/a.jpg`]));
    expect(await visible(ana)).toEqual([]);
  });
});

describe("expenses.receipt_path", () => {
  const insert = (userId: string, fid: string, receipt: string | null) =>
    t.as(userId, () =>
      t.db.query(
        `insert into expenses (family_id, paid_by, amount_cents, spent_on, description, category, payer_share_bps, receipt_path)
         values ($1, $2, 1000, '2026-10-10', 'x', 'outros', 5000, $3)`,
        [fid, anaMember, receipt],
      ),
    );

  it("accepts a path in the expense's own family folder, or none", async () => {
    expect(await sqlState(insert(ana, familyId, `${familyId}/a.jpg`))).toBeNull();
    expect(await sqlState(insert(ana, familyId, null))).toBeNull();
  });

  it("rejects a path pointing into another family's folder", async () => {
    expect(await sqlState(insert(ana, familyId, `${otherFamilyId}/a.jpg`))).toBe("23514");
  });
});

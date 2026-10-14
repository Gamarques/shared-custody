import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, sqlState, type TestDb } from "@/test/pg";

// Runs the real migrations on an in-memory Postgres (PGlite) with a Supabase auth stub.

let t: TestDb;
let ana: string;
let bruno: string;
let carla: string;
let familyId: string;

async function createInvite(userId: string, email: string | null = null): Promise<string> {
  return t.as(userId, async () => {
    const { rows } = await t.db.query<{ token: string }>("select token from create_invite($1)", [email]);
    return rows[0].token;
  });
}

function accept(userId: string | null, token: string, name: string, color: string) {
  return t.as(userId, () =>
    t.db.query<{ fid: string }>("select accept_invite($1, $2, $3) as fid", [token, name, color]),
  );
}

function getInvite(userId: string, token: string) {
  return t.as(userId, async () => {
    const { rows } = await t.db.query<{ status: string; family_name: string; inviter_name: string; taken_colors: string[] }>(
      "select * from get_invite($1)",
      [token],
    );
    return rows[0];
  });
}

async function memberCount(): Promise<number> {
  const { rows } = await t.db.query<{ n: number }>("select count(*)::int as n from members where family_id = $1", [familyId]);
  return rows[0].n;
}

beforeEach(async () => {
  t = await createTestDb();
  ana = await t.createUser("ana@example.com");
  bruno = await t.createUser("Bruno@Example.com");
  carla = await t.createUser("carla@example.com");
  familyId = await t.as(ana, async () => {
    const { rows } = await t.db.query<{ id: string }>("select create_family('Família Silva', 'Ana', '#2f6f5e') as id");
    return rows[0].id;
  });
}, 30_000);

describe("invite acceptance (RF-02)", () => {
  it("invitee joins the family through the link and becomes a member", async () => {
    const token = await createInvite(ana);
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    const info = await getInvite(bruno, token);
    expect(info).toMatchObject({ status: "valid", family_name: "Família Silva", inviter_name: "Ana" });
    expect(info.taken_colors).toEqual(["#2f6f5e"]);

    const { rows } = await accept(bruno, token, " Bruno ", "#1d4ed8");
    expect(rows[0].fid).toBe(familyId);

    const members = await t.as(bruno, async () => (await t.db.query("select display_name, role from members order by created_at")).rows);
    expect(members).toEqual([
      { display_name: "Ana", role: "owner" },
      { display_name: "Bruno", role: "member" },
    ]);
    // Bruno now reads the family under the regular RLS policies.
    const fam = await t.as(bruno, async () => (await t.db.query("select name from families")).rows);
    expect(fam).toEqual([{ name: "Família Silva" }]);
    expect((await getInvite(bruno, token)).status).toBe("accepted");
  });

  it("blocks a third member: no new invite, and an older link cannot be used", async () => {
    const token = await createInvite(ana);
    await accept(bruno, token, "Bruno", "#1d4ed8");

    expect(await sqlState(createInvite(ana))).toBe("IV005");
    expect(await sqlState(createInvite(bruno))).toBe("IV005");
    expect(await sqlState(accept(carla, token, "Carla", "#a21caf"))).toBe("IV002");
    expect(await memberCount()).toBe(2);
  });

  it("blocks a third member even with a pending invite left over", async () => {
    // Simulate a pending invite that survived the family filling up (e.g. a race).
    const first = await createInvite(ana);
    await t.db.query(
      "insert into invites (family_id, created_by, token) values ($1, $2, 'f'||repeat('0', 63))",
      [familyId, ana],
    );
    await accept(bruno, first, "Bruno", "#1d4ed8");
    const leftover = "f" + "0".repeat(63);
    expect((await getInvite(carla, leftover)).status).toBe("full");
    expect(await sqlState(accept(carla, leftover, "Carla", "#a21caf"))).toBe("IV005");
    expect(await memberCount()).toBe(2);
  });

  it("members_max_two trigger blocks a third row even outside the functions", async () => {
    const token = await createInvite(ana);
    await accept(bruno, token, "Bruno", "#1d4ed8");
    const err = await sqlState(
      t.db.query("insert into members (family_id, user_id, display_name, color) values ($1, $2, 'Carla', '#a21caf')", [familyId, carla]),
    );
    expect(err).toBe("23514");
  });

  it("invite links are single use", async () => {
    const token = await createInvite(ana);
    await accept(bruno, token, "Bruno", "#1d4ed8");
    expect(await sqlState(accept(bruno, token, "Bruno", "#1d4ed8"))).toBe("IV007");
  });

  it("rejects unknown, expired and revoked (replaced) tokens", async () => {
    expect(await sqlState(accept(bruno, "0".repeat(64), "Bruno", "#1d4ed8"))).toBe("IV001");
    expect(await getInvite(bruno, "0".repeat(64))).toBeUndefined();

    const old = await createInvite(ana);
    const current = await createInvite(ana);
    expect(await sqlState(accept(bruno, old, "Bruno", "#1d4ed8"))).toBe("IV001");

    await t.db.query("update invites set expires_at = now() - interval '1 second' where token = $1", [current]);
    expect((await getInvite(bruno, current)).status).toBe("expired");
    expect(await sqlState(accept(bruno, current, "Bruno", "#1d4ed8"))).toBe("IV003");
    expect(await memberCount()).toBe(1);
  });

  it("an invite with an e-mail only works for that e-mail (case-insensitive)", async () => {
    const token = await createInvite(ana, " BRUNO@example.com ");
    expect(await sqlState(accept(carla, token, "Carla", "#a21caf"))).toBe("IV004");
    await accept(bruno, token, "Bruno", "#1d4ed8");
    expect(await memberCount()).toBe(2);
  });

  it("rejects the color already used by the other member", async () => {
    const token = await createInvite(ana);
    expect(await sqlState(accept(bruno, token, "Bruno", "#2F6F5E"))).toBe("IV006");
  });

  it("users already in a family cannot accept, and users without one cannot invite", async () => {
    const token = await createInvite(ana);
    expect(await sqlState(accept(ana, token, "Ana", "#1d4ed8"))).toBe("IV007");
    expect(await sqlState(createInvite(carla))).toBe("IV008");
  });

  it("anonymous callers cannot use the invite functions", async () => {
    const token = await createInvite(ana);
    expect(await sqlState(accept(null, token, "X", "#1d4ed8"))).toBe("42501");
    expect(await sqlState(t.as(null, () => t.db.query("select * from get_invite($1)", [token])))).toBe("42501");
    expect(await sqlState(t.as(null, () => t.db.query("select * from create_invite(null)")))).toBe("42501");
  });
});

describe("invites RLS", () => {
  it("only family members read invites; nobody inserts or updates directly", async () => {
    const token = await createInvite(ana);
    const asAna = await t.as(ana, async () => (await t.db.query("select token from invites")).rows);
    expect(asAna).toEqual([{ token }]);
    const asBruno = await t.as(bruno, async () => (await t.db.query("select token from invites")).rows);
    expect(asBruno).toEqual([]);

    expect(
      await sqlState(t.as(ana, () => t.db.query("insert into invites (family_id) values ($1)", [familyId]))),
    ).toBe("42501");
    const upd = await t.as(ana, () => t.db.query("update invites set expires_at = now() + interval '1 year'"));
    expect(upd.affectedRows).toBe(0);
    // Invitee cannot add themselves to members directly either.
    expect(
      await sqlState(
        t.as(bruno, () =>
          t.db.query("insert into members (family_id, user_id, display_name, color) values ($1, $2, 'B', '#1d4ed8')", [familyId, bruno]),
        ),
      ),
    ).toBe("42501");
  });

  it("members revoke pending invites; outsiders cannot", async () => {
    await createInvite(ana);
    const byBruno = await t.as(bruno, () => t.db.query("delete from invites"));
    expect(byBruno.affectedRows).toBe(0);
    const byAna = await t.as(ana, () => t.db.query("delete from invites"));
    expect(byAna.affectedRows).toBe(1);
  });

  it("accepted invites are kept (cannot be deleted)", async () => {
    const token = await createInvite(ana);
    await accept(bruno, token, "Bruno", "#1d4ed8");
    const del = await t.as(ana, () => t.db.query("delete from invites"));
    expect(del.affectedRows).toBe(0);
  });
});

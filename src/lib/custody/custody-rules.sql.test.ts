import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, sqlState, type TestDb } from "@/test/pg";
import { type CustodyRule, getCustodyHolder } from "./holder";
import { toCustodyRuleInsert } from "./rule-form";

// T-08 / RF-04: saving the custody rule creates a new version and preserves the previous one.
// Runs the real migrations on an in-memory Postgres (PGlite) with a Supabase auth stub.

let t: TestDb;
let ana: string;
let bruno: string;
let carla: string;
let familyId: string;
let anaMember: string;
let brunoMember: string;

// created_at in the same ISO format PostgREST returns ("2026-10-14T19:55:00.123456+00:00").
const COLUMNS =
  "id, starts_on::text, first_member_id, handover_weekday, handover_time::text, valid_from::text, valid_to::text, created_by, to_json(created_at) #>> '{}' as created_at";

type Row = CustodyRule & { created_by: string | null; created_at: string };

/** Inserts the row the form sends (toCustodyRuleInsert), as `userId`, under RLS. */
async function save(userId: string, row: Record<string, unknown>): Promise<Row> {
  const cols = Object.keys(row);
  return t.as(userId, async () => {
    const { rows } = await t.db.query<Row>(
      `insert into custody_rules (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})
       returning ${COLUMNS}`,
      Object.values(row),
    );
    return rows[0];
  });
}

async function versions(userId: string): Promise<Row[]> {
  return t.as(userId, async () => (await t.db.query<Row>(`select ${COLUMNS} from custody_rules order by created_at`)).rows);
}

async function todayInFamilyZone(): Promise<string> {
  const { rows } = await t.db.query<{ d: string }>(
    "select (now() at time zone timezone)::date::text as d from families where id = $1",
    [familyId],
  );
  return rows[0].d;
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
  const { rows } = await t.db.query<{ id: string; user_id: string }>("select id, user_id from members");
  anaMember = rows.find((r) => r.user_id === ana)!.id;
  brunoMember = rows.find((r) => r.user_id === bruno)!.id;
}, 30_000);

describe("saving the custody rule (RF-04)", () => {
  it("the first version applies from its first handover", async () => {
    const v1 = await save(
      ana,
      toCustodyRuleInsert(familyId, {
        firstMemberId: anaMember,
        startsOn: "2026-01-04",
        handoverWeekday: 0,
        handoverTime: "18:00",
        validFrom: null,
      }),
    );
    expect(v1).toMatchObject({
      starts_on: "2026-01-04",
      first_member_id: anaMember,
      handover_weekday: 0,
      handover_time: "18:00:00",
      valid_from: "2026-01-04",
      valid_to: null,
      created_by: ana,
    });
  });

  it("saving again creates a new version and preserves the previous one unchanged", async () => {
    const v1 = await save(ana, toCustodyRuleInsert(familyId, {
      firstMemberId: anaMember, startsOn: "2026-01-04", handoverWeekday: 0, handoverTime: "18:00", validFrom: null,
    }));
    const v2 = await save(bruno, toCustodyRuleInsert(familyId, {
      firstMemberId: brunoMember, startsOn: "2026-06-05", handoverWeekday: 5, handoverTime: "19:00", validFrom: "2026-06-01",
    }));

    expect(v2.id).not.toBe(v1.id);
    expect(v2).toMatchObject({ valid_from: "2026-06-01", first_member_id: brunoMember, created_by: bruno });
    // Both members see both versions, and v1 is exactly as it was saved.
    for (const user of [ana, bruno]) {
      expect(await versions(user)).toEqual([v1, v2]);
    }
  });

  it("a new version without valid_from applies from today in the family time zone", async () => {
    await save(ana, toCustodyRuleInsert(familyId, {
      firstMemberId: anaMember, startsOn: "2026-01-04", handoverWeekday: 0, handoverTime: "18:00", validFrom: null,
    }));
    // UTC+14: "today" there differs from UTC for part of every day, so this checks the zone is used.
    await t.db.query("update families set timezone = 'Pacific/Kiritimati' where id = $1", [familyId]);
    const v2 = await save(bruno, {
      family_id: familyId, first_member_id: brunoMember, starts_on: "2026-01-02", handover_weekday: 5, handover_time: "19:00",
    });
    expect(v2.valid_from).toBe(await todayInFamilyZone());
  });

  it("created_at comes from the server clock, so the save order cannot be forged", async () => {
    const v1 = await save(ana, {
      family_id: familyId, first_member_id: anaMember, starts_on: "2026-01-04", handover_weekday: 0,
      handover_time: "18:00", created_at: "2099-01-01T00:00:00Z",
    });
    expect(v1.created_at.startsWith("2099")).toBe(false);
  });

  it("the start date must fall on the handover weekday", async () => {
    const state = await sqlState(save(ana, {
      family_id: familyId, first_member_id: anaMember, starts_on: "2026-01-05", handover_weekday: 0, handover_time: "18:00",
    }));
    expect(state).toBe("23514");
  });
});

describe("versions are preserved (append-only)", () => {
  let v1: Row;

  beforeEach(async () => {
    v1 = await save(ana, toCustodyRuleInsert(familyId, {
      firstMemberId: anaMember, startsOn: "2026-01-04", handoverWeekday: 0, handoverTime: "18:00", validFrom: null,
    }));
  });

  it("members cannot update or delete a version", async () => {
    for (const user of [ana, bruno]) {
      expect(await sqlState(t.as(user, () => t.db.query("update custody_rules set handover_time = '09:00'")))).toBe("42501");
      expect(await sqlState(t.as(user, () => t.db.query("update custody_rules set valid_to = '2026-12-31'")))).toBe("42501");
      expect(await sqlState(t.as(user, () => t.db.query("delete from custody_rules")))).toBe("42501");
    }
    expect(await versions(ana)).toEqual([v1]);
  });

  it("even roles that bypass RLS cannot change a version's content", async () => {
    expect(await sqlState(t.db.query("update custody_rules set first_member_id = $1", [brunoMember]))).toBe("CR001");
    expect(await sqlState(t.db.query("update custody_rules set valid_from = '2026-01-01'"))).toBe("CR001");
    expect(await versions(ana)).toEqual([v1]);
  });

  it("deleting the family still cascades to its versions", async () => {
    await t.db.query("delete from families where id = $1", [familyId]);
    const { rows } = await t.db.query<{ n: number }>("select count(*)::int as n from custody_rules");
    expect(rows[0].n).toBe(0);
  });

  it("users of another family neither read nor add versions", async () => {
    await t.as(carla, () => t.db.query("select create_family('Outra', 'Carla', '#a21caf')"));
    expect(await versions(carla)).toEqual([]);
    const state = await sqlState(save(carla, {
      family_id: familyId, first_member_id: anaMember, starts_on: "2026-01-04", handover_weekday: 0, handover_time: "18:00",
    }));
    expect(state).toBe("42501");
    expect(await versions(ana)).toEqual([v1]);
  });
});

describe("versions read back from the database drive getCustodyHolder", () => {
  it("past weeks keep the old rule; the new one applies from its first handover", async () => {
    await save(ana, toCustodyRuleInsert(familyId, {
      firstMemberId: anaMember, startsOn: "2026-01-04", handoverWeekday: 0, handoverTime: "18:00", validFrom: null,
    }));
    const v2 = await save(bruno, toCustodyRuleInsert(familyId, {
      firstMemberId: brunoMember, startsOn: "2026-06-05", handoverWeekday: 5, handoverTime: "19:00", validFrom: "2026-06-01",
    }));
    const rules = await versions(ana);
    const schedule = { timezone: "Europe/Lisbon", memberIds: [anaMember, brunoMember], rules };
    const at = (iso: string) => getCustodyHolder(new Date(iso), schedule);

    expect(at("2026-03-01T12:00:00Z")).toMatchObject({ ruleId: rules[0].id, memberId: brunoMember, weekIndex: 7 });
    expect(at("2026-06-05T17:59:59Z")).toMatchObject({ ruleId: rules[0].id });
    expect(at("2026-06-05T18:00:00Z")).toMatchObject({ ruleId: v2.id, memberId: brunoMember, weekIndex: 0 });
    expect(at("2026-06-12T18:00:00Z")).toMatchObject({ ruleId: v2.id, memberId: anaMember, weekIndex: 1 });
  });
});

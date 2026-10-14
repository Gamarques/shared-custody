import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, sqlState, type TestDb } from "@/test/pg";
import { buildMonthCalendar, parseMonth } from "./calendar";
import type { CustodyOverride, CustodyRule } from "./holder";
import { toCustodyOverrideInsert } from "./override-form";
import { toCustodyRuleInsert } from "./rule-form";

// T-11 / RF-07: custody overrides under RLS (migration 20261014000500), on an in-memory
// Postgres (PGlite) with the real migrations and a Supabase auth stub.

const TZ = "Europe/Lisbon";

let t: TestDb;
let ana: string;
let bruno: string;
let carla: string;
let familyId: string;
let anaMember: string;
let brunoMember: string;
let carlaMember: string;

const COLUMNS =
  "id, family_id, member_id, reason, created_by, to_json(starts_at) #>> '{}' as starts_at, " +
  "to_json(ends_at) #>> '{}' as ends_at, to_json(created_at) #>> '{}' as created_at";

type Row = CustodyOverride & { family_id: string; created_by: string | null };

async function insert(userId: string, row: Record<string, unknown>): Promise<Row> {
  const cols = Object.keys(row);
  return t.as(userId, async () => {
    const { rows } = await t.db.query<Row>(
      `insert into custody_overrides (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})
       returning ${COLUMNS}`,
      Object.values(row),
    );
    return rows[0];
  });
}

async function overrides(userId: string): Promise<Row[]> {
  return t.as(userId, async () => (await t.db.query<Row>(`select ${COLUMNS} from custody_overrides order by created_at`)).rows);
}

/** What the form sends for Christmas with Bruno, 24/12 18:00 to 26/12 18:00 in Lisbon. */
function christmas(extra: Record<string, unknown> = {}) {
  return {
    ...toCustodyOverrideInsert(
      familyId,
      { memberId: brunoMember, startDate: "2026-12-24", startTime: "18:00", endDate: "2026-12-26", endTime: "18:00", reason: "Natal" },
      TZ,
    ),
    ...extra,
  };
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
  await t.as(carla, () => t.db.query("select create_family('Outra', 'Carla', '#a21caf')"));
  const { rows } = await t.db.query<{ id: string; user_id: string }>("select id, user_id from members");
  anaMember = rows.find((r) => r.user_id === ana)!.id;
  brunoMember = rows.find((r) => r.user_id === bruno)!.id;
  carlaMember = rows.find((r) => r.user_id === carla)!.id;
}, 30_000);

describe("adding an exception (RF-07)", () => {
  it("stores the row the form sends; both members read it", async () => {
    const o = await insert(ana, christmas());
    expect(o).toMatchObject({
      family_id: familyId,
      member_id: brunoMember,
      reason: "Natal",
      created_by: ana,
    });
    expect(Date.parse(o.starts_at)).toBe(Date.parse("2026-12-24T18:00:00Z"));
    expect(Date.parse(o.ends_at)).toBe(Date.parse("2026-12-26T18:00:00Z"));
    expect(await overrides(bruno)).toEqual([o]);
  });

  it("created_at and created_by come from the server, so precedence cannot be forged", async () => {
    const o = await insert(bruno, christmas({ created_at: "2099-01-01T00:00:00Z", created_by: ana }));
    expect(o.created_at.startsWith("2099")).toBe(false);
    expect(o.created_by).toBe(bruno);
  });

  it("rejects an empty reason, an end before the start and more than a year", async () => {
    expect(await sqlState(insert(ana, christmas({ reason: "  " })))).toBe("23514");
    expect(await sqlState(insert(ana, christmas({ ends_at: "2026-12-24T18:00:00Z" })))).toBe("23514");
    expect(await sqlState(insert(ana, christmas({ ends_at: "2027-12-26T18:00:00Z" })))).toBe("23514");
    expect(await insert(ana, christmas({ ends_at: "2027-12-25T18:00:00Z" }))).toMatchObject({ reason: "Natal" });
  });

  it("the member must belong to the family", async () => {
    expect(await sqlState(insert(ana, christmas({ member_id: carlaMember })))).toBe("23503");
  });
});

describe("exceptions are isolated by family and never edited", () => {
  let o: Row;

  beforeEach(async () => {
    o = await insert(ana, christmas());
  });

  it("members cannot update an exception; they remove it and add another", async () => {
    for (const user of [ana, bruno]) {
      expect(await sqlState(t.as(user, () => t.db.query("update custody_overrides set reason = 'x'")))).toBe("42501");
      expect(await sqlState(t.as(user, () => t.db.query("update custody_overrides set member_id = $1", [anaMember])))).toBe("42501");
    }
    expect(await overrides(ana)).toEqual([o]);
  });

  it("either member removes an exception of the family", async () => {
    const r = await t.as(bruno, () => t.db.query("delete from custody_overrides where id = $1", [o.id]));
    expect(r.affectedRows).toBe(1);
    expect(await overrides(ana)).toEqual([]);
  });

  it("users of another family neither read, add nor remove exceptions", async () => {
    expect(await overrides(carla)).toEqual([]);
    expect(await sqlState(insert(carla, christmas()))).toBe("42501");
    const r = await t.as(carla, () => t.db.query("delete from custody_overrides"));
    expect(r.affectedRows).toBe(0);
    expect(await overrides(ana)).toEqual([o]);
  });

  it("anon has no access", async () => {
    expect(await sqlState(t.as(null, () => t.db.query("select * from custody_overrides")))).toBe("42501");
    expect(await sqlState(insert(null as unknown as string, christmas()))).toBe("42501");
  });
});

describe("exceptions read back from the database drive the calendar", () => {
  it("override the rule and show their reason; the one created last wins", async () => {
    const rule = await t.as(ana, async () => {
      const row = toCustodyRuleInsert(familyId, {
        firstMemberId: anaMember, startsOn: "2026-01-04", handoverWeekday: 0, handoverTime: "18:00", validFrom: null,
      });
      const cols = Object.keys(row);
      const { rows } = await t.db.query<CustodyRule>(
        `insert into custody_rules (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})
         returning id, starts_on::text, first_member_id, handover_weekday, handover_time::text, valid_from::text,
                   valid_to::text, to_json(created_at) #>> '{}' as created_at`,
        Object.values(row),
      );
      return rows[0];
    });
    // 24/12/2026 falls in Ana's week (20/12 18:00 to 27/12 18:00).
    await insert(ana, christmas());
    // Added later by Bruno, overlapping Christmas Day: wins there.
    await insert(bruno, toCustodyOverrideInsert(familyId, {
      memberId: anaMember, startDate: "2026-12-25", startTime: "10:00", endDate: "2026-12-25", endTime: "14:00", reason: "Almoço de Natal",
    }, TZ));

    const cal = buildMonthCalendar({
      month: parseMonth("2026-12")!,
      now: new Date("2026-12-01T12:00:00Z"),
      timezone: TZ,
      members: [
        { id: anaMember, display_name: "Ana", color: "#2f6f5e" },
        { id: brunoMember, display_name: "Bruno", color: "#1d4ed8" },
      ],
      rules: [rule],
      overrides: await overrides(bruno),
    });
    const day = (date: string) => cal.weeks.flat().find((d) => d.date === date)!;
    const holders = (date: string) => day(date).segments.map((s) => [s.person?.name, s.reason]);

    expect(holders("2026-12-24")).toEqual([["Ana", null], ["Bruno", "Natal"]]);
    expect(day("2026-12-24").labels).toEqual(["Natal"]);
    expect(holders("2026-12-25")).toEqual([["Bruno", "Natal"], ["Ana", "Almoço de Natal"], ["Bruno", "Natal"]]);
    expect(holders("2026-12-26")).toEqual([["Bruno", "Natal"], ["Ana", null]]);
    expect(cal.exceptions.map((e) => `${e.reason}: ${e.person.name} ${e.period}`)).toEqual([
      "Natal: Bruno de 24/12/2026 18:00 a 26/12/2026 18:00",
      "Almoço de Natal: Ana de 25/12/2026 10:00 a 25/12/2026 14:00",
    ]);
  });
});

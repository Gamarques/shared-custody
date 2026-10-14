import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, sqlState, type TestDb } from "@/test/pg";
import { buildMonthCalendar, calendarRange } from "./calendar";
import type { CustodyOverride, CustodyRule } from "./holder";
import type { HomeMember } from "./today";

// T-10 / RF-06: the rows the calendar reads (CALENDAR_SELECT in src/app/calendario/page.tsx),
// under RLS. No new table: the existing family-only policies must cover the month query.
// Family 1 = Ana + Bruno, family 2 = Carla alone.

let t: TestDb;
let ana: string;
let bruno: string;
let carla: string;

const TZ = "Europe/Lisbon";
const OCTOBER = { year: 2026, month: 10 };

/** The calendar's reads for `userId`, with overrides limited to the days shown like the page. */
async function calendarData(userId: string | null, startIso: string, endIso: string) {
  return t.as(userId, async () => {
    const q = async <T>(sql: string, params: unknown[] = []) => (await t.db.query<T>(sql, params)).rows;
    const me = `(select family_id from members where user_id = auth.uid())`;
    return {
      members: await q<HomeMember>(`select id, display_name, color from members where family_id = ${me} order by created_at`),
      rules: await q<CustodyRule>(
        `select id, starts_on::text, first_member_id, handover_weekday, handover_time::text, valid_from::text,
                valid_to::text, to_json(created_at) #>> '{}' as created_at
         from custody_rules where family_id = ${me}`,
      ),
      overrides: await q<CustodyOverride>(
        `select id, to_json(starts_at) #>> '{}' as starts_at, to_json(ends_at) #>> '{}' as ends_at, member_id, reason,
                to_json(created_at) #>> '{}' as created_at
         from custody_overrides where family_id = ${me} and ends_at > $1 and starts_at < $2`,
        [startIso, endIso],
      ),
    };
  });
}

beforeAll(async () => {
  t = await createTestDb();
  ana = await t.createUser("ana@example.com");
  bruno = await t.createUser("bruno@example.com");
  carla = await t.createUser("carla@example.com");

  const f1 = await t.as(ana, async () => (await t.db.query<{ id: string }>("select create_family('F1', 'Ana', '#2f6f5e') as id")).rows[0].id);
  const token = await t.as(ana, async () => (await t.db.query<{ token: string }>("select token from create_invite(null)")).rows[0].token);
  await t.as(bruno, () => t.db.query("select accept_invite($1, 'Bruno', '#fde047')", [token]));
  await t.as(carla, () => t.db.query("select create_family('F2', 'Carla', '#1d4ed8')"));

  const anaMember = (await t.db.query<{ id: string }>("select id from members where user_id = $1", [ana])).rows[0].id;
  await t.as(ana, async () => {
    await t.db.query(
      `insert into custody_rules (family_id, starts_on, first_member_id, handover_weekday, handover_time)
       values ($1, '2026-01-04', $2, 0, '18:00')`,
      [f1, anaMember],
    );
    // One override in September (outside the October grid), one inside it, in Bruno's week.
    await t.db.query(
      `insert into custody_overrides (family_id, starts_at, ends_at, member_id, reason) values
       ($1, '2026-09-10 00:00+00', '2026-09-11 00:00+00', $2, 'Setembro'),
       ($1, '2026-10-07 00:00+00', '2026-10-08 00:00+00', $2, 'Aniversário')`,
      [f1, anaMember],
    );
  });
});

describe("calendar data under RLS", () => {
  const range = calendarRange(OCTOBER, TZ);
  const startIso = new Date(range.startMs).toISOString();
  const endIso = new Date(range.endMs).toISOString();

  it("gives a member the family's rule and only the overrides of the month shown", async () => {
    const data = await calendarData(ana, startIso, endIso);
    expect(data.rules).toHaveLength(1);
    expect(data.overrides.map((o) => o.reason)).toEqual(["Aniversário"]);

    const cal = buildMonthCalendar({ month: OCTOBER, now: new Date("2026-10-14T09:00:00Z"), timezone: TZ, ...data });
    const d7 = cal.weeks.flat().find((d) => d.date === "2026-10-07")!;
    expect(d7.segments.map((s) => [s.person?.name, s.reason])).toEqual([
      ["Bruno", null],
      ["Ana", "Aniversário"],
    ]);
    const handoverDays = cal.weeks.flat().filter((d) => d.handovers.some((h) => h.time === "18:00")).map((d) => d.date);
    expect(handoverDays).toEqual(["2026-10-04", "2026-10-11", "2026-10-18", "2026-10-25", "2026-11-01"]);
  });

  it("shows another family's user nothing of this family", async () => {
    const data = await calendarData(carla, startIso, endIso);
    expect(data.members.map((m) => m.display_name)).toEqual(["Carla"]);
    expect(data.rules).toEqual([]);
    expect(data.overrides).toEqual([]);
  });

  it("refuses anonymous callers", async () => {
    expect(await sqlState(calendarData(null, startIso, endIso))).toBe("42501");
  });
});

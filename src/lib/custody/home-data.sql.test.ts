import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, sqlState, type TestDb } from "@/test/pg";
import type { CustodyOverride, CustodyRule } from "./holder";
import { buildTodayView, type HomeMember } from "./today";

// T-09 / RF-05: the rows the home reads (HOME_SELECT in src/app/page.tsx), under RLS.
// PostgREST resolves the embedded select as joins run with the caller's role, so the same
// reads in SQL show what each user gets. Family 1 = Ana + Bruno, family 2 = Carla alone.

let t: TestDb;
let ana: string;
let bruno: string;
let carla: string;
let f1: string;

type Home = {
  timezone: string | null;
  members: HomeMember[];
  rules: CustodyRule[];
  overrides: CustodyOverride[];
  children: string[];
};

/** The home's reads for `userId`, filtered like the page (overrides not ended at `nowIso`). */
async function homeData(userId: string | null, nowIso: string): Promise<Home> {
  return t.as(userId, async () => {
    const q = async <T>(sql: string, params: unknown[] = []) => (await t.db.query<T>(sql, params)).rows;
    const me = `(select family_id from members where user_id = auth.uid())`;
    const [family] = await q<{ timezone: string }>(`select timezone from families where id = ${me}`);
    return {
      timezone: family?.timezone ?? null,
      members: await q<HomeMember>(`select id, display_name, color from members where family_id = ${me} order by created_at`),
      rules: await q<CustodyRule>(
        `select id, starts_on::text, first_member_id, handover_weekday, handover_time::text, valid_from::text,
                valid_to::text, to_json(created_at) #>> '{}' as created_at
         from custody_rules where family_id = ${me}`,
      ),
      overrides: await q<CustodyOverride>(
        `select id, to_json(starts_at) #>> '{}' as starts_at, to_json(ends_at) #>> '{}' as ends_at, member_id, reason,
                to_json(created_at) #>> '{}' as created_at
         from custody_overrides where family_id = ${me} and ends_at > $1`,
        [nowIso],
      ),
      children: (await q<{ name: string }>(`select name from children where family_id = ${me}`)).map((c) => c.name),
    };
  });
}

/** Same reads without the "own family" filter: whatever RLS lets the user see at all. */
async function visible(userId: string | null) {
  return t.as(userId, async () => {
    const count = async (table: string) =>
      (await t.db.query<{ n: number }>(`select count(*)::int as n from ${table} where family_id = $1`, [f1])).rows[0].n;
    return {
      members: await count("members"),
      custody_rules: await count("custody_rules"),
      custody_overrides: await count("custody_overrides"),
      children: await count("children"),
    };
  });
}

beforeAll(async () => {
  t = await createTestDb();
  ana = await t.createUser("ana@example.com");
  bruno = await t.createUser("bruno@example.com");
  carla = await t.createUser("carla@example.com");

  f1 = await t.as(ana, async () => (await t.db.query<{ id: string }>("select create_family('F1', 'Ana', '#2f6f5e') as id")).rows[0].id);
  const token = await t.as(ana, async () => (await t.db.query<{ token: string }>("select token from create_invite(null)")).rows[0].token);
  await t.as(bruno, () => t.db.query("select accept_invite($1, 'Bruno', '#fde047')", [token]));
  await t.as(carla, () => t.db.query("select create_family('F2', 'Carla', '#1d4ed8')"));

  const anaMember = (await t.db.query<{ id: string }>("select id from members where user_id = $1", [ana])).rows[0].id;
  const brunoMember = (await t.db.query<{ id: string }>("select id from members where user_id = $1", [bruno])).rows[0].id;
  await t.as(ana, async () => {
    await t.db.query("insert into children (family_id, name) values ($1, 'Lia')", [f1]);
    await t.db.query(
      `insert into custody_rules (family_id, starts_on, first_member_id, handover_weekday, handover_time)
       values ($1, '2026-01-04', $2, 0, '18:00')`,
      [f1, anaMember],
    );
    // One override already over, one in force on 2026-10-14.
    await t.db.query(
      `insert into custody_overrides (family_id, starts_at, ends_at, member_id, reason) values
       ($1, '2026-08-01 10:00+00', '2026-08-02 10:00+00', $2, 'Passado'),
       ($1, '2026-10-14 00:00+00', '2026-10-15 08:00+00', $2, 'Consulta')`,
      [f1, brunoMember],
    );
  });
});

describe("home data under RLS", () => {
  it("gives a member the whole family: both colors, the rule and the current override", async () => {
    const home = await homeData(bruno, "2026-10-14T09:00:00Z");
    expect(home.timezone).toBe("Europe/Lisbon");
    expect(home.members.map((m) => [m.display_name, m.color])).toEqual([
      ["Ana", "#2f6f5e"],
      ["Bruno", "#fde047"],
    ]);
    expect(home.rules).toHaveLength(1);
    expect(home.overrides.map((o) => o.reason)).toEqual(["Consulta"]);
    expect(home.children).toEqual(["Lia"]);

    // The rows feed the home view as the page does.
    const view = buildTodayView({
      now: new Date("2026-10-14T09:00:00Z"),
      timezone: home.timezone!,
      members: home.members,
      rules: home.rules,
      overrides: home.overrides,
      childName: home.children[0],
    });
    expect(view).toMatchObject({
      childName: "Lia",
      current: { name: "Bruno", color: "#fde047", reason: "Consulta" },
      next: { atMs: Date.parse("2026-10-15T08:00:00Z"), to: { name: "Ana", color: "#2f6f5e" } },
    });
  });

  it("shows another family's user nothing of this family", async () => {
    expect(await visible(carla)).toEqual({ members: 0, custody_rules: 0, custody_overrides: 0, children: 0 });
    const home = await homeData(carla, "2026-10-14T09:00:00Z");
    expect(home.members.map((m) => m.display_name)).toEqual(["Carla"]);
    expect(home.rules).toEqual([]);
    expect(home.overrides).toEqual([]);
  });

  it("refuses anonymous callers", async () => {
    // Privileges on these tables are revoked from anon, so the read fails instead of returning rows.
    expect(await sqlState(visible(null))).toBe("42501");
  });
});

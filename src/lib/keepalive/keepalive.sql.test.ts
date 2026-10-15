import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/test/pg";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});

describe("keepalive_ping (T-23, RNF-06)", () => {
  it("is callable by anon and authenticated and returns the database time", async () => {
    const user = await t.createUser("a@example.com");
    for (const who of [null, user]) {
      const { rows } = await t.as(who, () => t.db.query<{ at: Date }>("select public.keepalive_ping() as at"));
      expect(rows[0].at).toBeInstanceOf(Date);
    }
  });

  it("reads no table, so it cannot expose family data", async () => {
    const { rows } = await t.db.query<{ src: string; secdef: boolean }>(
      "select prosrc as src, prosecdef as secdef from pg_proc where proname = 'keepalive_ping'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].src.trim()).toBe("select now()");
    expect(rows[0].secdef).toBe(false);
  });
});

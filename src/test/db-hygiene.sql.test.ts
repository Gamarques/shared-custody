import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/test/pg";

// TODO-005: guards for the Supabase Advisor findings on schema shared_custody, so new
// migrations do not bring them back.

let t: TestDb;

beforeAll(async () => {
  t = await createTestDb();
});

describe("shared_custody database hygiene", () => {
  it("every function pins its search_path", async () => {
    const { rows } = await t.db.query<{ name: string }>(`
      select p.oid::regprocedure::text as name
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'shared_custody'
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
      order by 1`);
    expect(rows.map((r) => r.name)).toEqual([]);
  });

  it("every foreign key has an index starting with its columns", async () => {
    const { rows } = await t.db.query<{ name: string }>(`
      select c.conrelid::regclass::text || ' (' || c.conname || ')' as name
      from pg_constraint c join pg_namespace n on n.oid = c.connamespace
      where c.contype = 'f' and n.nspname = 'shared_custody'
        and not exists (
          select 1 from pg_index i
          where i.indrelid = c.conrelid
            and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] = c.conkey)
      order by 1`);
    expect(rows.map((r) => r.name)).toEqual([]);
  });

  it("policies call auth.uid() through a scalar subquery", async () => {
    const { rows } = await t.db.query<{ name: string }>(`
      select tablename || ': ' || policyname as name
      from pg_policies
      where schemaname = 'shared_custody'
        and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ 'auth\\.uid\\(\\)'
        and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) !~ 'SELECT auth\\.uid\\(\\)'
      order by 1`);
    expect(rows.map((r) => r.name)).toEqual([]);
  });
});

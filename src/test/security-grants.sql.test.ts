import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/test/pg";

// Security review 2026-11-04 (docs/security-review.md): what the API roles can reach in
// shared_custody, so a new migration cannot quietly widen it.

let t: TestDb;

beforeAll(async () => {
  t = await createTestDb();
});

async function names(sql: string): Promise<string[]> {
  const { rows } = await t.db.query<{ name: string }>(sql);
  return rows.map((r) => r.name);
}

describe("anon (no session)", () => {
  it("has no privilege on any shared_custody table", async () => {
    expect(
      await names(`
        select c.relname || ':' || p.priv as name
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        cross join unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p(priv)
        where n.nspname = 'shared_custody' and c.relkind in ('r', 'p', 'v', 'm')
          and has_table_privilege('anon', c.oid, p.priv)
        order by 1`),
    ).toEqual([]);
  });

  it("can execute no security definer function except claim_invite (keyed by the secret token) and is_family_member (false without a session)", async () => {
    // claim_invite (invite-only sign-up, 2026-11-07) is called by /login before the invitee has a
    // session: it only writes the claimed e-mail on the pending invite whose token is given.
    expect(
      await names(`
        select p.proname as name
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'shared_custody' and p.prosecdef and p.prorettype <> 'trigger'::regtype
          and has_function_privilege('anon', p.oid, 'execute')
        order by 1`),
    ).toEqual(["claim_invite", "is_family_member"]);
    const { rows } = await t.as(null, () => t.db.query<{ v: boolean }>("select shared_custody.is_family_member(id) as v from (select gen_random_uuid() as id) x"));
    expect(rows[0].v).toBe(false);
  });
});

describe("security definer functions", () => {
  it("are exactly the reviewed set, each pinning search_path", async () => {
    expect(
      await names(`
        select p.proname || case when exists (
                 select 1 from unnest(coalesce(p.proconfig, '{}')) c where c = 'search_path=shared_custody')
               then '' else ' (search_path not pinned)' end as name
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'shared_custody' and p.prosecdef
        order by 1`),
    ).toEqual([
      "accept_invite",
      "admin_delete_family",
      "admin_list_families",
      "admin_list_users",
      "admin_remove_member",
      // Added on purpose by 20261107000100_invite_only_signup.sql (invite-only sign-up).
      "claim_invite",
      "confirm_expense",
      "create_family",
      "create_invite",
      "decide_expense",
      "dispute_expense",
      "expenses_audit",
      "get_invite",
      // Added on purpose by the same migration: the Supabase Auth "Before User Created" hook,
      // executable only by supabase_auth_admin (checked below and in invite-signup.sql.test.ts).
      "hook_before_user_created",
      "is_app_admin",
      "is_family_member",
    ]);
  });

  it("the auth hook is executable only by supabase_auth_admin", async () => {
    expect(
      await names(`
        select r as name from unnest(array['public', 'anon', 'authenticated', 'supabase_auth_admin']) r
        where case when r = 'public'
                   then exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                                where p.oid = 'shared_custody.hook_before_user_created(jsonb)'::regprocedure
                                  and a.grantee = 0 and a.privilege_type = 'EXECUTE')
                   else has_function_privilege(r, 'shared_custody.hook_before_user_created(jsonb)', 'execute') end
        order by 1`),
    ).toEqual(["supabase_auth_admin"]);
  });

  it("each callable one checks the caller (auth.uid, is_app_admin or is_family_member)", async () => {
    const { rows } = await t.db.query<{ name: string; src: string }>(`
      select p.proname as name, p.prosrc as src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'shared_custody' and p.prosecdef and p.prorettype <> 'trigger'::regtype
        and has_function_privilege('authenticated', p.oid, 'execute')`);
    const unchecked = rows.filter((r) => !/auth\.uid\(\)|is_app_admin\(\)|is_family_member\(|decide_expense\(/.test(r.src));
    // claim_invite and get_invite are keyed by the secret invite token (~244 random bits)
    // instead: the invitee is not a member yet (and, for claim_invite, has no session yet).
    // get_invite returns only what the invite page shows; claim_invite only records an e-mail.
    expect(unchecked.map((r) => r.name).sort()).toEqual(["claim_invite", "get_invite"]);
    for (const r of unchecked) expect(r.src, r.name).toMatch(/where i\.token = invite_token/);
    // decide_expense itself is internal: only its two wrappers are callable.
    expect(rows.map((r) => r.name)).not.toContain("decide_expense");
  });
});

describe("receipts bucket", () => {
  it("is private and every storage policy on it is for signed-in members or admins only", async () => {
    const { rows: bucket } = await t.db.query<{ public: boolean }>("select public from storage.buckets where id = 'receipts'");
    expect(bucket).toEqual([{ public: false }]);
    const { rows } = await t.db.query<{ name: string; roles: string; expr: string }>(`
      select policyname as name, roles::text as roles, coalesce(qual, '') || ' ' || coalesce(with_check, '') as expr
      from pg_policies where schemaname = 'storage' and tablename = 'objects'`);
    expect(rows.length).toBeGreaterThan(0);
    for (const p of rows) {
      expect(p.roles, p.name).toBe("{authenticated}");
      expect(p.expr, p.name).toMatch(/bucket_id = 'receipts'/);
      expect(p.expr, p.name).toMatch(/is_family_member\((shared_custody\.)?receipt_family_id\(name\)\)|is_app_admin\(\)/);
    }
  });
});

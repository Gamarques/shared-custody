import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const MIGRATIONS_DIR = "supabase/migrations";

/**
 * Minimal stand-in for what Supabase provides before our migrations run:
 * the anon/authenticated roles, auth.users, auth.uid() and the default grants
 * that make RLS (not table privileges) the real access gate.
 */
const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema public, auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
create schema storage;
create table storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id),
  name text, owner uuid default auth.uid(), metadata jsonb
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
grant usage on schema storage to anon, authenticated;
grant execute on function storage.foldername(text) to anon, authenticated;
grant all on storage.objects, storage.buckets to anon, authenticated;
`;

export type TestDb = {
  db: PGlite;
  /** Runs fn as the `authenticated` role with auth.uid() = userId (null = anon). */
  as<T>(userId: string | null, fn: () => Promise<T>): Promise<T>;
  /** Creates an auth.users row and returns its id. */
  createUser(email: string): Promise<string>;
};

/** Fresh in-memory Postgres with every migration in supabase/migrations applied in order. */
export async function createTestDb(): Promise<TestDb> {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_STUB);
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  // The app's tables live in `shared_custody` (migration 20261014000000); tests query them unqualified.
  await db.exec("set search_path = shared_custody, public");

  return {
    db,
    async as(userId, fn) {
      await db.exec(userId ? "set role authenticated" : "set role anon");
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
      try {
        return await fn();
      } finally {
        await db.exec("reset role");
        await db.query("select set_config('request.jwt.claim.sub', '', false)");
      }
    },
    async createUser(email) {
      const { rows } = await db.query<{ id: string }>(
        "insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id",
        [email],
      );
      return rows[0].id;
    },
  };
}

/** SQLSTATE of a failed query, or null if it succeeded. */
export async function sqlState(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? "unknown";
  }
}

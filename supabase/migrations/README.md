# Supabase migrations

SQL migrations live here, named `<timestamp>_<description>.sql`, and are applied in order by
`supabase db push` (linked project) or `supabase db reset` (local stack).

All 9 tables of "Modelo de dados" (`docs/plano-mvp.md`) exist after T-05
(`20261014000300_core_schema_rls.sql`). Every new table must enable RLS in the same migration
that creates it, use composite foreign keys `(member_id, family_id) -> members(id, family_id)`
for member references, and be added to `TABLES` in `src/test/rls-isolation.sql.test.ts`
(the test fails if a public table is missing from that list or has RLS disabled).

## Tests

`src/test/pg.ts` applies every migration here, in order, to an in-memory Postgres (PGlite) on
top of a small Supabase stub (`anon`/`authenticated` roles, `auth.users`, `auth.uid()`, default
grants). Tests use `as(userId, fn)` to run queries as a signed-in user so RLS is exercised for
real. See `src/lib/invites/invites.sql.test.ts`. Migrations must stay plain SQL that PGlite can run.

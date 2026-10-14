# Supabase migrations

SQL migrations live here, named `<timestamp>_<description>.sql`, and are applied in order by
`supabase db push` (linked project) or `supabase db reset` (local stack).

T-01 creates no tables. The initial schema, `is_family_member()` and the RLS policies for every
table (see "Modelo de dados" in `docs/plano-mvp.md`) arrive in T-05. Every new table must enable
RLS in the same migration that creates it.

-- Dedicated schema for this app. The Supabase project also hosts unrelated tables in `public`,
-- so everything here lives in `shared_custody`. The schema must also be listed in the API's
-- exposed schemas (Settings > API, or `alter role authenticator set pgrst.db_schemas`), and the
-- clients select it with `db: { schema: "shared_custody" }` (src/lib/supabase/schema.ts).

create schema if not exists shared_custody;

grant usage on schema shared_custody to anon, authenticated, service_role;

-- Same defaults Supabase sets for `public`; the RLS migration (T-05) then narrows them.
alter default privileges in schema shared_custody grant all on tables to anon, authenticated, service_role;
alter default privileges in schema shared_custody grant all on functions to anon, authenticated, service_role;
alter default privileges in schema shared_custody grant all on sequences to anon, authenticated, service_role;

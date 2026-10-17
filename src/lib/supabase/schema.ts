/**
 * Postgres schema that holds this app's tables and functions. The Supabase project also has
 * unrelated tables in `public`, so every client selects this schema. It must be listed in the
 * API's exposed schemas (see supabase/migrations/20261014000000_schema.sql).
 */
export const DB_SCHEMA = "shared_custody";

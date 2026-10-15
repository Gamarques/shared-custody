-- T-23: keep the free Supabase project from pausing (RNF-06).
--
-- A free project is paused after about 7 days without activity. A Vercel cron calls
-- /api/cron/keepalive twice a week, which calls this function through PostgREST
-- (POST /rest/v1/rpc/keepalive_ping) so a real query reaches Postgres.
--
-- The function reads no table and returns only the database time, so it is safe for the anon
-- role and needs no RLS: no family data can leak through it.
create function public.keepalive_ping() returns timestamptz
language sql stable set search_path = public as $$
  select now()
$$;

revoke execute on function public.keepalive_ping() from public;
grant execute on function public.keepalive_ping() to anon, authenticated;

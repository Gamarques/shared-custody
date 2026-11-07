-- Invite-only sign-up (owner decision 2026-11-07).
--
-- The e-mail magic link stays the only normal way to sign in, but a new auth user may only be
-- created by someone holding a valid invite link. Two pieces:
--
-- 1. claim_invite(token, e-mail): called by the login page (anon) before it asks Supabase Auth
--    for a magic link that may create the user. It writes the e-mail on the pending invite
--    (claimed_email / claimed_at). The token is the secret (~244 random bits), so whoever holds
--    it may claim; a later claim with another e-mail overwrites the earlier one.
-- 2. hook_before_user_created(event): the Supabase Auth "Before User Created" hook. It lets a
--    new user through only when their e-mail was claimed on a pending, unexpired invite in the
--    last hour, or is the e-mail lock (invites.email) of a pending, unexpired invite. Everything
--    else gets the documented error object (HTTP 403, "signup_requires_invite").
--
-- The hook is enabled outside the migrations (docs/MANUAL-STEPS.md, "Registo só por convite").
-- Existing users are not affected: the hook runs only when a user is about to be created.
-- accept_invite is unchanged: it still checks the e-mail lock against the signed-in user.
--
-- Error codes (SQLSTATE) raised by claim_invite, mapped in src/lib/invites/invites.ts:
--   IV001 invite not found   IV002 invite already used   IV003 invite expired
--   IV004 invite for other e-mail   IV005 family already full (same as get_invite's 'full')
--   IV009 invalid e-mail      IV010 too many claims for this invite (5 per 10 minutes)

alter table shared_custody.invites
  add column claimed_email text
    check (claimed_email is null
           or (claimed_email = lower(claimed_email)
               and claimed_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
  add column claimed_at timestamptz,
  -- Abuse limit: claims counted in a 10-minute window that starts at claim_window_start.
  add column claim_count integer not null default 0,
  add column claim_window_start timestamptz;

-- The hook looks invites up by e-mail; both lookups only care about pending invites.
create index invites_claimed_email_pending_idx on shared_custody.invites (claimed_email)
  where accepted_at is null and claimed_email is not null;
create index invites_email_pending_idx on shared_custody.invites (email)
  where accepted_at is null and email is not null;

create function shared_custody.claim_invite(invite_token text, invite_email text) returns void
language plpgsql security definer set search_path = shared_custody as $$
declare
  clean_email text := lower(btrim(coalesce(invite_email, '')));
  inv shared_custody.invites%rowtype;
begin
  if clean_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(clean_email) > 320 then
    raise exception 'invalid e-mail' using errcode = 'IV009';
  end if;
  select * into inv from shared_custody.invites i where i.token = invite_token for update;
  if not found then
    raise exception 'invite not found' using errcode = 'IV001';
  end if;
  if inv.accepted_at is not null then
    raise exception 'invite already used' using errcode = 'IV002';
  end if;
  if inv.expires_at <= now() then
    raise exception 'invite expired' using errcode = 'IV003';
  end if;
  if (select count(*) from shared_custody.members m where m.family_id = inv.family_id) >= 2 then
    raise exception 'family already has 2 members' using errcode = 'IV005';
  end if;
  if inv.email is not null and inv.email <> clean_email then
    raise exception 'invite is for another e-mail' using errcode = 'IV004';
  end if;
  if inv.claim_window_start is not null and inv.claim_window_start > now() - interval '10 minutes'
     and inv.claim_count >= 5 then
    raise exception 'too many claims for this invite' using errcode = 'IV010';
  end if;
  update shared_custody.invites i
     set claimed_email = clean_email,
         claimed_at = now(),
         claim_count = case when i.claim_window_start is not null
                              and i.claim_window_start > now() - interval '10 minutes'
                            then i.claim_count + 1 else 1 end,
         claim_window_start = case when i.claim_window_start is not null
                                     and i.claim_window_start > now() - interval '10 minutes'
                                   then i.claim_window_start else now() end
   where i.id = inv.id;
end;
$$;

-- The login page calls it before the person has a session, so anon may execute it.
revoke all on function shared_custody.claim_invite(text, text) from public, anon, authenticated;
grant execute on function shared_custody.claim_invite(text, text) to anon, authenticated;

-- Supabase Auth "Before User Created" hook. Event: { "metadata": {...}, "user": { "email", ... } }.
-- Allow: '{}'. Reject: { "error": { "http_code": 403, "message": "signup_requires_invite" } }.
-- Never raises: any unexpected input or error also returns the reject object, so a bad event
-- cannot create a user nor turn into a 500 from Auth.
create function shared_custody.hook_before_user_created(event jsonb) returns jsonb
language plpgsql security definer stable set search_path = shared_custody as $$
declare
  reject constant jsonb := jsonb_build_object(
    'error', jsonb_build_object('http_code', 403, 'message', 'signup_requires_invite'));
  user_email text;
begin
  begin
    if jsonb_typeof(event) is distinct from 'object'
       or jsonb_typeof(event -> 'user') is distinct from 'object'
       or jsonb_typeof(event -> 'user' -> 'email') is distinct from 'string' then
      return reject;
    end if;
    user_email := lower(btrim(event -> 'user' ->> 'email'));
    if user_email is null or user_email = '' then
      return reject;
    end if;
    if exists (
      select 1 from shared_custody.invites i
       where i.accepted_at is null
         and i.expires_at > now()
         and ((i.claimed_email = user_email and i.claimed_at > now() - interval '1 hour')
              or i.email = user_email)
    ) then
      return '{}'::jsonb;
    end if;
    return reject;
  exception when others then
    return reject;
  end;
end;
$$;

revoke all on function shared_custody.hook_before_user_created(jsonb) from public, anon, authenticated;
grant usage on schema shared_custody to supabase_auth_admin;
grant execute on function shared_custody.hook_before_user_created(jsonb) to supabase_auth_admin;

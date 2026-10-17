-- T-04: invite the second responsible adult by link (RF-02).
-- The invitee is not a member yet, so invites are read and accepted only through
-- security definer functions keyed by the secret token. Max 2 members per family is
-- enforced here (create_invite / accept_invite) and, as a last guard, by members_max_two.

create table shared_custody.invites (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references shared_custody.families(id) on delete cascade,
  -- Optional: when set, only a user signed in with this e-mail can accept.
  email text check (email is null or email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  -- 64 hex chars from two v4 UUIDs (~244 random bits); core Postgres, no pgcrypto schema issues.
  token text not null unique
    default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index invites_family_id_idx on shared_custody.invites(family_id);

alter table shared_custody.invites enable row level security;

-- Members see and revoke their family's pending invites. No insert/update policies:
-- invites are created by create_invite() and consumed by accept_invite().
create policy "members read invites" on shared_custody.invites
  for select using (shared_custody.is_family_member(family_id));
create policy "members revoke pending invites" on shared_custody.invites
  for delete using (shared_custody.is_family_member(family_id) and accepted_at is null);

-- Error codes (SQLSTATE) used by the functions below and mapped to messages in
-- src/lib/invites/invites.ts:
--   IV001 invite not found       IV002 invite already used    IV003 invite expired
--   IV004 invite for other e-mail IV005 family already full    IV006 color already used
--   IV007 user already in a family IV008 caller has no family

-- A member creates (or replaces) the family's single pending invite and gets its token.
create function shared_custody.create_invite(invite_email text default null)
returns table (token text, expires_at timestamptz)
language plpgsql security definer set search_path = shared_custody as $$
declare
  uid uuid := auth.uid();
  fid uuid;
  clean_email text := nullif(lower(btrim(invite_email)), '');
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select m.family_id into fid from shared_custody.members m where m.user_id = uid;
  if fid is null then
    raise exception 'caller has no family' using errcode = 'IV008';
  end if;
  perform 1 from shared_custody.families f where f.id = fid for update;
  if (select count(*) from shared_custody.members m where m.family_id = fid) >= 2 then
    raise exception 'family already has 2 members' using errcode = 'IV005';
  end if;
  -- Only the newest link works: older pending links are revoked.
  delete from shared_custody.invites i where i.family_id = fid and i.accepted_at is null;
  return query
    insert into shared_custody.invites as i (family_id, email, created_by)
    values (fid, clean_email, uid)
    returning i.token, i.expires_at;
end;
$$;

-- What the invite page shows before accepting. Returns no row for an unknown token.
-- status: valid | expired | accepted | full
create function shared_custody.get_invite(invite_token text)
returns table (family_name text, inviter_name text, invited_email text, status text,
               expires_at timestamptz, taken_colors text[])
language sql security definer stable set search_path = shared_custody as $$
  select
    f.name,
    (select m.display_name from shared_custody.members m
      where m.family_id = f.id order by m.created_at limit 1),
    i.email,
    case
      when i.accepted_at is not null then 'accepted'
      when (select count(*) from shared_custody.members m where m.family_id = f.id) >= 2 then 'full'
      when i.expires_at <= now() then 'expired'
      else 'valid'
    end,
    i.expires_at,
    coalesce((select array_agg(m.color) from shared_custody.members m where m.family_id = f.id), '{}')
  from shared_custody.invites i
  join shared_custody.families f on f.id = i.family_id
  where i.token = invite_token;
$$;

-- The signed-in invitee joins the family as 'member'. Single use.
create function shared_custody.accept_invite(
  invite_token text,
  member_display_name text,
  member_color text
) returns uuid
language plpgsql security definer set search_path = shared_custody as $$
declare
  uid uuid := auth.uid();
  inv shared_custody.invites%rowtype;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if exists (select 1 from shared_custody.members where user_id = uid) then
    raise exception 'user already belongs to a family' using errcode = 'IV007';
  end if;
  select * into inv from shared_custody.invites where token = invite_token for update;
  if not found then
    raise exception 'invite not found' using errcode = 'IV001';
  end if;
  if inv.accepted_at is not null then
    raise exception 'invite already used' using errcode = 'IV002';
  end if;
  if inv.expires_at <= now() then
    raise exception 'invite expired' using errcode = 'IV003';
  end if;
  if inv.email is not null
     and inv.email <> (select lower(u.email) from auth.users u where u.id = uid) then
    raise exception 'invite is for another e-mail' using errcode = 'IV004';
  end if;
  perform 1 from shared_custody.families where id = inv.family_id for update;
  if (select count(*) from shared_custody.members where family_id = inv.family_id) >= 2 then
    raise exception 'family already has 2 members' using errcode = 'IV005';
  end if;
  if exists (select 1 from shared_custody.members
             where family_id = inv.family_id and lower(color) = lower(member_color)) then
    raise exception 'color already used' using errcode = 'IV006';
  end if;
  insert into shared_custody.members (family_id, user_id, display_name, color, role)
  values (inv.family_id, uid, btrim(member_display_name), member_color, 'member');
  update shared_custody.invites set accepted_at = now(), accepted_by = uid where id = inv.id;
  return inv.family_id;
end;
$$;

revoke all on function shared_custody.create_invite(text) from public, anon;
revoke all on function shared_custody.get_invite(text) from public, anon;
revoke all on function shared_custody.accept_invite(text, text, text) from public, anon;
grant execute on function shared_custody.create_invite(text) to authenticated;
grant execute on function shared_custody.get_invite(text) to authenticated;
grant execute on function shared_custody.accept_invite(text, text, text) to authenticated;

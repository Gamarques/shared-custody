-- Platform administrators: a few auth users who see and manage every family and user (/admin).
--
-- Who is an admin lives in app_admins. Clients never read or write that table: it has RLS on and
-- no policy, and anon/authenticated have no privilege on it. Everything an admin does goes
-- through the security definer functions below, which first check is_app_admin() for the
-- caller's token and raise insufficient_privilege (42501) otherwise. No e-mail is seeded here:
-- the owner adds their own row once from the SQL editor (docs/MANUAL-STEPS.md, "Admin").
--
-- Deleting a family needs no bypass of the append-only rules. The table owner (these functions
-- run as it) may delete a families row, and the existing cascades already erase what hangs from
-- it: expense_audit_immutable lets an audit row go only when its family row is gone, custody
-- rules and settlements have no delete guard for the owner, only revoked client privileges.
-- So none of the existing triggers or policies is changed, and a normal member stays exactly as
-- blocked as before, whatever session settings they set.
--
-- Receipts in Storage are not deleted here: a row deleted from storage.objects by SQL leaves the
-- file in the bucket. The app removes them through the Storage API with the admin's session
-- after the family is gone (src/app/admin/actions.ts), which the two storage policies at the
-- end allow.

-- Admins ------------------------------------------------------------------------------------------

create table shared_custody.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table shared_custody.app_admins enable row level security;
revoke all on shared_custody.app_admins from anon, authenticated;

-- True when the caller's token belongs to an admin. Security definer so it can read app_admins.
create function shared_custody.is_app_admin() returns boolean
language sql security definer stable set search_path = shared_custody as $$
  select exists (select 1 from shared_custody.app_admins a where a.user_id = (select auth.uid()));
$$;

revoke all on function shared_custody.is_app_admin() from public, anon;
grant execute on function shared_custody.is_app_admin() to authenticated;

-- Log of admin mutations ----------------------------------------------------------------------------

create table shared_custody.admin_actions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('remove_member', 'delete_family')),
  -- What was acted on, copied at the time (the family or member row is gone afterwards).
  target jsonb not null,
  at timestamptz not null default now()
);

create index admin_actions_admin_id_idx on shared_custody.admin_actions (admin_id);

alter table shared_custody.admin_actions enable row level security;

-- Written only by the admin functions; admins read it.
create policy "admins read admin actions" on shared_custody.admin_actions
  for select to authenticated using ((select shared_custody.is_app_admin()));

revoke all on shared_custody.admin_actions from anon, authenticated;
grant select on shared_custody.admin_actions to authenticated;

-- Reads -------------------------------------------------------------------------------------------

-- Every family with its members and a few counters, newest first.
create function shared_custody.admin_list_families()
returns table (
  id uuid,
  name text,
  currency text,
  timezone text,
  created_at timestamptz,
  members jsonb,
  children_count integer,
  expenses_count integer,
  open_expenses_count integer,
  last_activity_at timestamptz
)
language plpgsql security definer stable set search_path = shared_custody as $$
begin
  if not shared_custody.is_app_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return query
    select
      f.id,
      f.name,
      f.currency,
      f.timezone,
      f.created_at,
      coalesce((
        select jsonb_agg(jsonb_build_object(
                 'member_id', m.id,
                 'user_id', m.user_id,
                 'email', u.email,
                 'display_name', m.display_name,
                 'color', m.color,
                 'role', m.role,
                 'joined_at', m.created_at)
               order by m.created_at)
        from shared_custody.members m
        left join auth.users u on u.id = m.user_id
        where m.family_id = f.id), '[]'::jsonb),
      (select count(*)::integer from shared_custody.children c where c.family_id = f.id),
      (select count(*)::integer from shared_custody.expenses e
        where e.family_id = f.id and e.deleted_at is null),
      (select count(*)::integer from shared_custody.expenses e
        where e.family_id = f.id and e.deleted_at is null and e.status in ('pending', 'disputed')),
      greatest(
        f.created_at,
        (select max(m.created_at) from shared_custody.members m where m.family_id = f.id),
        (select max(c.created_at) from shared_custody.children c where c.family_id = f.id),
        (select max(r.created_at) from shared_custody.custody_rules r where r.family_id = f.id),
        (select max(o.created_at) from shared_custody.custody_overrides o where o.family_id = f.id),
        (select max(a.changed_at) from shared_custody.expense_audit a where a.family_id = f.id),
        (select max(s.created_at) from shared_custody.settlements s where s.family_id = f.id))
    from shared_custody.families f
    order by f.created_at desc, f.id;
end;
$$;

-- Every auth user, whether or not they have a family, newest first.
create function shared_custody.admin_list_users()
returns table (
  id uuid,
  email text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  is_admin boolean,
  families jsonb
)
language plpgsql security definer stable set search_path = shared_custody as $$
begin
  if not shared_custody.is_app_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return query
    select
      u.id,
      u.email::text,
      u.created_at,
      u.last_sign_in_at,
      exists (select 1 from shared_custody.app_admins a where a.user_id = u.id),
      coalesce((
        select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name) order by f.created_at)
        from shared_custody.members m
        join shared_custody.families f on f.id = m.family_id
        where m.user_id = u.id), '[]'::jsonb)
    from auth.users u
    order by u.created_at desc, u.id;
end;
$$;

-- Mutations ---------------------------------------------------------------------------------------
-- Error codes: 42501 caller is not an admin; P0002 family or member not found;
-- AD001 the member paid expenses or is in settlements (their member row is referenced by
-- financial history, which is never rewritten: delete the whole family instead).

-- Removes one member from a family. Their custody rule versions and overrides go with them (the
-- foreign keys cascade, as designed in T-05/T-08), and so do the pending invites they created
-- for that family. The auth user is kept: on the next visit they are sent to onboarding.
create function shared_custody.admin_remove_member(p_family_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = shared_custody as $$
declare
  m shared_custody.members%rowtype;
  fam_name text;
begin
  if not shared_custody.is_app_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  select f.name into fam_name from shared_custody.families f where f.id = p_family_id for update;
  if not found then
    raise exception 'family not found' using errcode = 'P0002';
  end if;
  select * into m from shared_custody.members mm
    where mm.family_id = p_family_id and mm.user_id = p_user_id for update;
  if not found then
    raise exception 'member not found' using errcode = 'P0002';
  end if;

  if exists (select 1 from shared_custody.expenses e where e.family_id = p_family_id and e.paid_by = m.id)
     or exists (select 1 from shared_custody.settlements s
                where s.family_id = p_family_id and m.id in (s.from_member, s.to_member)) then
    raise exception 'member has expenses or settlements' using errcode = 'AD001';
  end if;

  insert into shared_custody.admin_actions (admin_id, action, target)
  values ((select auth.uid()), 'remove_member', jsonb_build_object(
    'family_id', p_family_id,
    'family_name', fam_name,
    'user_id', p_user_id,
    'email', (select u.email from auth.users u where u.id = p_user_id),
    'display_name', m.display_name));

  delete from shared_custody.invites i
   where i.family_id = p_family_id and i.created_by = p_user_id and i.accepted_at is null;
  delete from shared_custody.members mm where mm.id = m.id;
end;
$$;

-- Deletes a family and everything under it (members, invites, child, rule versions, overrides,
-- expenses with their audit trail, settlements). Irreversible. Receipt files: see the header.
create function shared_custody.admin_delete_family(p_family_id uuid) returns void
language plpgsql security definer set search_path = shared_custody as $$
declare
  fam shared_custody.families%rowtype;
begin
  if not shared_custody.is_app_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  select * into fam from shared_custody.families f where f.id = p_family_id for update;
  if not found then
    raise exception 'family not found' using errcode = 'P0002';
  end if;

  insert into shared_custody.admin_actions (admin_id, action, target)
  values ((select auth.uid()), 'delete_family', jsonb_build_object(
    'family_id', fam.id,
    'family_name', fam.name,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'email', u.email, 'display_name', m.display_name))
      from shared_custody.members m left join auth.users u on u.id = m.user_id
      where m.family_id = fam.id), '[]'::jsonb),
    'expenses', (select count(*) from shared_custody.expenses e where e.family_id = fam.id),
    'settlements', (select count(*) from shared_custody.settlements s where s.family_id = fam.id)));

  delete from shared_custody.families f where f.id = fam.id;
end;
$$;

revoke all on function shared_custody.admin_list_families() from public, anon;
revoke all on function shared_custody.admin_list_users() from public, anon;
revoke all on function shared_custody.admin_remove_member(uuid, uuid) from public, anon;
revoke all on function shared_custody.admin_delete_family(uuid) from public, anon;
grant execute on function shared_custody.admin_list_families() to authenticated;
grant execute on function shared_custody.admin_list_users() to authenticated;
grant execute on function shared_custody.admin_remove_member(uuid, uuid) to authenticated;
grant execute on function shared_custody.admin_delete_family(uuid) to authenticated;

-- Receipts of a deleted family ----------------------------------------------------------------------
-- An admin may list and remove receipt files of any family folder, so /admin can clear the files
-- of a family it deleted (Storage API remove = select + delete on storage.objects). Admins get no
-- upload or replace right.

create policy "receipts: admins read" on storage.objects
  for select to authenticated
  using (bucket_id = 'receipts' and (select shared_custody.is_app_admin()));

create policy "receipts: admins remove" on storage.objects
  for delete to authenticated
  using (bucket_id = 'receipts' and (select shared_custody.is_app_admin()));

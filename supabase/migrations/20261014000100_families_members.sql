-- T-03: families and members (RF-02, RF-03). Remaining tables arrive in T-05.

create extension if not exists pgcrypto;

create table public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  timezone text not null default 'Europe/Lisbon',
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  default_payer_share_bps integer not null default 5000
    check (default_payer_share_bps between 0 and 10000),
  created_at timestamptz not null default now()
);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 40),
  color text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now()
);

create index members_family_id_idx on public.members(family_id);

alter table public.families enable row level security;
alter table public.members enable row level security;

create function public.is_family_member(fid uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.members
    where family_id = fid and user_id = auth.uid()
  );
$$;

-- Max 2 responsible adults per family.
create function public.enforce_max_two_members() returns trigger
language plpgsql as $$
begin
  perform 1 from public.families where id = new.family_id for update;
  if (select count(*) from public.members where family_id = new.family_id) >= 2 then
    raise exception 'family already has 2 members' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger members_max_two before insert on public.members
  for each row execute function public.enforce_max_two_members();

-- Families: members read and update; creation only through create_family().
create policy "members read family" on public.families
  for select using (public.is_family_member(id));
create policy "members update family" on public.families
  for update using (public.is_family_member(id)) with check (public.is_family_member(id));

-- Members: read the family's members; edit only own display name and color.
-- No direct insert/delete: rows are created by create_family() / invite acceptance (T-04).
create policy "members read members" on public.members
  for select using (public.is_family_member(family_id));
create policy "member updates self" on public.members
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_family_member(family_id));

-- Prevent moving a row to another family or user, or changing role, via UPDATE.
create function public.members_immutable_keys() returns trigger
language plpgsql as $$
begin
  if new.family_id <> old.family_id or new.user_id <> old.user_id or new.role <> old.role then
    raise exception 'family_id, user_id and role are immutable';
  end if;
  return new;
end;
$$;

create trigger members_immutable before update on public.members
  for each row execute function public.members_immutable_keys();

-- Onboarding: creates the family and the caller's owner membership atomically.
create function public.create_family(
  family_name text,
  member_display_name text,
  member_color text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  fid uuid;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if exists (select 1 from public.members where user_id = uid) then
    raise exception 'user already belongs to a family' using errcode = 'unique_violation';
  end if;
  insert into public.families (name) values (btrim(family_name)) returning id into fid;
  insert into public.members (family_id, user_id, display_name, color, role)
  values (fid, uid, btrim(member_display_name), member_color, 'owner');
  return fid;
end;
$$;

revoke all on function public.create_family(text, text, text) from public, anon;
grant execute on function public.create_family(text, text, text) to authenticated;

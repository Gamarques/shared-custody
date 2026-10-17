-- T-05: remaining tables of the data model, RLS on all of them, and privilege hardening (RNF-01).
--
-- Isolation rests on three layers:
--   1. RLS on every table: a row is visible and writable only when is_family_member(family_id).
--      A user belongs to at most one family (members.user_id is unique), so the WITH CHECK
--      clause also stops rows from being moved into another family by UPDATE.
--   2. Composite foreign keys (member_id, family_id) -> members(id, family_id), so a row of
--      family A can never point at a member of family B, even when the caller writes into
--      their own family.
--   3. Table privileges: anon gets nothing; authenticated loses TRUNCATE (which bypasses RLS),
--      REFERENCES and TRIGGER.
--
-- Money is integer cents (RNF-02); shares are basis points (5000 = 50%).
-- Business rules that belong to later tasks (audit trigger T-17, confirm/dispute T-16,
-- custody versioning T-08) refine these tables; the isolation baseline is set here.

-- Targets for the composite foreign keys.
alter table shared_custody.members add constraint members_id_family_key unique (id, family_id);

-- Children ------------------------------------------------------------------------------------

create table shared_custody.children (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references shared_custody.families(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  birth_date date,
  created_at timestamptz not null default now()
);

create index children_family_id_idx on shared_custody.children(family_id);

-- Custody rules (RF-04). A rule change creates a new row with a later valid_from.
-- handover_weekday: 0 = Sunday ... 6 = Saturday (same as extract(dow) and Date#getDay).

create table shared_custody.custody_rules (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references shared_custody.families(id) on delete cascade,
  starts_on date not null,
  first_member_id uuid not null,
  handover_weekday smallint not null check (handover_weekday between 0 and 6),
  handover_time time not null,
  valid_from date not null,
  valid_to date,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (first_member_id, family_id) references shared_custody.members(id, family_id) on delete cascade,
  check (extract(dow from starts_on) = handover_weekday),
  check (valid_to is null or valid_to > valid_from)
);

create index custody_rules_family_id_idx on shared_custody.custody_rules(family_id, valid_from);

-- Custody overrides (RF-07): override wins over the rule; the latest created wins on overlap.

create table shared_custody.custody_overrides (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references shared_custody.families(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  member_id uuid not null,
  reason text not null check (char_length(btrim(reason)) between 1 and 200),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (member_id, family_id) references shared_custody.members(id, family_id) on delete cascade,
  check (ends_at > starts_at)
);

create index custody_overrides_family_id_idx on shared_custody.custody_overrides(family_id, starts_at);

-- Expenses (RF-08..RF-11, RF-17). Logical delete only: deleted_at, never a DELETE.

create table shared_custody.expenses (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references shared_custody.families(id) on delete cascade,
  paid_by uuid not null,
  amount_cents integer not null check (amount_cents > 0),
  spent_on date not null,
  description text not null check (char_length(btrim(description)) between 1 and 200),
  category text not null default 'outros' check (category in
    ('saude', 'escola', 'alimentacao', 'vestuario', 'lazer', 'transporte', 'outros')),
  -- Filled from families.default_payer_share_bps when omitted (expenses_default_share).
  payer_share_bps integer not null check (payer_share_bps between 0 and 10000),
  receipt_path text,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'disputed')),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (paid_by, family_id) references shared_custody.members(id, family_id),
  unique (id, family_id)
);

create index expenses_family_spent_on_idx on shared_custody.expenses(family_id, spent_on);

create function shared_custody.expenses_default_share() returns trigger
language plpgsql set search_path = shared_custody as $$
begin
  if new.payer_share_bps is null then
    select f.default_payer_share_bps into new.payer_share_bps
    from shared_custody.families f where f.id = new.family_id;
  end if;
  return new;
end;
$$;

create trigger expenses_default_share before insert on shared_custody.expenses
  for each row execute function shared_custody.expenses_default_share();

-- Settlements (RF-14): a payment from one member to the other.

create table shared_custody.settlements (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references shared_custody.families(id) on delete cascade,
  from_member uuid not null,
  to_member uuid not null,
  amount_cents integer not null check (amount_cents > 0),
  settled_on date not null,
  note text check (note is null or char_length(note) <= 200),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (from_member, family_id) references shared_custody.members(id, family_id),
  foreign key (to_member, family_id) references shared_custody.members(id, family_id),
  check (from_member <> to_member)
);

create index settlements_family_id_idx on shared_custody.settlements(family_id, settled_on);

-- Expense audit (RF-12, RNF-03). Written only by the audit trigger (T-17); members read it.

create table shared_custody.expense_audit (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null,
  family_id uuid not null,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now(),
  action text not null check (action in ('insert', 'update', 'delete')),
  old_data jsonb,
  new_data jsonb,
  foreign key (expense_id, family_id) references shared_custody.expenses(id, family_id) on delete cascade
);

create index expense_audit_expense_id_idx on shared_custody.expense_audit(expense_id, changed_at);
create index expense_audit_family_id_idx on shared_custody.expense_audit(family_id);

-- created_by is the signed-in caller on insert and never changes afterwards, whatever the
-- client sends. (Without a JWT, e.g. the SQL editor or service role, the given value is kept.)

create function shared_custody.set_created_by() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;

create trigger custody_rules_created_by before insert or update on shared_custody.custody_rules
  for each row execute function shared_custody.set_created_by();
create trigger custody_overrides_created_by before insert or update on shared_custody.custody_overrides
  for each row execute function shared_custody.set_created_by();
create trigger expenses_created_by before insert or update on shared_custody.expenses
  for each row execute function shared_custody.set_created_by();
create trigger settlements_created_by before insert or update on shared_custody.settlements
  for each row execute function shared_custody.set_created_by();

-- RLS -----------------------------------------------------------------------------------------

alter table shared_custody.children enable row level security;
alter table shared_custody.custody_rules enable row level security;
alter table shared_custody.custody_overrides enable row level security;
alter table shared_custody.expenses enable row level security;
alter table shared_custody.settlements enable row level security;
alter table shared_custody.expense_audit enable row level security;

create policy "family members only" on shared_custody.children
  for all using (shared_custody.is_family_member(family_id))
  with check (shared_custody.is_family_member(family_id));

create policy "family members only" on shared_custody.custody_rules
  for all using (shared_custody.is_family_member(family_id))
  with check (shared_custody.is_family_member(family_id));

create policy "family members only" on shared_custody.custody_overrides
  for all using (shared_custody.is_family_member(family_id))
  with check (shared_custody.is_family_member(family_id));

-- Expenses: no DELETE policy (logical delete through deleted_at).
create policy "members read expenses" on shared_custody.expenses
  for select using (shared_custody.is_family_member(family_id));
create policy "members insert expenses" on shared_custody.expenses
  for insert with check (shared_custody.is_family_member(family_id));
create policy "members update expenses" on shared_custody.expenses
  for update using (shared_custody.is_family_member(family_id))
  with check (shared_custody.is_family_member(family_id));

create policy "family members only" on shared_custody.settlements
  for all using (shared_custody.is_family_member(family_id))
  with check (shared_custody.is_family_member(family_id));

-- Audit: read only. No insert/update/delete policy, and the privileges are revoked below.
create policy "members read audit" on shared_custody.expense_audit
  for select using (shared_custody.is_family_member(family_id));

-- Privileges ----------------------------------------------------------------------------------
-- Supabase grants ALL on public tables to anon and authenticated by default. The app talks to
-- the database only as a signed-in user, so anon gets nothing. TRUNCATE ignores RLS, so it is
-- revoked for both roles. Audit rows are never changed by a client.

revoke all on all tables in schema shared_custody from anon;
revoke truncate, references, trigger on all tables in schema shared_custody from authenticated;
revoke insert, update, delete on shared_custody.expense_audit from authenticated;

alter default privileges in schema shared_custody revoke all on tables from anon;
alter default privileges in schema shared_custody revoke truncate, references, trigger on tables from authenticated;

-- T-17: expense audit trail (RF-12, RNF-03).
--
-- Every creation, edit and deletion of an expense writes one row in expense_audit, from a
-- trigger, with the full row before (old_data) and after (new_data), who did it (auth.uid())
-- and when (server clock). A deletion is logical (deleted_at set, RF-17), so it is an UPDATE
-- recorded with action 'delete'. Audit rows are immutable:
--   * clients have SELECT only (T-05 revoked insert/update/delete, RLS limits it to the family);
--   * a direct INSERT is refused even for roles that bypass RLS and privileges, so every row
--     comes from the trigger;
--   * UPDATE, DELETE and TRUNCATE are refused for every role. The only delete allowed is the
--     cascade when the whole family is deleted (erasure of all of the family's data), the same
--     rule as custody_rules (T-08). An expense can therefore never be hard-deleted on its own:
--     the cascade to its audit rows is refused.

-- Stable order inside one transaction (changed_at is the transaction time, equal for all of them).
alter table shared_custody.expense_audit add column seq bigint generated always as identity;

-- changed_by keeps the auth user id as a historical fact. Without this foreign key, deleting an
-- auth user does not need to rewrite (set null) audit rows, which would be refused below.
alter table shared_custody.expense_audit drop constraint expense_audit_changed_by_fkey;

drop index shared_custody.expense_audit_expense_id_idx;
create index expense_audit_expense_id_idx on shared_custody.expense_audit(expense_id, seq);

-- Writer ------------------------------------------------------------------------------------------

create function shared_custody.expenses_audit() returns trigger
language plpgsql security definer set search_path = shared_custody as $$
declare
  act text;
begin
  if tg_op = 'INSERT' then
    act := 'insert';
  elsif old.deleted_at is null and new.deleted_at is not null then
    act := 'delete';
  elsif (to_jsonb(new) - 'updated_at') = (to_jsonb(old) - 'updated_at') then
    return null; -- nothing changed (e.g. "set description = description"): nothing to record
  else
    act := 'update';
  end if;

  insert into shared_custody.expense_audit (expense_id, family_id, changed_by, action, old_data, new_data)
  values (
    new.id, new.family_id, auth.uid(), act,
    case when tg_op = 'UPDATE' then to_jsonb(old) end,
    to_jsonb(new)
  );
  return null;
end;
$$;

create trigger expenses_audit after insert or update on shared_custody.expenses
  for each row execute function shared_custody.expenses_audit();

-- Guards ------------------------------------------------------------------------------------------

-- Rows only come from expenses_audit: at trigger depth 1 the INSERT was issued directly (by a
-- client, a function or the SQL editor), at depth 2 it comes from the trigger above.
create function shared_custody.expense_audit_insert_guard() returns trigger
language plpgsql as $$
begin
  if pg_trigger_depth() < 2 then
    raise exception 'expense audit rows are written only by the expenses_audit trigger'
      using errcode = '42501';
  end if;
  new.changed_at := now();
  return new;
end;
$$;

create trigger expense_audit_insert_guard before insert on shared_custody.expense_audit
  for each row execute function shared_custody.expense_audit_insert_guard();

create function shared_custody.expense_audit_immutable() returns trigger
language plpgsql set search_path = shared_custody as $$
begin
  -- Cascade from deleting the family: the family row is already gone at this point.
  if tg_op = 'DELETE' and not exists (select 1 from shared_custody.families f where f.id = old.family_id) then
    return old;
  end if;
  raise exception 'expense audit rows are immutable' using errcode = 'AU001';
end;
$$;

create trigger expense_audit_immutable before update or delete on shared_custody.expense_audit
  for each row execute function shared_custody.expense_audit_immutable();

create trigger expense_audit_no_truncate before truncate on shared_custody.expense_audit
  for each statement execute function shared_custody.expense_audit_immutable();

-- Privileges (already set in T-05; repeated here because this migration is the audit's contract).
revoke insert, update, delete, truncate on shared_custody.expense_audit from anon, authenticated;

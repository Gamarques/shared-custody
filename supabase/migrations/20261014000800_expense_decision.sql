-- T-16: the other member confirms or disputes an expense (RF-11).
--
-- Only the member who did NOT pay decides. Status and the dispute comment change only through
-- confirm_expense / dispute_expense: a direct UPDATE from a client is rejected by a trigger, so
-- RLS "members update expenses" cannot be used to confirm one's own expense.

alter table shared_custody.expenses
  add column dispute_comment text check (dispute_comment is null or char_length(dispute_comment) <= 500),
  add column decided_by uuid references auth.users(id) on delete set null,
  add column decided_at timestamptz,
  -- A dispute always carries a comment (RF-11).
  add constraint expenses_dispute_comment_required check (
    status <> 'disputed' or char_length(btrim(coalesce(dispute_comment, ''))) > 0
  );

-- Guard: decision columns are writable only inside the decision functions, which set a
-- transaction-local flag. Later tasks (e.g. edit resetting to pending, RF-12) do the same.
create function shared_custody.expenses_guard_decision() returns trigger
language plpgsql as $$
begin
  if (new.status, new.dispute_comment, new.decided_by, new.decided_at)
     is distinct from (old.status, old.dispute_comment, old.decided_by, old.decided_at)
     and coalesce(current_setting('app.expense_decision', true), '') <> 'on' then
    raise exception 'expense status can only change through confirm_expense or dispute_expense'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger expenses_guard_decision before update on shared_custody.expenses
  for each row execute function shared_custody.expenses_guard_decision();

-- Shared by both functions. Raises:
--   P0002 expense not found (or not visible to the caller), 42501 caller is not the other member,
--   55000 expense is not awaiting a decision (only pending or disputed can be decided).
create function shared_custody.decide_expense(eid uuid, new_status text, comment text) returns shared_custody.expenses
language plpgsql security definer set search_path = shared_custody as $$
declare
  e shared_custody.expenses;
  me uuid;
begin
  select * into e from shared_custody.expenses where id = eid and deleted_at is null;
  if not found or not shared_custody.is_family_member(e.family_id) then
    raise exception 'expense not found' using errcode = 'P0002';
  end if;

  select m.id into me from shared_custody.members m where m.family_id = e.family_id and m.user_id = auth.uid();
  if me = e.paid_by then
    raise exception 'only the other member can decide this expense' using errcode = '42501';
  end if;

  if e.status not in ('pending', 'disputed') then
    raise exception 'expense is already %', e.status using errcode = '55000';
  end if;

  perform set_config('app.expense_decision', 'on', true);
  update shared_custody.expenses
     set status = new_status,
         dispute_comment = comment,
         decided_by = auth.uid(),
         decided_at = now(),
         updated_at = now()
   where id = eid
   returning * into e;
  perform set_config('app.expense_decision', 'off', true);
  return e;
end;
$$;

create function shared_custody.confirm_expense(eid uuid) returns shared_custody.expenses
language sql security definer set search_path = shared_custody as $$
  select * from shared_custody.decide_expense(eid, 'confirmed', null);
$$;

-- Raises 22023 when the comment is blank or longer than 500 characters.
create function shared_custody.dispute_expense(eid uuid, comment text) returns shared_custody.expenses
language plpgsql security definer set search_path = shared_custody as $$
declare
  c text := btrim(coalesce(comment, ''));
begin
  if c = '' or char_length(c) > 500 then
    raise exception 'a dispute needs a comment of 1 to 500 characters' using errcode = '22023';
  end if;
  return shared_custody.decide_expense(eid, 'disputed', c);
end;
$$;

-- decide_expense is internal; only the two wrappers are callable by clients.
revoke all on function shared_custody.decide_expense(uuid, text, text) from public, anon, authenticated;
revoke all on function shared_custody.confirm_expense(uuid) from public, anon;
revoke all on function shared_custody.dispute_expense(uuid, text) from public, anon;
grant execute on function shared_custody.confirm_expense(uuid) to authenticated;
grant execute on function shared_custody.dispute_expense(uuid, text) to authenticated;

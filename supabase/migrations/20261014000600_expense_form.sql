-- T-13: expense form (RF-08) with a share per expense and the family default (RF-09).
--
-- The tables and RLS come from T-05 (20261014000300): members of the family read, insert and
-- update expenses, nobody deletes them, and members update their own family, which is how the
-- default share (families.default_payer_share_bps) is edited. This migration closes what the
-- form must not be able to forge on insert and bounds the amount.

-- A new expense always starts pending and alive, with server timestamps, whatever the client
-- sends: confirming is the other member's decision (T-16) and deleting is logical (T-18).
create function shared_custody.expenses_insert_defaults() returns trigger
language plpgsql as $$
begin
  new.status := 'pending';
  new.deleted_at := null;
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;

create trigger expenses_insert_defaults before insert on shared_custody.expenses
  for each row execute function shared_custody.expenses_insert_defaults();

-- Same limit as MAX_AMOUNT_CENTS in src/lib/expenses/money.ts: 1 000 000,00 per expense.
alter table shared_custody.expenses
  add constraint expenses_amount_max check (amount_cents <= 100000000);

-- T-18: edit and logical deletion of an expense (RF-17).
--
-- RLS (T-05) already lets members of the family update their expenses and gives nobody a DELETE
-- policy; the audit trigger (T-17) records every edit and deletion. What this migration adds is
-- the rules the server enforces on UPDATE, whatever the client sends:
--   * a deleted expense is final: no edit, no restore, no second deletion;
--   * family_id never changes;
--   * deleted_at, when set, is the server clock;
--   * editing the amount, payer, date, description, category, share or receipt of an expense that
--     was decided (confirmed or disputed) sends it back to pending and clears the decision, so
--     the other member decides again (plan, "Despesas" rule 5). The decision columns are still
--     writable only through confirm_expense / dispute_expense (T-16).
-- It replaces expenses_guard_decision (T-16), the BEFORE UPDATE guard on expenses.

create or replace function shared_custody.expenses_guard_decision() returns trigger
language plpgsql as $$
declare
  decision_flag boolean := coalesce(current_setting('app.expense_decision', true), '') = 'on';
  content_changed boolean;
begin
  if new.family_id is distinct from old.family_id then
    raise exception 'expense family cannot change' using errcode = '42501';
  end if;

  if old.deleted_at is not null then
    raise exception 'expense is deleted' using errcode = '55000';
  end if;

  if (new.status, new.dispute_comment, new.decided_by, new.decided_at)
     is distinct from (old.status, old.dispute_comment, old.decided_by, old.decided_at)
     and not decision_flag then
    raise exception 'expense status can only change through confirm_expense or dispute_expense'
      using errcode = '42501';
  end if;

  if new.deleted_at is not null then
    -- Logical deletion: stamp it with the server clock.
    new.deleted_at := now();
    new.updated_at := now();
    return new;
  end if;

  content_changed := (new.paid_by, new.amount_cents, new.spent_on, new.description, new.category,
                      new.payer_share_bps, new.receipt_path)
                     is distinct from
                     (old.paid_by, old.amount_cents, old.spent_on, old.description, old.category,
                      old.payer_share_bps, old.receipt_path);

  if content_changed and not decision_flag then
    new.updated_at := now();
    if old.status <> 'pending' then
      new.status := 'pending';
      new.dispute_comment := null;
      new.decided_by := null;
      new.decided_at := null;
    end if;
  end if;
  return new;
end;
$$;

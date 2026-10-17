-- T-21: record a settlement between the two members (RF-14).
--
-- A settlement is a payment from one member to the other. It lowers the balance (T-19) and is
-- listed in the history. Because it is financial history, a row is append-only: members can
-- read and insert, never update or delete. A mistaken settlement is undone by recording the
-- opposite one.

-- Cap in line with expenses (1 000 000,00): rejects absurd values at the database.
alter table shared_custody.settlements
  add constraint settlements_amount_max check (amount_cents <= 100000000);

-- The "family members only" policy covered every command; split it so only select and insert
-- remain. With no update/delete policy (and the privileges revoked) both are denied.
drop policy "family members only" on shared_custody.settlements;

create policy "members read settlements" on shared_custody.settlements
  for select using (shared_custody.is_family_member(family_id));
create policy "members insert settlements" on shared_custody.settlements
  for insert with check (shared_custody.is_family_member(family_id));

revoke update, delete on shared_custody.settlements from authenticated;

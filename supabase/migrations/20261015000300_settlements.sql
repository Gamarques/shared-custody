-- T-21: record a settlement between the two members (RF-14).
--
-- A settlement is a payment from one member to the other. It lowers the balance (T-19) and is
-- listed in the history. Because it is financial history, a row is append-only: members can
-- read and insert, never update or delete. A mistaken settlement is undone by recording the
-- opposite one.

-- Cap in line with expenses (1 000 000,00): rejects absurd values at the database.
alter table public.settlements
  add constraint settlements_amount_max check (amount_cents <= 100000000);

-- The "family members only" policy covered every command; split it so only select and insert
-- remain. With no update/delete policy (and the privileges revoked) both are denied.
drop policy "family members only" on public.settlements;

create policy "members read settlements" on public.settlements
  for select using (public.is_family_member(family_id));
create policy "members insert settlements" on public.settlements
  for insert with check (public.is_family_member(family_id));

revoke update, delete on public.settlements from authenticated;

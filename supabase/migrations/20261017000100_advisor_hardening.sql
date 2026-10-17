-- TODO-005: findings of the Supabase Security/Performance Advisor on schema shared_custody.
--
-- 1. function_search_path_mutable: pin search_path on every function that lacked it. Every
--    body already qualifies its objects (shared_custody.*, storage.*), so behaviour is unchanged.
-- 2. auth_rls_initplan: wrap auth.uid() in a scalar subquery on policy "member updates self" so
--    Postgres evaluates it once per statement instead of once per row.
-- 3. unindexed_foreign_keys: index the 13 foreign keys that had no covering index (joins and
--    ON DELETE cascades scan these columns).

-- 1. search_path ---------------------------------------------------------------------------
alter function shared_custody.custody_overrides_defaults() set search_path = shared_custody;
alter function shared_custody.custody_rules_immutable() set search_path = shared_custody;
alter function shared_custody.enforce_max_two_members() set search_path = shared_custody;
alter function shared_custody.expense_audit_insert_guard() set search_path = shared_custody;
alter function shared_custody.expenses_guard_decision() set search_path = shared_custody;
alter function shared_custody.expenses_insert_defaults() set search_path = shared_custody;
alter function shared_custody.members_immutable_keys() set search_path = shared_custody;
alter function shared_custody.receipt_family_id(text) set search_path = shared_custody;
alter function shared_custody.set_created_by() set search_path = shared_custody;

-- 2. initplan ------------------------------------------------------------------------------
drop policy "member updates self" on shared_custody.members;
create policy "member updates self" on shared_custody.members
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and shared_custody.is_family_member(family_id));

-- 3. foreign-key indexes -------------------------------------------------------------------
create index if not exists custody_overrides_created_by_idx on shared_custody.custody_overrides (created_by);
create index if not exists custody_overrides_member_idx on shared_custody.custody_overrides (member_id, family_id);
create index if not exists custody_rules_created_by_idx on shared_custody.custody_rules (created_by);
create index if not exists custody_rules_first_member_idx on shared_custody.custody_rules (first_member_id, family_id);
create index if not exists expense_audit_expense_idx on shared_custody.expense_audit (expense_id, family_id);
create index if not exists expenses_created_by_idx on shared_custody.expenses (created_by);
create index if not exists expenses_decided_by_idx on shared_custody.expenses (decided_by);
create index if not exists expenses_paid_by_idx on shared_custody.expenses (paid_by, family_id);
create index if not exists invites_accepted_by_idx on shared_custody.invites (accepted_by);
create index if not exists invites_created_by_idx on shared_custody.invites (created_by);
create index if not exists settlements_created_by_idx on shared_custody.settlements (created_by);
create index if not exists settlements_from_member_idx on shared_custody.settlements (from_member, family_id);
create index if not exists settlements_to_member_idx on shared_custody.settlements (to_member, family_id);

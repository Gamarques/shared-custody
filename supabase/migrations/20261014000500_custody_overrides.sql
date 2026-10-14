-- T-11: custody overrides (RF-07): swapped days, holidays, school breaks, each with a reason.
--
-- An override wins over the rule for [starts_at, ends_at); when two overlap, the one created
-- last wins (getCustodyHolder in src/lib/custody/holder.ts). That makes created_at part of the
-- business rule, so:
--   * created_at is always the server clock (the client cannot jump the queue);
--   * overrides are never edited, only added or removed. Editing would change the period or the
--     member while keeping the old precedence; the screen removes and adds one instead.

-- Members read, add and remove their family's overrides; nobody updates them through the API.
drop policy "family members only" on public.custody_overrides;

create policy "members read custody overrides" on public.custody_overrides
  for select using (public.is_family_member(family_id));
create policy "members insert custody overrides" on public.custody_overrides
  for insert with check (public.is_family_member(family_id));
create policy "members delete custody overrides" on public.custody_overrides
  for delete using (public.is_family_member(family_id));

revoke update on public.custody_overrides from authenticated;

create function public.custody_overrides_defaults() returns trigger
language plpgsql as $$
begin
  new.created_at := now();
  return new;
end;
$$;

create trigger custody_overrides_defaults before insert on public.custody_overrides
  for each row execute function public.custody_overrides_defaults();

-- One override covers at most a year. Longer arrangements are a rule change (T-08); the
-- next-handover search on the home looks 400 days ahead.
alter table public.custody_overrides
  add constraint custody_overrides_max_length check (ends_at <= starts_at + interval '366 days');

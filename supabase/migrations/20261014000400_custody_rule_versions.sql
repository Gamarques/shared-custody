-- T-08: custody rule versions (RF-04).
--
-- Saving the rule always inserts a new row; earlier versions are never changed or removed, so
-- the full history is preserved. The version in force is resolved by getCustodyHolder()
-- (src/lib/custody/holder.ts): versions apply in the order they were saved (created_at), each
-- from 00:00 local of its valid_from, and the schedule it replaces keeps running until the new
-- version's first handover. valid_to stays available to end the latest version; saving a new
-- version does not write it, because that would change a preserved row.

-- Members read and insert versions; nobody updates or deletes them through the API.
drop policy "family members only" on shared_custody.custody_rules;

create policy "members read custody rules" on shared_custody.custody_rules
  for select using (shared_custody.is_family_member(family_id));
create policy "members insert custody rules" on shared_custody.custody_rules
  for insert with check (shared_custody.is_family_member(family_id));

revoke update, delete on shared_custody.custody_rules from authenticated;

-- Defense in depth for roles that bypass RLS and privileges (SQL editor, service role): the
-- content of a version is immutable. Deletes are still possible there so that deleting a family
-- or a member cascades; only created_by may change (on delete set null of auth.users).
create function shared_custody.custody_rules_immutable() returns trigger
language plpgsql as $$
begin
  if (new.id, new.family_id, new.starts_on, new.first_member_id, new.handover_weekday,
      new.handover_time, new.valid_from, new.valid_to, new.created_at)
     is distinct from
     (old.id, old.family_id, old.starts_on, old.first_member_id, old.handover_weekday,
      old.handover_time, old.valid_from, old.valid_to, old.created_at) then
    raise exception 'custody rule versions are immutable; save a new version instead'
      using errcode = 'CR001';
  end if;
  return new;
end;
$$;

create trigger custody_rules_immutable before update on shared_custody.custody_rules
  for each row execute function shared_custody.custody_rules_immutable();

-- valid_from, when omitted: the first version of a family applies from its first handover
-- (starts_on); a later version applies from today in the family's time zone (RNF-04), so the
-- weeks already lived keep the previous rule. created_at is always the server clock, so the
-- save order cannot be forged by the client.
create function shared_custody.custody_rules_defaults() returns trigger
language plpgsql set search_path = shared_custody as $$
declare
  tz text;
begin
  new.created_at := now();
  if new.valid_from is null then
    if exists (select 1 from shared_custody.custody_rules where family_id = new.family_id) then
      select f.timezone into tz from shared_custody.families f where f.id = new.family_id;
      new.valid_from := (now() at time zone coalesce(tz, 'Europe/Lisbon'))::date;
    else
      new.valid_from := new.starts_on;
    end if;
  end if;
  return new;
end;
$$;

create trigger custody_rules_defaults before insert on shared_custody.custody_rules
  for each row execute function shared_custody.custody_rules_defaults();

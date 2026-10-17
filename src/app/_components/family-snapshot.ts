import { cache } from "react";
import type { BalanceExpense, BalanceSettlement } from "@/lib/balance/balance";
import type { CustodyOverride, CustodyRule } from "@/lib/custody/holder";
import type { HomeMember } from "@/lib/custody/today";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser, type SessionUser } from "@/lib/supabase/session-user";

export type FamilyRow = {
  timezone: string;
  currency?: string | null;
  children: { name: string; created_at: string }[] | null;
  members: HomeMember[] | null;
  custody_rules: CustodyRule[] | null;
  custody_overrides: CustodyOverride[] | null;
  expenses?: (BalanceExpense & { id: string })[] | null;
  settlements?: BalanceSettlement[] | null;
};

export type FamilySnapshot = {
  /** Server clock when the rows were read. */
  nowMs: number;
  user: SessionUser | null;
  /** The caller's own member row; null without a family. */
  me: { id: string; display_name: string; color: string } | null;
  family: FamilyRow | null;
  /** The query failed; with `found` false and no error, the caller has no family yet. */
  error: boolean;
  found: boolean;
};

/**
 * Everything the home and the app shell need, in one request (RNF-07): the caller's member row,
 * the family with its members, child, rule versions, the overrides that have not ended yet and
 * the recent expenses and settlements (from expenseWindowStart, which covers the family's current
 * month in any time zone; the page narrows them to that month). RLS limits every embedded table
 * to the caller's own family.
 */
export const HOME_SELECT =
  "id, display_name, color, family_id, families(timezone, currency, children(name, created_at), members(id, display_name, color), " +
  "custody_rules(id, starts_on, first_member_id, handover_weekday, handover_time, valid_from, valid_to, created_at), " +
  "custody_overrides(id, starts_at, ends_at, member_id, reason, created_at), " +
  "expenses(id, paid_by, amount_cents, payer_share_bps, status, spent_on), " +
  "settlements(from_member, to_member, amount_cents, settled_on))";

/** First day ("YYYY-MM-DD") of the UTC month two days before `nowMs`: covers the local month in any zone. */
export function expenseWindowStart(nowMs: number): string {
  const d = new Date(nowMs - 2 * 86_400_000);
  const prev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  return prev.toISOString().slice(0, 10);
}

/**
 * Read once per request: the root layout (who has the child, avatar) and the home share it
 * through React's request cache, so the home still costs a single query.
 */
export const loadFamilySnapshot = cache(async (): Promise<FamilySnapshot> => {
  const nowMs = Date.now();
  const supabase = await createClient();
  // The token is verified locally (no Auth request), so the query below is the only round trip
  // to Supabase; src/proxy.ts skips its membership check for "/" (RNF-07).
  const user = await getSessionUser(supabase);
  if (!user) return { nowMs, user: null, me: null, family: null, error: false, found: false };
  const since = expenseWindowStart(nowMs);
  const { data, error } = await supabase
    .from("members")
    .select(HOME_SELECT)
    .eq("user_id", user.id)
    .gt("families.custody_overrides.ends_at", new Date(nowMs).toISOString())
    .is("families.expenses.deleted_at", null)
    .gte("families.expenses.spent_on", since)
    .gte("families.settlements.settled_on", since)
    .maybeSingle();
  const row = data as ({ id?: string; display_name?: string; color?: string; families: FamilyRow | null } | null);
  return {
    nowMs,
    user,
    me: row?.id && row.display_name ? { id: row.id, display_name: row.display_name, color: row.color ?? "" } : null,
    family: row?.families ?? null,
    error: Boolean(error),
    found: Boolean(row),
  };
});

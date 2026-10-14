import { dayNumber, localDayTimeToInstant, parseDate, parseTime, toWallClock } from "./timezone";

/**
 * Who has the child at a given instant (see "Regras de negócio > Guarda" in docs/plano-mvp.md).
 *
 * Inputs mirror the database rows (snake_case, as returned by supabase-js), so a page can pass
 * query results straight in. Pure function: no I/O, no host time zone, no `Date.now()`.
 */

export type CustodyRule = {
  id: string;
  /** Local date of the first handover; its weekday is handover_weekday (DB check). */
  starts_on: string;
  first_member_id: string;
  /** 0 = Sunday ... 6 = Saturday. Implied by starts_on; kept for parity with the row. */
  handover_weekday: number;
  /** Local time of the handover, "18:00" or "18:00:00". */
  handover_time: string;
  /** Local date from which this version applies. Weeks before it keep the older rule. */
  valid_from: string;
  /** Local date (exclusive) on which this version stops, when nothing replaces it. */
  valid_to: string | null;
  created_at?: string;
};

export type CustodyOverride = {
  id: string;
  starts_at: string;
  ends_at: string;
  member_id: string;
  reason: string;
  created_at: string;
};

export type CustodySchedule = {
  /** IANA zone of the family, e.g. "Europe/Lisbon" (RNF-04). */
  timezone: string;
  /** Member ids of the family (one or two). */
  memberIds: readonly string[];
  rules: readonly CustodyRule[];
  overrides?: readonly CustodyOverride[];
};

export type CustodyHolder =
  | { memberId: string; source: "rule"; ruleId: string; weekIndex: number }
  | { memberId: string; source: "override"; overrideId: string; reason: string };

type PreparedRule = {
  rule: CustodyRule;
  index: number;
  startsOn: number;
  time: ReturnType<typeof parseTime>;
  /** 00:00 local of valid_from: from here on, this version replaces the earlier schedule. */
  validFromStart: number;
  /** First instant the rule is in force: the later of valid_from 00:00 and the first handover. */
  effectiveStart: number;
};

function handoverInstant(r: PreparedRule, week: number, timeZone: string): number {
  return localDayTimeToInstant(r.startsOn + 7 * week, r.time, timeZone);
}

/** Save order: created_at, then position in the list (fixtures without created_at). */
function savedBefore(a: PreparedRule, b: PreparedRule): number {
  const ta = a.rule.created_at ? Date.parse(a.rule.created_at) : NaN;
  const tb = b.rule.created_at ? Date.parse(b.rule.created_at) : NaN;
  return (Number.isNaN(ta) || Number.isNaN(tb) ? 0 : ta - tb) || a.index - b.index;
}

function prepareRules(rules: readonly CustodyRule[], timeZone: string): PreparedRule[] {
  return rules
    .map((rule, index) => {
      const startsOn = parseDate(rule.starts_on);
      const time = parseTime(rule.handover_time);
      const firstHandover = localDayTimeToInstant(startsOn, time, timeZone);
      const validFromStart = localDayTimeToInstant(
        parseDate(rule.valid_from),
        { hour: 0, minute: 0, second: 0 },
        timeZone,
      );
      return {
        rule,
        index,
        startsOn,
        time,
        validFromStart,
        effectiveStart: Math.max(firstHandover, validFromStart),
      };
    })
    .sort(savedBefore);
}

/**
 * Rule in force at `t`. Versions apply in the order they were saved: each one replaces the
 * earlier schedule from 00:00 of its valid_from, but that schedule keeps running until the new
 * version's first handover, so a change never leaves a gap and never rewrites past weeks.
 * A version saved later with the same or an earlier valid_from replaces an older one entirely
 * (a correction), even if the older one had not started yet. valid_to only ends the last version.
 */
function ruleAt(prepared: PreparedRule[], t: number, timeZone: string): PreparedRule | null {
  // Walk from the newest version back. Once a newer version (not yet started at t) has taken
  // over from its valid_from, older versions taking over on or after that date never apply.
  let replacedFrom = Infinity;
  let i = prepared.length - 1;
  for (; i >= 0; i--) {
    const r = prepared[i];
    if (r.validFromStart < replacedFrom && r.effectiveStart <= t) break;
    replacedFrom = Math.min(replacedFrom, r.validFromStart);
  }
  if (i < 0) return null;
  const current = prepared[i];
  if (i === prepared.length - 1 && current.rule.valid_to !== null) {
    const end = localDayTimeToInstant(parseDate(current.rule.valid_to), { hour: 0, minute: 0, second: 0 }, timeZone);
    if (t >= end) return null;
  }
  return current;
}

/** Number of whole weeks since the first handover, counted in local calendar days. */
function weekIndexAt(r: PreparedRule, t: number, timeZone: string): number {
  const today = dayNumber(toWallClock(t, timeZone));
  let week = Math.floor((today - r.startsOn) / 7);
  // The handover day itself belongs to the previous week until the handover time. The loops
  // also absorb the rare case of a handover pushed past midnight by a DST gap.
  while (week >= 0 && handoverInstant(r, week, timeZone) > t) week--;
  while (handoverInstant(r, week + 1, timeZone) <= t) week++;
  return week;
}

function overrideAt(overrides: readonly CustodyOverride[], t: number): CustodyOverride | null {
  let winner: CustodyOverride | null = null;
  for (const o of overrides) {
    if (Date.parse(o.starts_at) <= t && t < Date.parse(o.ends_at)) {
      // Latest created wins on overlap; on a tie, the later one in the list.
      if (!winner || Date.parse(o.created_at) >= Date.parse(winner.created_at)) winner = o;
    }
  }
  return winner;
}

/**
 * Member who has custody at `instant`, or null when no rule or override covers it (before the
 * first handover, after the last rule ends, or an odd week while the family has one member).
 */
export function getCustodyHolder(instant: Date, schedule: CustodySchedule): CustodyHolder | null {
  const t = instant.getTime();
  if (Number.isNaN(t)) throw new Error("Invalid instant");
  const { timezone } = schedule;

  const override = overrideAt(schedule.overrides ?? [], t);
  if (override) {
    return { memberId: override.member_id, source: "override", overrideId: override.id, reason: override.reason };
  }

  const rule = ruleAt(prepareRules(schedule.rules, timezone), t, timezone);
  if (!rule) return null;

  const weekIndex = weekIndexAt(rule, t, timezone);
  if (weekIndex < 0) return null;
  const first = rule.rule.first_member_id;
  const memberId = weekIndex % 2 === 0 ? first : schedule.memberIds.find((id) => id !== first);
  if (!memberId) return null;
  return { memberId, source: "rule", ruleId: rule.rule.id, weekIndex };
}

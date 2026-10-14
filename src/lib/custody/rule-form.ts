import type { CustodyRule } from "./holder";
import { parseDate, parseTime, toWallClock } from "./timezone";

/**
 * Custody rule form (RF-04, T-08): validation, defaults and the row to insert. Saving always
 * inserts a new version; earlier versions stay in custody_rules untouched.
 */

/** 0 = Sunday ... 6 = Saturday, like custody_rules.handover_weekday. */
export const WEEKDAYS = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"] as const;

export type RuleFormInput = {
  firstMemberId: string;
  /** Local date of the first handover of this version (YYYY-MM-DD). */
  startsOn: string;
  handoverWeekday: number;
  /** Local time "HH:MM". */
  handoverTime: string;
  /** Local date from which this version replaces the current one; null for the first version. */
  validFrom: string | null;
};

export type RuleFormErrors = Partial<Record<keyof RuleFormInput, string>>;

/** A row of custody_rules as the page reads it (created_by is the auth user id). */
export type CustodyRuleRow = CustodyRule & { created_at: string; created_by: string | null };

const MS_PER_DAY = 86_400_000;

function isDate(value: string): boolean {
  try {
    parseDate(value);
    return true;
  } catch {
    return false;
  }
}

function toIsoDate(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Weekday (0 = Sunday) of a YYYY-MM-DD date. */
export function weekdayOf(date: string): number {
  return new Date(parseDate(date) * MS_PER_DAY).getUTCDay();
}

/** First date on or after `date` that falls on `weekday`. */
export function nextWeekdayOnOrAfter(date: string, weekday: number): string {
  const day = parseDate(date);
  return toIsoDate(day + ((weekday - weekdayOf(date) + 7) % 7));
}

/** Today's local date in the zone (RNF-04), as YYYY-MM-DD. */
export function todayIn(timeZone: string, nowMs: number = Date.now()): string {
  const w = toWallClock(nowMs, timeZone);
  return `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
}

/** "2026-10-18" -> "18/10/2026". */
export function formatDate(date: string): string {
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}

/** "18:00:00" -> "18:00". */
export function formatTime(time: string): string {
  return time.slice(0, 5);
}

/**
 * The version that governs from now on: the one saved last (see ruleAt in holder.ts). On a
 * millisecond tie the first in the list wins, so pass rows ordered by created_at descending.
 */
export function latestRule<T extends Pick<CustodyRuleRow, "created_at">>(rules: readonly T[]): T | null {
  let latest: T | null = null;
  for (const r of rules) if (!latest || Date.parse(r.created_at) > Date.parse(latest.created_at)) latest = r;
  return latest;
}

/** Form values for a new version: the current rule, or sensible defaults for the first one. */
export function initialRuleForm(current: CustodyRule | null, memberIds: readonly string[], today: string): RuleFormInput {
  if (current) {
    return {
      firstMemberId: current.first_member_id,
      startsOn: nextWeekdayOnOrAfter(today, current.handover_weekday),
      handoverWeekday: current.handover_weekday,
      handoverTime: formatTime(current.handover_time),
      validFrom: today,
    };
  }
  return {
    firstMemberId: memberIds[0] ?? "",
    startsOn: nextWeekdayOnOrAfter(today, 0),
    handoverWeekday: 0,
    handoverTime: "18:00",
    validFrom: null,
  };
}

export function validateRuleForm(input: RuleFormInput, memberIds: readonly string[]): RuleFormErrors {
  const errors: RuleFormErrors = {};
  if (!memberIds.includes(input.firstMemberId)) errors.firstMemberId = "Escolha quem começa.";
  const weekdayOk = Number.isInteger(input.handoverWeekday) && input.handoverWeekday >= 0 && input.handoverWeekday <= 6;
  if (!weekdayOk) errors.handoverWeekday = "Escolha o dia da troca.";
  if (!isDate(input.startsOn)) {
    errors.startsOn = "Informe a data da primeira troca.";
  } else if (weekdayOk && weekdayOf(input.startsOn) !== input.handoverWeekday) {
    errors.startsOn = `A primeira troca deve cair no dia da troca (${WEEKDAYS[input.handoverWeekday].toLowerCase()}).`;
  }
  try {
    if (!/^\d{2}:\d{2}$/.test(input.handoverTime)) throw new Error();
    parseTime(input.handoverTime);
  } catch {
    errors.handoverTime = "Informe a hora da troca (HH:MM).";
  }
  if (input.validFrom !== null && !isDate(input.validFrom)) errors.validFrom = "Informe a partir de quando vale a nova regra.";
  return errors;
}

/**
 * Row for `insert into custody_rules`. valid_from is omitted for the first version: the database
 * sets it to starts_on (custody_rules_defaults trigger).
 */
export function toCustodyRuleInsert(familyId: string, input: RuleFormInput) {
  return {
    family_id: familyId,
    first_member_id: input.firstMemberId,
    starts_on: input.startsOn,
    handover_weekday: input.handoverWeekday,
    handover_time: input.handoverTime,
    ...(input.validFrom !== null ? { valid_from: input.validFrom } : {}),
  };
}

/** Message for a failed insert (Postgres SQLSTATE from supabase-js). */
export function ruleSaveErrorMessage(code: string | undefined): string {
  switch (code) {
    case "23514":
      return "A data da primeira troca não cai no dia da troca escolhido.";
    case "23503":
      return "O responsável escolhido não faz parte da família.";
    case "42501":
      return "Você não tem permissão para alterar a regra desta família.";
    default:
      return "Não foi possível salvar a regra. Tente novamente.";
  }
}

/** "Domingo às 18:00; primeira troca em 04/01/2026 com Ana". */
export function describeRule(rule: CustodyRule, memberNames: Readonly<Record<string, string>>): string {
  const who = memberNames[rule.first_member_id] ?? "responsável removido";
  return `${WEEKDAYS[rule.handover_weekday]} às ${formatTime(rule.handover_time)}; primeira troca em ${formatDate(rule.starts_on)} com ${who}`;
}

import type { CustodyOverride } from "./holder";
import { formatDate, formatTime } from "./rule-form";
import { parseDate, parseTime, toWallClock, wallClockToInstant } from "./timezone";

/**
 * Custody override form (RF-07, T-11): swapped days, school breaks and public holidays, each
 * with a reason. The form takes local dates and times; they become instants in the family zone
 * (RNF-04), so "from Friday 18:00" means 18:00 in Lisbon whatever the device's zone.
 */

/** Quick picks that fill the reason; the reason stays free text. */
export const OVERRIDE_PRESETS = ["Troca de dias", "Férias", "Feriado"] as const;

export const REASON_MAX_LENGTH = 200;
/** Same limit as the custody_overrides_max_length check. */
export const MAX_OVERRIDE_DAYS = 366;

const MS_PER_DAY = 86_400_000;

export type OverrideFormInput = {
  memberId: string;
  /** Local date and time in the family zone ("2026-12-24", "18:00"). */
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  reason: string;
};

export type OverrideFormErrors = Partial<Record<keyof OverrideFormInput, string>>;

/** A row of custody_overrides as the screen reads it (created_by is the auth user id). */
export type CustodyOverrideRow = CustodyOverride & { created_by: string | null };

function addDays(date: string, days: number): string {
  return new Date((parseDate(date) + days) * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Instant of a local date and time in the zone, or null when either is malformed. */
export function localInstant(date: string, time: string, timeZone: string): number | null {
  if (!/^\d{2}:\d{2}$/.test(time)) return null;
  try {
    const d = new Date(parseDate(date) * MS_PER_DAY);
    return wallClockToInstant(
      { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), ...parseTime(time) },
      timeZone,
    );
  } catch {
    return null;
  }
}

/** Starts today and ends tomorrow, at the rule's handover time (18:00 without a rule). */
export function initialOverrideForm(
  today: string,
  handoverTime: string | null,
  memberIds: readonly string[],
): OverrideFormInput {
  const time = handoverTime ? formatTime(handoverTime) : "18:00";
  return {
    memberId: memberIds[0] ?? "",
    startDate: today,
    startTime: time,
    endDate: addDays(today, 1),
    endTime: time,
    reason: "",
  };
}

export function validateOverrideForm(
  input: OverrideFormInput,
  memberIds: readonly string[],
  timeZone: string,
): OverrideFormErrors {
  const errors: OverrideFormErrors = {};
  if (!memberIds.includes(input.memberId)) errors.memberId = "Escolhe com quem a criança fica.";
  const start = localInstant(input.startDate, input.startTime, timeZone);
  const end = localInstant(input.endDate, input.endTime, timeZone);
  if (start === null) errors.startDate = "Indica a data e a hora de início.";
  if (end === null) {
    errors.endDate = "Indica a data e a hora de fim.";
  } else if (start !== null && end <= start) {
    errors.endDate = "O fim deve ser depois do início.";
  } else if (start !== null && end - start > MAX_OVERRIDE_DAYS * MS_PER_DAY) {
    errors.endDate = "Uma exceção dura no máximo um ano. Para mais, muda a regra de guarda.";
  }
  const reason = input.reason.trim();
  if (reason.length === 0) errors.reason = "Indica o motivo (por exemplo, férias ou feriado).";
  else if (reason.length > REASON_MAX_LENGTH) errors.reason = `O motivo tem no máximo ${REASON_MAX_LENGTH} caracteres.`;
  return errors;
}

/** Row for `insert into custody_overrides`; call only when validateOverrideForm found nothing. */
export function toCustodyOverrideInsert(familyId: string, input: OverrideFormInput, timeZone: string) {
  const start = localInstant(input.startDate, input.startTime, timeZone);
  const end = localInstant(input.endDate, input.endTime, timeZone);
  if (start === null || end === null) throw new Error("Invalid override period");
  return {
    family_id: familyId,
    member_id: input.memberId,
    starts_at: new Date(start).toISOString(),
    ends_at: new Date(end).toISOString(),
    reason: input.reason.trim(),
  };
}

/** Message for a failed insert or delete (Postgres SQLSTATE from supabase-js). */
export function overrideSaveErrorMessage(code: string | undefined, action: "guardar" | "remover" = "guardar"): string {
  switch (code) {
    case "23514":
      return "Período ou motivo inválido: o fim deve ser depois do início, no máximo um ano depois.";
    case "23503":
      return "O responsável escolhido não faz parte da família.";
    case "42501":
      return "Não tens permissão para alterar as exceções desta família.";
    default:
      return `Não foi possível ${action} a exceção. Tenta novamente.`;
  }
}

/** "24/12/2026 18:00" in the zone. */
export function formatInstant(iso: string, timeZone: string): string {
  const w = toWallClock(Date.parse(iso), timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${formatDate(`${w.year}-${pad(w.month)}-${pad(w.day)}`)} ${pad(w.hour)}:${pad(w.minute)}`;
}

/** "de 24/12/2026 18:00 a 26/12/2026 18:00". */
export function describeOverridePeriod(o: Pick<CustodyOverride, "starts_at" | "ends_at">, timeZone: string): string {
  return `de ${formatInstant(o.starts_at, timeZone)} a ${formatInstant(o.ends_at, timeZone)}`;
}

/**
 * Overrides not yet ended (soonest first) and past ones (most recent first). The screen lists
 * the first group and folds the second.
 */
export function splitOverrides<T extends Pick<CustodyOverride, "starts_at" | "ends_at">>(
  overrides: readonly T[],
  nowMs: number,
): { upcoming: T[]; past: T[] } {
  const upcoming = overrides
    .filter((o) => Date.parse(o.ends_at) > nowMs)
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const past = overrides
    .filter((o) => Date.parse(o.ends_at) <= nowMs)
    .sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at));
  return { upcoming, past };
}

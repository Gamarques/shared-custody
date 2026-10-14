import { type CustodyHolder, type CustodyOverride, type CustodyRule, type CustodySchedule, getCustodyHolder } from "./holder";
import { WEEKDAYS } from "./rule-form";
import { dayNumber, localDayTimeToInstant, parseDate, parseTime, toWallClock } from "./timezone";

/**
 * Home "com quem está hoje" (RF-05, T-09): current holder, next handover and the countdown to it.
 * Pure functions: the page passes `now` and the rows it read.
 */

const MS_PER_DAY = 86_400_000;
const MIDNIGHT = { hour: 0, minute: 0, second: 0 };

export type NextHandover = {
  at: Date;
  /** Holder from `at` on; null when nobody is scheduled (e.g. the last rule ends). */
  holder: CustodyHolder | null;
};

/**
 * Instants after `t` at which the holder may change: every rule handover within the horizon,
 * rule boundaries and override start/end. Sorted and without duplicates.
 */
function candidateInstants(t: number, schedule: CustodySchedule, horizonMs: number): number[] {
  const { timezone } = schedule;
  const end = t + horizonMs;
  const today = dayNumber(toWallClock(t, timezone));
  const found = new Set<number>();
  const add = (ms: number) => {
    if (ms > t && ms <= end) found.add(ms);
  };

  for (const rule of schedule.rules) {
    const startsOn = parseDate(rule.starts_on);
    const time = parseTime(rule.handover_time);
    // One week of slack on each side covers handovers moved across midnight by a DST gap.
    const firstWeek = Math.max(0, Math.floor((today - startsOn) / 7) - 1);
    const lastWeek = Math.floor((today + horizonMs / MS_PER_DAY - startsOn) / 7) + 1;
    for (let week = firstWeek; week <= lastWeek; week++) {
      add(localDayTimeToInstant(startsOn + 7 * week, time, timezone));
    }
    add(localDayTimeToInstant(parseDate(rule.valid_from), MIDNIGHT, timezone));
    if (rule.valid_to) add(localDayTimeToInstant(parseDate(rule.valid_to), MIDNIGHT, timezone));
  }
  for (const o of schedule.overrides ?? []) {
    add(Date.parse(o.starts_at));
    add(Date.parse(o.ends_at));
  }
  return [...found].sort((a, b) => a - b);
}

/**
 * Next instant after `instant` at which the child passes to someone else, or null when nothing
 * changes within `horizonDays`. A rule handover hidden by an override is skipped; the end of that
 * override counts instead, when it hands the child back.
 */
export function getNextHandover(instant: Date, schedule: CustodySchedule, horizonDays = 400): NextHandover | null {
  const t = instant.getTime();
  if (Number.isNaN(t)) throw new Error("Invalid instant");
  const currentId = getCustodyHolder(instant, schedule)?.memberId ?? null;
  for (const ms of candidateInstants(t, schedule, horizonDays * MS_PER_DAY)) {
    const at = new Date(ms);
    const holder = getCustodyHolder(at, schedule);
    if ((holder?.memberId ?? null) !== currentId) return { at, holder };
  }
  return null;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Time left until `toMs`, in Portuguese: "Faltam 2 dias e 5 horas", "Falta 1 hora e 1 minuto",
 * "Faltam 12 minutos", "Falta menos de 1 minuto". Counted down to the minute (never rounds up).
 */
export function formatCountdown(fromMs: number, toMs: number): string {
  const minutes = Math.floor(Math.max(0, toMs - fromMs) / 60_000);
  if (minutes === 0) return "Falta menos de 1 minuto";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  const parts =
    days > 0
      ? [plural(days, "dia", "dias"), hours > 0 ? plural(hours, "hora", "horas") : ""]
      : hours > 0
        ? [plural(hours, "hora", "horas"), mins > 0 ? plural(mins, "minuto", "minutos") : ""]
        : [plural(mins, "minuto", "minutos")];
  const first = days || hours || mins;
  return `${first === 1 ? "Falta" : "Faltam"} ${parts.filter(Boolean).join(" e ")}`;
}

/**
 * When the handover happens, in the family zone (RNF-04): "hoje às 18:00", "amanhã às 18:00",
 * "domingo, 18/10, às 18:00"; the year is added when it differs from the current one.
 */
export function formatHandoverMoment(atMs: number, nowMs: number, timeZone: string): string {
  const at = toWallClock(atMs, timeZone);
  const now = toWallClock(nowMs, timeZone);
  const time = `${String(at.hour).padStart(2, "0")}:${String(at.minute).padStart(2, "0")}`;
  const days = dayNumber(at) - dayNumber(now);
  if (days === 0) return `hoje às ${time}`;
  if (days === 1) return `amanhã às ${time}`;
  const weekday = WEEKDAYS[new Date(dayNumber(at) * MS_PER_DAY).getUTCDay()].toLowerCase();
  const date = `${String(at.day).padStart(2, "0")}/${String(at.month).padStart(2, "0")}${at.year !== now.year ? `/${at.year}` : ""}`;
  return `${weekday}, ${date}, às ${time}`;
}

/** Black or white, whichever reads better on the member's color (WCAG relative luminance). */
export function textColorOn(hex: string): "#000000" | "#ffffff" {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return "#000000";
  const [r, g, b] = m.slice(1).map((h) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Contrast with black beats contrast with white above this luminance.
  return luminance > 0.179 ? "#000000" : "#ffffff";
}

export type HomeMember = { id: string; display_name: string; color: string };

export type HomePerson = {
  /** null: the second responsible adult has not joined the family yet. */
  memberId: string | null;
  name: string;
  color: string | null;
};

/** Stands in for the second member while the family has only one, so odd weeks still have a holder. */
const NOT_JOINED = "not-joined";

export type TodayView =
  | { kind: "no-rule"; childName: string }
  | {
      kind: "schedule";
      childName: string;
      /** null before the first handover or after the last rule ends. */
      current: (HomePerson & { reason: string | null }) | null;
      /** `to` is null when nobody is scheduled from then on (the last rule ends). */
      next: { atMs: number; when: string; to: HomePerson | null } | null;
    };

export type TodayInput = {
  now: Date;
  timezone: string;
  members: readonly HomeMember[];
  rules: readonly CustodyRule[];
  overrides: readonly CustodyOverride[];
  childName: string | null;
};

function person(memberId: string, members: readonly HomeMember[]): HomePerson {
  if (memberId === NOT_JOINED) return { memberId: null, name: "o outro responsável", color: null };
  const m = members.find((x) => x.id === memberId);
  return m
    ? { memberId, name: m.display_name, color: m.color }
    : { memberId, name: "responsável removido", color: null };
}

/** Everything the home shows, from the rows of one query. */
export function buildTodayView(input: TodayInput): TodayView {
  const childName = input.childName?.trim() || "A criança";
  if (input.rules.length === 0) return { kind: "no-rule", childName };

  const schedule: CustodySchedule = {
    timezone: input.timezone,
    memberIds: input.members.length === 1 ? [input.members[0].id, NOT_JOINED] : input.members.map((m) => m.id),
    rules: input.rules,
    overrides: input.overrides,
  };
  const nowMs = input.now.getTime();
  const holder = getCustodyHolder(input.now, schedule);
  const next = getNextHandover(input.now, schedule);

  return {
    kind: "schedule",
    childName,
    current: holder
      ? { ...person(holder.memberId, input.members), reason: holder.source === "override" ? holder.reason : null }
      : null,
    next: next
      ? {
          atMs: next.at.getTime(),
          when: formatHandoverMoment(next.at.getTime(), nowMs, input.timezone),
          to: next.holder ? person(next.holder.memberId, input.members) : null,
        }
      : null,
  };
}

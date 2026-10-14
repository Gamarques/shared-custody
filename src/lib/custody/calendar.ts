import type { CustodyHolder, CustodyOverride, CustodyRule } from "./holder";
import { getCustodyHolder } from "./holder";
import { dayNumber, localDayTimeToInstant, toWallClock } from "./timezone";
import { describeOverridePeriod } from "./override-form";
import { familySchedule, getNextChange, holderAndOverride, person, type HomeMember, type HomePerson } from "./today";

/**
 * Monthly calendar (RF-06, T-10): every day of the month grid colored by who has the child, with
 * each handover marked on the day (and at the time) it happens in the family zone (RNF-04).
 * Pure functions: the page passes `now` and the rows it read.
 */

const MS_PER_DAY = 86_400_000;
const MIDNIGHT = { hour: 0, minute: 0, second: 0 };

export const MONTHS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
] as const;

/** Column headers; the grid starts on Monday (ISO weeks, as in Portugal). */
export const WEEKDAY_HEADERS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"] as const;

/** Background of a day (or part of a day) with nobody scheduled, or a holder without a color. */
export const NO_HOLDER_COLOR = "#e5e7eb";

export type YearMonth = { year: number; month: number };

/** "2026-10" -> { year: 2026, month: 10 }; null when malformed. */
export function parseMonth(value: string | null | undefined): YearMonth | null {
  const m = /^(\d{4})-(\d{2})$/.exec(value ?? "");
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (year < 1970 || month < 1 || month > 12) return null;
  return { year, month };
}

export function formatMonth({ year, month }: YearMonth): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Month containing `nowMs` in the family zone. */
export function currentMonth(nowMs: number, timeZone: string): YearMonth {
  const w = toWallClock(nowMs, timeZone);
  return { year: w.year, month: w.month };
}

export function addMonths({ year, month }: YearMonth, delta: number): YearMonth {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

function isoDate(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * Days shown for the month: whole Monday-to-Sunday weeks covering it. `startMs`/`endMs` are
 * 00:00 local of the first day and of the day after the last one.
 */
export function calendarRange(ym: YearMonth, timeZone: string) {
  const first = dayNumber({ year: ym.year, month: ym.month, day: 1 });
  const next = addMonths(ym, 1);
  const last = dayNumber({ year: next.year, month: next.month, day: 1 }) - 1;
  const mondayIndex = (day: number) => (new Date(day * MS_PER_DAY).getUTCDay() + 6) % 7;
  const firstDay = first - mondayIndex(first);
  const lastDay = last + (6 - mondayIndex(last));
  return {
    firstDay,
    lastDay,
    startMs: localDayTimeToInstant(firstDay, MIDNIGHT, timeZone),
    endMs: localDayTimeToInstant(lastDay + 1, MIDNIGHT, timeZone),
  };
}

export type CalendarSegment = {
  /** null: nobody scheduled (before the first handover or after the last rule ends). */
  person: HomePerson | null;
  /** Share of the day, in percent, from 00:00 local. */
  fromPct: number;
  toPct: number;
  /** Override reason when an exception sets the holder. */
  reason: string | null;
  overrideId: string | null;
};

export type CalendarHandover = {
  atMs: number;
  /** Local time, "18:00". */
  time: string;
  from: HomePerson | null;
  to: HomePerson | null;
  /** Reason of the exception that starts here, if any. */
  reason: string | null;
  /** At 00:00 local: the day starts with the new holder. */
  atDayStart: boolean;
};

export type CalendarDay = {
  date: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  segments: CalendarSegment[];
  handovers: CalendarHandover[];
  /**
   * Reasons shown in the cell: an exception is labelled on the day it starts and again at the
   * start of each week row it spans, so every row of a long holiday says why.
   */
  labels: string[];
};

/** An exception in force during the month, for the list under the grid (RF-07). */
export type CalendarException = {
  id: string;
  person: HomePerson;
  reason: string;
  /** "de 24/12/2026 18:00 a 26/12/2026 18:00" in the family zone. */
  period: string;
};

export type MonthCalendar = {
  month: string;
  /** "Outubro de 2026". */
  title: string;
  prevMonth: string;
  nextMonth: string;
  /** Rows of 7 days, Monday first. */
  weeks: CalendarDay[][];
  /** Exceptions overlapping the month, by start. */
  exceptions: CalendarException[];
};

export type CalendarInput = {
  month: YearMonth;
  now: Date;
  timezone: string;
  members: readonly HomeMember[];
  rules: readonly CustodyRule[];
  overrides: readonly CustodyOverride[];
};

type Change = { atMs: number; holder: CustodyHolder | null };

/** Holder at `startMs` and every change of holder or of exception in (startMs, endMs). */
function changesBetween(input: CalendarInput, startMs: number, endMs: number): { initial: Change; changes: Change[] } {
  const schedule = familySchedule(input);
  const initial = { atMs: startMs, holder: getCustodyHolder(new Date(startMs), schedule) };
  const changes: Change[] = [];
  let t = startMs;
  for (;;) {
    const horizonDays = Math.ceil((endMs - t) / MS_PER_DAY) + 1;
    const next = getNextChange(new Date(t), schedule, horizonDays, holderAndOverride);
    if (!next || next.at.getTime() >= endMs) break;
    t = next.at.getTime();
    changes.push({ atMs: t, holder: next.holder });
  }
  return { initial, changes };
}

function percentOfDay(ms: number, dayStart: number, dayEnd: number): number {
  return Math.round(((ms - dayStart) / (dayEnd - dayStart)) * 10_000) / 100;
}

/** The month grid with each day's holders and handovers. */
export function buildMonthCalendar(input: CalendarInput): MonthCalendar {
  const { timezone, members } = input;
  const range = calendarRange(input.month, timezone);
  const today = dayNumber(toWallClock(input.now.getTime(), timezone));
  const toPerson = (h: CustodyHolder | null) => (h ? person(h.memberId, members) : null);
  const reasonOf = (h: CustodyHolder | null) => (h?.source === "override" ? h.reason : null);
  const segment = (h: CustodyHolder | null, fromPct: number, toPct: number): CalendarSegment => ({
    person: toPerson(h),
    fromPct,
    toPct,
    reason: reasonOf(h),
    overrideId: h?.source === "override" ? h.overrideId : null,
  });

  const { initial, changes } =
    input.rules.length > 0 || input.overrides.length > 0
      ? changesBetween(input, range.startMs, range.endMs)
      : { initial: { atMs: range.startMs, holder: null }, changes: [] };

  const days: CalendarDay[] = [];
  let current = initial;
  let ci = 0;
  // Exception in force at the end of the previous day, to label only where one starts.
  let previousOverrideId: string | null = null;
  for (let day = range.firstDay; day <= range.lastDay; day++) {
    const dayStart = localDayTimeToInstant(day, MIDNIGHT, timezone);
    const dayEnd = localDayTimeToInstant(day + 1, MIDNIGHT, timezone);
    const segments: CalendarSegment[] = [];
    const handovers: CalendarHandover[] = [];
    // A change exactly at 00:00 belongs to this day: it opens the first segment.
    let segStart = dayStart;
    for (; ci < changes.length && changes[ci].atMs < dayEnd; ci++) {
      const change = changes[ci];
      if (change.atMs > segStart) {
        segments.push(
          segment(current.holder, percentOfDay(segStart, dayStart, dayEnd), percentOfDay(change.atMs, dayStart, dayEnd)),
        );
        segStart = change.atMs;
      }
      // An exception that keeps the child with the same member is not a handover.
      if ((current.holder?.memberId ?? null) !== (change.holder?.memberId ?? null)) {
        const at = toWallClock(change.atMs, timezone);
        handovers.push({
          atMs: change.atMs,
          time: `${String(at.hour).padStart(2, "0")}:${String(at.minute).padStart(2, "0")}`,
          from: toPerson(current.holder),
          to: toPerson(change.holder),
          reason: reasonOf(change.holder),
          atDayStart: change.atMs === dayStart,
        });
      }
      current = change;
    }
    segments.push(segment(current.holder, percentOfDay(segStart, dayStart, dayEnd), 100));

    const rowStart = (day - range.firstDay) % 7 === 0;
    const labels: string[] = [];
    segments.forEach((s, i) => {
      // Segments split only where the holder or the exception changes, so a later segment with
      // an exception is always one that starts here.
      const continued = i === 0 && !rowStart && s.overrideId === previousOverrideId;
      if (s.reason && !continued && !labels.includes(s.reason)) labels.push(s.reason);
    });
    previousOverrideId = segments[segments.length - 1].overrideId;

    const date = new Date(day * MS_PER_DAY);
    days.push({
      date: isoDate(day),
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() + 1 === input.month.month,
      isToday: day === today,
      segments,
      handovers,
      labels,
    });
  }

  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  const next = addMonths(input.month, 1);
  const monthStart = localDayTimeToInstant(dayNumber({ ...input.month, day: 1 }), MIDNIGHT, timezone);
  const monthEnd = localDayTimeToInstant(dayNumber({ ...next, day: 1 }), MIDNIGHT, timezone);
  const exceptions = input.overrides
    .filter((o) => Date.parse(o.ends_at) > monthStart && Date.parse(o.starts_at) < monthEnd)
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || Date.parse(a.created_at) - Date.parse(b.created_at))
    .map((o) => ({
      id: o.id,
      person: person(o.member_id, members),
      reason: o.reason,
      period: describeOverridePeriod(o, timezone),
    }));

  return {
    month: formatMonth(input.month),
    title: `${MONTHS[input.month.month - 1]} de ${input.month.year}`,
    prevMonth: formatMonth(addMonths(input.month, -1)),
    nextMonth: formatMonth(next),
    weeks,
    exceptions,
  };
}

/** CSS background of a day: the holder's color, split left to right at each handover. */
export function dayBackground(segments: readonly CalendarSegment[]): string {
  const colorOf = (s: CalendarSegment) => s.person?.color ?? NO_HOLDER_COLOR;
  if (segments.length === 1) return colorOf(segments[0]);
  const stops = segments.map((s) => `${colorOf(s)} ${s.fromPct}% ${s.toPct}%`);
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

/**
 * Screen-reader text: "18/10: com Ana; troca às 18:00 para Bruno", with the reason of any
 * exception that applies ("troca às 18:00 para Bruno (Férias)", "exceção: Feriado").
 */
export function describeDay(day: CalendarDay): string {
  const [, month, d] = day.date.split("-");
  const who = (p: HomePerson | null) => (p ? `com ${p.name}` : "sem guarda definida");
  const first = day.segments[0];
  // A handover at 00:00 already says who has the child from the start of the day.
  const parts = day.handovers[0]?.atDayStart ? [] : [`${who(first.person)}${first.reason ? ` (${first.reason})` : ""}`];
  for (const h of day.handovers) {
    const reason = h.reason ? ` (${h.reason})` : "";
    parts.push(h.to ? `troca às ${h.time} para ${h.to.name}${reason}` : `às ${h.time} a guarda termina`);
  }
  for (const label of day.labels) {
    if (!parts.some((p) => p.includes(`(${label})`))) parts.push(`exceção: ${label}`);
  }
  return `${d}/${month}: ${parts.join("; ")}`;
}

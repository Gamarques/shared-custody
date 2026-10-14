/**
 * Wall-clock <-> instant conversion in an IANA time zone, using only Intl (no dependencies).
 * The host time zone never matters: every conversion names the zone explicitly (RNF-04).
 */

export type WallClock = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const MS_PER_DAY = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    // Throws RangeError for an unknown zone, which is what we want.
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Local date and time of an instant in the given zone. */
export function toWallClock(instantMs: number, timeZone: string): WallClock {
  const parts: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(new Date(instantMs))) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function wallClockAsUtcMs(w: WallClock): number {
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
}

/** UTC offset of the zone at an instant, in ms (Lisbon summer = +3_600_000). */
function offsetAt(instantMs: number, timeZone: string): number {
  const whole = Math.floor(instantMs / 1000) * 1000;
  return wallClockAsUtcMs(toWallClock(whole, timeZone)) - whole;
}

/**
 * Instant of a local date and time in the given zone.
 *
 * Same policy as Temporal's "compatible" disambiguation:
 * - a time skipped by a DST jump (spring forward) moves forward by the size of the jump
 *   (Lisbon 2026-03-29 01:30 does not exist and becomes 02:30 WEST);
 * - a time that happens twice (fall back) resolves to the first occurrence.
 */
export function wallClockToInstant(w: WallClock, timeZone: string): number {
  const asUtc = wallClockAsUtcMs(w);
  // Offsets a day either side are outside any single transition, so between them they cover
  // every offset the zone can have at this wall-clock time.
  const before = offsetAt(asUtc - MS_PER_DAY, timeZone);
  const after = offsetAt(asUtc + MS_PER_DAY, timeZone);
  const valid = [asUtc - before, asUtc - after].filter(
    (ms) => wallClockAsUtcMs(toWallClock(ms, timeZone)) === asUtc,
  );
  if (valid.length > 0) return Math.min(...valid);
  // Gap: read the wall clock with the offset in force before the jump.
  return asUtc - before;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;

/** Postgres `date` ("2026-01-04") to a day number (days since 1970-01-01). */
export function parseDate(value: string): number {
  const m = DATE.exec(value);
  if (!m) throw new Error(`Invalid date: ${value}`);
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const back = new Date(ms);
  if (back.getUTCDate() !== Number(m[3]) || back.getUTCMonth() !== Number(m[2]) - 1) {
    throw new Error(`Invalid date: ${value}`);
  }
  return ms / MS_PER_DAY;
}

/** Postgres `time` ("18:00" or "18:00:00") to hour, minute, second. */
export function parseTime(value: string): Pick<WallClock, "hour" | "minute" | "second"> {
  const m = TIME.exec(value);
  if (!m) throw new Error(`Invalid time: ${value}`);
  const [hour, minute, second] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
  if (hour > 23 || minute > 59 || second > 59) throw new Error(`Invalid time: ${value}`);
  return { hour, minute, second };
}

/** Day number of a wall-clock date. */
export function dayNumber(w: Pick<WallClock, "year" | "month" | "day">): number {
  return Date.UTC(w.year, w.month - 1, w.day) / MS_PER_DAY;
}

/** Instant of `time` on local day `day` (a day number) in the zone. */
export function localDayTimeToInstant(
  day: number,
  time: Pick<WallClock, "hour" | "minute" | "second">,
  timeZone: string,
): number {
  const d = new Date(day * MS_PER_DAY);
  return wallClockToInstant(
    { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), ...time },
    timeZone,
  );
}

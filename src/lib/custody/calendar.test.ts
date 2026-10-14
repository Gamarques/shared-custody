import { describe, expect, it } from "vitest";
import {
  addMonths,
  buildMonthCalendar,
  calendarRange,
  currentMonth,
  dayBackground,
  describeDay,
  NO_HOLDER_COLOR,
  parseMonth,
  type CalendarDay,
  type CalendarInput,
  type MonthCalendar,
} from "./calendar";
import { getCustodyHolder, type CustodyOverride, type CustodyRule } from "./holder";
import { localDayTimeToInstant, parseDate } from "./timezone";
import { familySchedule } from "./today";

const TZ = "Europe/Lisbon";
const members = [
  { id: "ana", display_name: "Ana", color: "#2f6f5e" },
  { id: "bruno", display_name: "Bruno", color: "#fde047" },
];
const rule: CustodyRule = {
  id: "r1",
  starts_on: "2026-01-04", // a Sunday
  first_member_id: "ana",
  handover_weekday: 0,
  handover_time: "18:00:00",
  valid_from: "2026-01-04",
  valid_to: null,
  created_at: "2026-01-01T10:00:00Z",
};

function input(month: string, extra: Partial<CalendarInput> = {}): CalendarInput {
  return {
    month: parseMonth(month)!,
    now: new Date("2026-10-14T09:00:00Z"),
    timezone: TZ,
    members,
    rules: [rule],
    overrides: [],
    ...extra,
  };
}

function days(cal: MonthCalendar): CalendarDay[] {
  return cal.weeks.flat();
}

function day(cal: MonthCalendar, date: string): CalendarDay {
  const d = days(cal).find((x) => x.date === date);
  if (!d) throw new Error(`${date} not in grid`);
  return d;
}

/** Holder names over the day, e.g. ["Ana", "Bruno"] on a handover day. */
function names(d: CalendarDay): (string | null)[] {
  return d.segments.map((s) => s.person?.name ?? null);
}

/** Every handover in the grid as "YYYY-MM-DD HH:MM from>to". */
function handovers(cal: MonthCalendar): string[] {
  return days(cal).flatMap((d) =>
    d.handovers.map((h) => `${d.date} ${h.time} ${h.from?.name ?? "-"}>${h.to?.name ?? "-"}`),
  );
}

/** Each segment's holder must be what getCustodyHolder says in the middle of that segment. */
function expectAgreesWithHolder(cal: MonthCalendar, inp: CalendarInput) {
  const schedule = familySchedule(inp);
  for (const d of days(cal)) {
    const dayNum = parseDate(d.date);
    const start = localDayTimeToInstant(dayNum, { hour: 0, minute: 0, second: 0 }, inp.timezone);
    const end = localDayTimeToInstant(dayNum + 1, { hour: 0, minute: 0, second: 0 }, inp.timezone);
    for (const s of d.segments) {
      const mid = start + ((s.fromPct + s.toPct) / 200) * (end - start);
      const holder = getCustodyHolder(new Date(mid), schedule);
      expect([d.date, holder?.memberId ?? null]).toEqual([d.date, s.person?.memberId ?? null]);
    }
    for (const h of d.handovers) {
      expect(getCustodyHolder(new Date(h.atMs - 1), schedule)?.memberId ?? null).toBe(h.from?.memberId ?? null);
      expect(getCustodyHolder(new Date(h.atMs), schedule)?.memberId ?? null).toBe(h.to?.memberId ?? null);
    }
  }
}

describe("month helpers", () => {
  it("parses and formats months", () => {
    expect(parseMonth("2026-10")).toEqual({ year: 2026, month: 10 });
    for (const bad of ["2026-13", "2026-00", "2026-1", "26-10", "", null, undefined, "2026-10-01"]) {
      expect(parseMonth(bad)).toBeNull();
    }
    expect(addMonths({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
  });

  it("takes the current month in the family zone", () => {
    // 2026-10-31 23:30 UTC is already 2026-11-01 in Tokyo, still October in Lisbon.
    const ms = Date.parse("2026-10-31T23:30:00Z");
    expect(currentMonth(ms, TZ)).toEqual({ year: 2026, month: 10 });
    expect(currentMonth(ms, "Asia/Tokyo")).toEqual({ year: 2026, month: 11 });
  });

  it("covers the month with whole Monday-to-Sunday weeks", () => {
    const shape = (m: string) => {
      const cal = buildMonthCalendar(input(m));
      const all = days(cal);
      return [all[0].date, all.at(-1)!.date, cal.weeks.length, all.filter((d) => d.inMonth).length];
    };
    expect(shape("2026-10")).toEqual(["2026-09-28", "2026-11-01", 5, 31]);
    expect(shape("2026-08")).toEqual(["2026-07-27", "2026-09-06", 6, 31]);
    expect(shape("2027-02")).toEqual(["2027-02-01", "2027-02-28", 4, 28]);
    expect(shape("2028-02")).toEqual(["2028-01-31", "2028-03-05", 5, 29]);
  });

  it("gives the query range as local midnights", () => {
    const r = calendarRange({ year: 2026, month: 10 }, TZ);
    expect(new Date(r.startMs).toISOString()).toBe("2026-09-27T23:00:00.000Z"); // WEST
    expect(new Date(r.endMs).toISOString()).toBe("2026-11-02T00:00:00.000Z"); // WET
  });
});

describe("buildMonthCalendar (RF-06)", () => {
  it("colors October 2026 week by week and marks each Sunday 18:00 handover", () => {
    const inp = input("2026-10");
    const cal = buildMonthCalendar(inp);
    expect(cal).toMatchObject({ month: "2026-10", title: "Outubro de 2026", prevMonth: "2026-09", nextMonth: "2026-11" });
    expect(handovers(cal)).toEqual([
      "2026-10-04 18:00 Ana>Bruno",
      "2026-10-11 18:00 Bruno>Ana",
      "2026-10-18 18:00 Ana>Bruno",
      "2026-10-25 18:00 Bruno>Ana",
      "2026-11-01 18:00 Ana>Bruno",
    ]);
    // Each Monday-to-Saturday run has one holder; Sunday is split at the handover.
    expect(cal.weeks.map((w) => w.slice(0, 6).map((d) => names(d).join("/")))).toEqual([
      Array(6).fill("Ana"),
      Array(6).fill("Bruno"),
      Array(6).fill("Ana"),
      Array(6).fill("Bruno"),
      Array(6).fill("Ana"),
    ]);
    expect(names(day(cal, "2026-10-18"))).toEqual(["Ana", "Bruno"]);
    expect(day(cal, "2026-10-18").segments.map((s) => [s.fromPct, s.toPct])).toEqual([
      [0, 75],
      [75, 100],
    ]);
    expect(day(cal, "2026-10-14").isToday).toBe(true);
    expect(days(cal).filter((d) => d.isToday)).toHaveLength(1);
    expect(day(cal, "2026-09-28").inMonth).toBe(false);
    expectAgreesWithHolder(cal, inp);
  });

  it("keeps the handover at 18:00 local on the 25-hour day DST ends", () => {
    // Lisbon leaves summer time on 2026-10-25: 18:00 WET is 19 hours into that day.
    const d = day(buildMonthCalendar(input("2026-10")), "2026-10-25");
    expect(d.handovers[0]).toMatchObject({ time: "18:00", atMs: Date.parse("2026-10-25T18:00:00Z") });
    expect(d.segments.map((s) => s.toPct)).toEqual([76, 100]);
  });

  it("keeps the handover at 18:00 local on the 23-hour day DST starts", () => {
    const inp = input("2026-03");
    const cal = buildMonthCalendar(inp);
    const d = day(cal, "2026-03-29");
    expect(d.handovers[0]).toMatchObject({ time: "18:00", atMs: Date.parse("2026-03-29T17:00:00Z") });
    expect(d.segments[0].toPct).toBe(73.91); // 17 of 23 hours
    expectAgreesWithHolder(cal, inp);
  });

  it("crosses the year with the right holder", () => {
    const inp = input("2026-12");
    const cal = buildMonthCalendar(inp);
    expect(handovers(cal)).toEqual([
      "2026-12-06 18:00 Bruno>Ana", // week 48
      "2026-12-13 18:00 Ana>Bruno",
      "2026-12-20 18:00 Bruno>Ana",
      "2026-12-27 18:00 Ana>Bruno",
      "2027-01-03 18:00 Bruno>Ana", // week 52
    ]);
    expect(day(cal, "2027-01-01")).toMatchObject({ inMonth: false });
    expect(names(day(cal, "2027-01-01"))).toEqual(["Bruno"]);
    expectAgreesWithHolder(cal, inp);
  });

  it("leaves the days before the first handover without a holder", () => {
    const inp = input("2026-01");
    const cal = buildMonthCalendar(inp);
    expect(names(day(cal, "2026-01-03"))).toEqual([null]);
    expect(names(day(cal, "2026-01-04"))).toEqual([null, "Ana"]);
    expect(handovers(cal)[0]).toBe("2026-01-04 18:00 ->Ana");
    expect(dayBackground(day(cal, "2026-01-03").segments)).toBe(NO_HOLDER_COLOR);
    expectAgreesWithHolder(cal, inp);
  });

  it("follows a rule change on the new weekday and keeps the earlier weeks", () => {
    const changed: CustodyRule = {
      id: "r2",
      starts_on: "2026-10-23", // Friday
      first_member_id: "ana",
      handover_weekday: 5,
      handover_time: "20:00",
      valid_from: "2026-10-20",
      valid_to: null,
      created_at: "2026-10-19T10:00:00Z",
    };
    const inp = input("2026-10", { rules: [rule, changed] });
    const cal = buildMonthCalendar(inp);
    expect(handovers(cal)).toEqual([
      "2026-10-04 18:00 Ana>Bruno",
      "2026-10-11 18:00 Bruno>Ana",
      "2026-10-18 18:00 Ana>Bruno",
      "2026-10-23 20:00 Bruno>Ana",
      "2026-10-30 20:00 Ana>Bruno",
    ]);
    expect(names(day(cal, "2026-10-25"))).toEqual(["Ana"]);
    expectAgreesWithHolder(cal, inp);
  });

  it("applies an override and shows its reason", () => {
    const override: CustodyOverride = {
      id: "o1",
      starts_at: "2026-10-14T00:00:00Z", // 01:00 in Lisbon
      ends_at: "2026-10-15T08:00:00Z", // 09:00 in Lisbon
      member_id: "bruno",
      reason: "Consulta no dentista",
      created_at: "2026-10-10T10:00:00Z",
    };
    const inp = input("2026-10", { overrides: [override] });
    const cal = buildMonthCalendar(inp);
    const d14 = day(cal, "2026-10-14");
    expect(names(d14)).toEqual(["Ana", "Bruno"]);
    expect(d14.segments[1]).toMatchObject({ fromPct: 4.17, toPct: 100, reason: "Consulta no dentista" });
    expect(names(day(cal, "2026-10-15"))).toEqual(["Bruno", "Ana"]);
    expect(handovers(cal)).toContain("2026-10-14 01:00 Ana>Bruno");
    expect(handovers(cal)).toContain("2026-10-15 09:00 Bruno>Ana");
    expect(describeDay(d14)).toBe("14/10: com Ana; troca às 01:00 para Bruno");
    expect(describeDay(day(cal, "2026-10-15"))).toBe("15/10: com Bruno (Consulta no dentista); troca às 09:00 para Ana");
    expectAgreesWithHolder(cal, inp);
  });

  it("marks the end of the last rule", () => {
    const inp = input("2026-10", { rules: [{ ...rule, valid_to: "2026-10-20" }] });
    const cal = buildMonthCalendar(inp);
    expect(handovers(cal).at(-1)).toBe("2026-10-20 00:00 Bruno>-");
    expect(names(day(cal, "2026-10-20"))).toEqual([null]);
    expect(describeDay(day(cal, "2026-10-20"))).toBe("20/10: sem guarda definida; às 00:00 a guarda termina");
    expectAgreesWithHolder(cal, inp);
  });

  it("shows the odd weeks of a one-member family as the other responsible adult", () => {
    const cal = buildMonthCalendar(input("2026-10", { members: [members[0]] }));
    expect(names(day(cal, "2026-10-07"))).toEqual(["o outro responsável"]);
    expect(dayBackground(day(cal, "2026-10-07").segments)).toBe(NO_HOLDER_COLOR);
    expect(handovers(cal)[0]).toBe("2026-10-04 18:00 Ana>o outro responsável");
  });

  it("has no handovers and no holder without a rule", () => {
    const cal = buildMonthCalendar(input("2026-10", { rules: [] }));
    expect(handovers(cal)).toEqual([]);
    expect(days(cal).every((d) => names(d).join() === "")).toBe(true);
  });
});

describe("dayBackground", () => {
  it("is the holder color, or a left-to-right split on a handover day", () => {
    const cal = buildMonthCalendar(input("2026-10"));
    expect(dayBackground(day(cal, "2026-10-14").segments)).toBe("#2f6f5e");
    expect(dayBackground(day(cal, "2026-10-18").segments)).toBe(
      "linear-gradient(to right, #2f6f5e 0% 75%, #fde047 75% 100%)",
    );
  });
});

import { describe, expect, it } from "vitest";
import type { CustodyOverride, CustodyRule, CustodySchedule } from "./holder";
import {
  buildTodayView,
  formatCountdown,
  formatHandoverMoment,
  getNextHandover,
  textColorOn,
  type HomeMember,
} from "./today";

const A = "member-a";
const B = "member-b";

// Europe/Lisbon: WET (UTC+0) in winter, WEST (UTC+1) until 2026-10-25 01:00Z.
// 2026-10-14 is a Wednesday; Sunday 18:00 Lisbon on 2026-10-18 is 17:00Z.
const sunday18: CustodyRule = {
  id: "rule-sunday",
  starts_on: "2026-01-04", // a Sunday
  first_member_id: A,
  handover_weekday: 0,
  handover_time: "18:00:00",
  valid_from: "2026-01-04",
  valid_to: null,
  created_at: "2026-01-01T10:00:00Z",
};

function schedule(rules: CustodyRule[], overrides: CustodyOverride[] = []): CustodySchedule {
  return { timezone: "Europe/Lisbon", memberIds: [A, B], rules, overrides };
}

function next(iso: string, s: CustodySchedule) {
  const n = getNextHandover(new Date(iso), s);
  return n && { at: n.at.toISOString(), memberId: n.holder?.memberId ?? null };
}

describe("getNextHandover", () => {
  const s = schedule([sunday18]);

  it("finds the next Sunday 18:00 in the family zone (summer time)", () => {
    // Week 40 (2026-10-11 .. 2026-10-18) is even: A has the child, B receives it.
    expect(next("2026-10-14T09:00:00Z", s)).toEqual({ at: "2026-10-18T17:00:00.000Z", memberId: B });
  });

  it("uses winter time after the DST change", () => {
    expect(next("2026-10-19T09:00:00Z", s)).toEqual({ at: "2026-10-25T18:00:00.000Z", memberId: A });
  });

  it("on handover day, points to that same day until the handover, then to next week", () => {
    expect(next("2026-10-18T16:59:59Z", s)).toEqual({ at: "2026-10-18T17:00:00.000Z", memberId: B });
    expect(next("2026-10-18T17:00:00Z", s)).toEqual({ at: "2026-10-25T18:00:00.000Z", memberId: A });
  });

  it("before the rule starts, the next handover is the first one", () => {
    expect(next("2025-12-30T12:00:00Z", s)).toEqual({ at: "2026-01-04T18:00:00.000Z", memberId: A });
  });

  it("crosses the year end", () => {
    const yearly = schedule([{ ...sunday18, starts_on: "2026-12-27", valid_from: "2026-12-27" }]);
    expect(next("2026-12-29T12:00:00Z", yearly)).toEqual({ at: "2027-01-03T18:00:00.000Z", memberId: B });
  });

  it("skips a rule handover hidden by an override and returns at its end", () => {
    // B keeps the child through the Sunday handover that would give it back to A.
    const holiday: CustodyOverride = {
      id: "o1",
      starts_at: "2026-10-24T10:00:00Z",
      ends_at: "2026-10-27T10:00:00Z",
      member_id: B,
      reason: "Feriado",
      created_at: "2026-10-01T10:00:00Z",
    };
    const withHoliday = schedule([sunday18], [holiday]);
    // B has week 41 (from 2026-10-18); Sunday 2026-10-25 would hand over to A, but the override holds.
    expect(next("2026-10-19T12:00:00Z", withHoliday)).toEqual({ at: "2026-10-27T10:00:00.000Z", memberId: A });
  });

  it("starts at an override that gives the child to the other member", () => {
    const visit: CustodyOverride = {
      id: "o2",
      starts_at: "2026-10-15T08:00:00Z",
      ends_at: "2026-10-16T08:00:00Z",
      member_id: B,
      reason: "Consulta",
      created_at: "2026-10-01T10:00:00Z",
    };
    const s2 = schedule([sunday18], [visit]);
    expect(next("2026-10-14T12:00:00Z", s2)).toEqual({ at: "2026-10-15T08:00:00.000Z", memberId: B });
    expect(next("2026-10-15T12:00:00Z", s2)).toEqual({ at: "2026-10-16T08:00:00.000Z", memberId: A });
  });

  it("follows a rule change to its first handover", () => {
    // From 2026-10-16, Friday 19:00 with B first: first handover Friday 2026-10-23.
    const friday: CustodyRule = {
      id: "rule-friday",
      starts_on: "2026-10-23",
      first_member_id: B,
      handover_weekday: 5,
      handover_time: "19:00",
      valid_from: "2026-10-16",
      valid_to: null,
      created_at: "2026-10-10T10:00:00Z",
    };
    const s2 = schedule([sunday18, friday]);
    // Old rule still hands over on Sunday 18th (A -> B); B keeps it through Friday 23rd (B first).
    expect(next("2026-10-14T12:00:00Z", s2)).toEqual({ at: "2026-10-18T17:00:00.000Z", memberId: B });
    expect(next("2026-10-19T12:00:00Z", s2)).toEqual({ at: "2026-10-30T19:00:00.000Z", memberId: A });
  });

  it("reports the end of the last rule as a change to nobody", () => {
    const ending = schedule([{ ...sunday18, valid_to: "2026-10-16" }]);
    expect(next("2026-10-14T12:00:00Z", ending)).toEqual({ at: "2026-10-15T23:00:00.000Z", memberId: null });
  });

  it("returns null when nothing changes within the horizon", () => {
    expect(getNextHandover(new Date("2026-10-14T12:00:00Z"), schedule([]))).toBeNull();
  });

  it("rejects an invalid instant", () => {
    expect(() => getNextHandover(new Date("nope"), s)).toThrow("Invalid instant");
  });
});

describe("formatCountdown", () => {
  const t0 = Date.parse("2026-10-14T12:00:00Z");
  const after = (d: number, h = 0, m = 0, s = 0) => t0 + ((d * 24 + h) * 60 + m) * 60_000 + s * 1000;

  it("shows days and hours when a day or more is left", () => {
    expect(formatCountdown(t0, after(4, 5, 30))).toBe("Faltam 4 dias e 5 horas");
    expect(formatCountdown(t0, after(1, 1))).toBe("Falta 1 dia e 1 hora");
    expect(formatCountdown(t0, after(2))).toBe("Faltam 2 dias");
  });

  it("shows hours and minutes under a day", () => {
    expect(formatCountdown(t0, after(0, 23, 59, 59))).toBe("Faltam 23 horas e 59 minutos");
    expect(formatCountdown(t0, after(0, 1, 1))).toBe("Falta 1 hora e 1 minuto");
    expect(formatCountdown(t0, after(0, 3))).toBe("Faltam 3 horas");
  });

  it("shows minutes under an hour, and never rounds up", () => {
    expect(formatCountdown(t0, after(0, 0, 12, 59))).toBe("Faltam 12 minutos");
    expect(formatCountdown(t0, after(0, 0, 1))).toBe("Falta 1 minuto");
    expect(formatCountdown(t0, after(0, 0, 0, 59))).toBe("Falta menos de 1 minuto");
    expect(formatCountdown(t0, t0 - 5000)).toBe("Falta menos de 1 minuto");
  });
});

describe("formatHandoverMoment", () => {
  const now = Date.parse("2026-10-14T09:00:00Z"); // Wednesday 10:00 in Lisbon

  it("says today and tomorrow in the family zone", () => {
    expect(formatHandoverMoment(Date.parse("2026-10-14T17:00:00Z"), now, "Europe/Lisbon")).toBe("hoje às 18:00");
    expect(formatHandoverMoment(Date.parse("2026-10-15T17:00:00Z"), now, "Europe/Lisbon")).toBe("amanhã às 18:00");
  });

  it("uses the family day, not UTC, around midnight", () => {
    // 23:30Z on the 14th is already 00:30 on the 15th in Lisbon (UTC+1).
    expect(formatHandoverMoment(Date.parse("2026-10-14T23:30:00Z"), now, "Europe/Lisbon")).toBe("amanhã às 00:30");
    // In São Paulo (UTC-3) it is still the 14th, 20:30.
    expect(formatHandoverMoment(Date.parse("2026-10-14T23:30:00Z"), now, "America/Sao_Paulo")).toBe("hoje às 20:30");
  });

  it("names the weekday and date further ahead, with the year only when it changes", () => {
    expect(formatHandoverMoment(Date.parse("2026-10-18T17:00:00Z"), now, "Europe/Lisbon")).toBe("domingo, 18/10, às 18:00");
    expect(formatHandoverMoment(Date.parse("2027-01-03T18:00:00Z"), now, "Europe/Lisbon")).toBe(
      "domingo, 03/01/2027, às 18:00",
    );
  });
});

describe("textColorOn", () => {
  it("picks white on dark colors and black on light ones", () => {
    expect(textColorOn("#2f6f5e")).toBe("#ffffff");
    expect(textColorOn("#1d4ed8")).toBe("#ffffff");
    expect(textColorOn("#fde047")).toBe("#000000");
    expect(textColorOn("#FFFFFF")).toBe("#000000");
    expect(textColorOn("invalid")).toBe("#000000");
  });
});

describe("buildTodayView", () => {
  const members: HomeMember[] = [
    { id: A, display_name: "Ana", color: "#2f6f5e" },
    { id: B, display_name: "Bruno", color: "#1d4ed8" },
  ];
  const base = {
    now: new Date("2026-10-14T09:00:00Z"),
    timezone: "Europe/Lisbon",
    members,
    rules: [sunday18],
    overrides: [],
    childName: "Lia",
  };

  it("shows who has the child, with color, and the next handover", () => {
    expect(buildTodayView(base)).toEqual({
      kind: "schedule",
      childName: "Lia",
      current: { memberId: A, name: "Ana", color: "#2f6f5e", reason: null },
      next: {
        atMs: Date.parse("2026-10-18T17:00:00Z"),
        when: "domingo, 18/10, às 18:00",
        to: { memberId: B, name: "Bruno", color: "#1d4ed8" },
      },
    });
  });

  it("asks for a rule when there is none, with a default child label", () => {
    expect(buildTodayView({ ...base, rules: [], childName: null })).toEqual({ kind: "no-rule", childName: "A criança" });
  });

  it("gives the reason when an override is in force", () => {
    const view = buildTodayView({
      ...base,
      overrides: [
        {
          id: "o1",
          starts_at: "2026-10-14T00:00:00Z",
          ends_at: "2026-10-15T00:00:00Z",
          member_id: B,
          reason: "Aniversário do avô",
          created_at: "2026-10-01T00:00:00Z",
        },
      ],
    });
    expect(view).toMatchObject({
      current: { name: "Bruno", reason: "Aniversário do avô" },
      next: { atMs: Date.parse("2026-10-15T00:00:00Z"), when: "amanhã às 01:00", to: { name: "Ana" } },
    });
  });

  it("has no current holder before the first handover", () => {
    const view = buildTodayView({ ...base, now: new Date("2026-01-02T12:00:00Z") });
    expect(view).toMatchObject({ current: null, next: { when: "domingo, 04/01, às 18:00", to: { name: "Ana" } } });
  });

  it("names the other responsible adult while the family has only one member", () => {
    const view = buildTodayView({ ...base, members: [members[0]] });
    expect(view).toMatchObject({
      current: { memberId: A, name: "Ana" },
      next: { to: { memberId: null, name: "o outro responsável", color: null } },
    });
    // Odd week: the child is with the member who has not joined yet.
    const odd = buildTodayView({ ...base, members: [members[0]], now: new Date("2026-10-20T12:00:00Z") });
    expect(odd).toMatchObject({ current: { memberId: null, name: "o outro responsável" }, next: { to: { name: "Ana" } } });
  });
});

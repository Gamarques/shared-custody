import { describe, expect, it } from "vitest";
import { type CustodyOverride, type CustodyRule, type CustodySchedule, getCustodyHolder } from "./holder";

const A = "member-a";
const B = "member-b";

// Europe/Lisbon: WET (UTC+0) in winter, WEST (UTC+1) from 2026-03-29 01:00Z to 2026-10-25 01:00Z.
// Sunday 18:00 is therefore 18:00Z in winter and 17:00Z in summer.
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

function schedule(rules: CustodyRule[], extra: Partial<CustodySchedule> = {}): CustodySchedule {
  return { timezone: "Europe/Lisbon", memberIds: [A, B], rules, ...extra };
}

function holder(iso: string, s: CustodySchedule) {
  return getCustodyHolder(new Date(iso), s);
}

function who(iso: string, s: CustodySchedule) {
  return holder(iso, s)?.memberId ?? null;
}

describe("getCustodyHolder: handover on Sunday at 18:00", () => {
  const s = schedule([sunday18]);

  it("has no holder before the first handover", () => {
    expect(holder("2026-01-04T17:59:59Z", s)).toBeNull();
    expect(holder("2025-12-01T12:00:00Z", s)).toBeNull();
  });

  it("starts with first_member_id at the first handover (week 0)", () => {
    expect(holder("2026-01-04T18:00:00Z", s)).toEqual({
      memberId: A,
      source: "rule",
      ruleId: "rule-sunday",
      weekIndex: 0,
    });
  });

  it("switches exactly at 18:00 the next Sunday, not a second earlier", () => {
    expect(holder("2026-01-11T17:59:59.999Z", s)).toMatchObject({ memberId: A, weekIndex: 0 });
    expect(holder("2026-01-11T18:00:00Z", s)).toMatchObject({ memberId: B, weekIndex: 1 });
  });

  it("alternates every week (even = first member, odd = the other)", () => {
    expect(holder("2026-01-14T09:00:00Z", s)).toMatchObject({ memberId: B, weekIndex: 1 });
    expect(holder("2026-01-18T18:00:00Z", s)).toMatchObject({ memberId: A, weekIndex: 2 });
    expect(holder("2026-01-25T18:00:00Z", s)).toMatchObject({ memberId: B, weekIndex: 3 });
  });

  it("keeps the previous holder all Sunday until the handover time", () => {
    expect(who("2026-01-18T00:00:00Z", s)).toBe(B);
    expect(who("2026-01-18T12:00:00Z", s)).toBe(B);
  });
});

describe("getCustodyHolder: year turn", () => {
  const s = schedule([sunday18]);

  it("keeps the week that spans 31 Dec -> 1 Jan with the same holder", () => {
    // 2026-12-27 is 357 days (51 weeks) after 2026-01-04: odd week, B.
    expect(holder("2026-12-27T18:00:00Z", s)).toMatchObject({ memberId: B, weekIndex: 51 });
    expect(holder("2026-12-31T23:59:59Z", s)).toMatchObject({ memberId: B, weekIndex: 51 });
    expect(holder("2027-01-01T00:00:00Z", s)).toMatchObject({ memberId: B, weekIndex: 51 });
    expect(holder("2027-01-03T17:59:59Z", s)).toMatchObject({ memberId: B, weekIndex: 51 });
  });

  it("switches on the first Sunday of the new year and keeps counting weeks", () => {
    expect(holder("2027-01-03T18:00:00Z", s)).toMatchObject({ memberId: A, weekIndex: 52 });
    expect(holder("2027-01-10T18:00:00Z", s)).toMatchObject({ memberId: B, weekIndex: 53 });
  });

  it("counts a leap year correctly (29 Feb 2028)", () => {
    // 2028-02-27 is 784 days (112 weeks) after 2026-01-04, and still WET (18:00Z).
    expect(holder("2028-02-27T17:59:59Z", s)).toMatchObject({ memberId: B, weekIndex: 111 });
    expect(holder("2028-02-27T18:00:00Z", s)).toMatchObject({ memberId: A, weekIndex: 112 });
    expect(who("2028-02-29T12:00:00Z", s)).toBe(A);
  });

  it("handles a year turn that falls exactly on handover day", () => {
    // Friday 2027-01-01 at 18:00 is the handover itself.
    const friday: CustodyRule = {
      ...sunday18,
      id: "rule-friday",
      starts_on: "2026-12-04",
      handover_weekday: 5,
      valid_from: "2026-12-04",
    };
    const sf = schedule([friday]);
    expect(holder("2027-01-01T17:59:59Z", sf)).toMatchObject({ memberId: B, weekIndex: 3 });
    expect(holder("2027-01-01T18:00:00Z", sf)).toMatchObject({ memberId: A, weekIndex: 4 });
  });
});

describe("getCustodyHolder: daylight saving time (Europe/Lisbon)", () => {
  const s = schedule([sunday18]);

  it("hands over at 18:00 local (17:00Z) on the Sunday clocks go forward", () => {
    // 2026-03-29 is week 12 (even, A). A naive 7×24h count would switch at 18:00Z.
    expect(holder("2026-03-29T16:59:59Z", s)).toMatchObject({ memberId: B, weekIndex: 11 });
    expect(holder("2026-03-29T17:00:00Z", s)).toMatchObject({ memberId: A, weekIndex: 12 });
    expect(who("2026-03-29T17:30:00Z", s)).toBe(A);
  });

  it("hands over at 18:00 local all summer", () => {
    // 2026-07-12 is week 27 (odd, B).
    expect(who("2026-07-12T16:59:59Z", s)).toBe(A);
    expect(who("2026-07-12T17:00:00Z", s)).toBe(B);
  });

  it("hands over at 18:00 local (18:00Z) on the Sunday clocks go back", () => {
    // 2026-10-25 is week 42 (even, A). That week lasted 7 days + 1 hour in real time.
    expect(holder("2026-10-25T17:00:00Z", s)).toMatchObject({ memberId: B, weekIndex: 41 });
    expect(holder("2026-10-25T17:59:59Z", s)).toMatchObject({ memberId: B, weekIndex: 41 });
    expect(holder("2026-10-25T18:00:00Z", s)).toMatchObject({ memberId: A, weekIndex: 42 });
  });

  describe("handover time inside the DST transition (01:30 on Sunday)", () => {
    const night = schedule([
      {
        ...sunday18,
        id: "rule-night",
        starts_on: "2026-03-22",
        handover_time: "01:30",
        valid_from: "2026-03-22",
      },
    ]);

    it("spring forward: 01:30 does not exist, the handover happens at 02:30 WEST (01:30Z)", () => {
      expect(holder("2026-03-29T00:59:59Z", night)).toMatchObject({ memberId: A, weekIndex: 0 });
      expect(holder("2026-03-29T01:29:59Z", night)).toMatchObject({ memberId: A, weekIndex: 0 });
      expect(holder("2026-03-29T01:30:00Z", night)).toMatchObject({ memberId: B, weekIndex: 1 });
    });

    it("fall back: 01:30 happens twice, the handover is the first one (00:30Z)", () => {
      // 2026-10-25 is 217 days (31 weeks) after 2026-03-22.
      expect(holder("2026-10-25T00:29:59Z", night)).toMatchObject({ memberId: A, weekIndex: 30 });
      expect(holder("2026-10-25T00:30:00Z", night)).toMatchObject({ memberId: B, weekIndex: 31 });
      // The second 01:30 (01:30Z) is not a second handover.
      expect(holder("2026-10-25T01:30:00Z", night)).toMatchObject({ memberId: B, weekIndex: 31 });
    });
  });
});

describe("getCustodyHolder: other time zones", () => {
  it("uses the family zone, not UTC (America/Sao_Paulo, UTC-3)", () => {
    const s = schedule([sunday18], { timezone: "America/Sao_Paulo" });
    expect(who("2026-01-04T20:59:59Z", s)).toBeNull();
    expect(who("2026-01-04T21:00:00Z", s)).toBe(A);
    expect(who("2026-01-11T20:59:59Z", s)).toBe(A);
    expect(who("2026-01-11T21:00:00Z", s)).toBe(B);
  });

  it("follows the zone's own DST dates (America/New_York, 2026-03-08)", () => {
    const s = schedule([{ ...sunday18, starts_on: "2026-03-01", valid_from: "2026-03-01" }], {
      timezone: "America/New_York",
    });
    expect(who("2026-03-01T23:00:00Z", s)).toBe(A); // 18:00 EST
    expect(who("2026-03-08T21:59:59Z", s)).toBe(A);
    expect(who("2026-03-08T22:00:00Z", s)).toBe(B); // 18:00 EDT
  });

  it("throws on an unknown zone", () => {
    expect(() => holder("2026-02-01T12:00:00Z", schedule([sunday18], { timezone: "Mars/Olympus" }))).toThrow(
      RangeError,
    );
  });
});

describe("getCustodyHolder: rule change", () => {
  // From the week of 2026-06-01 the handover moves to Friday 19:00 and B starts.
  const friday19: CustodyRule = {
    id: "rule-friday",
    starts_on: "2026-06-05", // a Friday
    first_member_id: B,
    handover_weekday: 5,
    handover_time: "19:00",
    valid_from: "2026-06-01",
    valid_to: null,
    created_at: "2026-05-20T10:00:00Z",
  };
  const closedSunday = { ...sunday18, valid_to: "2026-06-01" };

  it("keeps past weeks on the old rule", () => {
    const s = schedule([closedSunday, friday19]);
    expect(holder("2026-03-01T12:00:00Z", s)).toMatchObject({ ruleId: "rule-sunday", memberId: B, weekIndex: 7 });
    expect(holder("2026-05-31T17:00:00Z", s)).toMatchObject({ ruleId: "rule-sunday", memberId: B, weekIndex: 21 });
  });

  it("keeps the old rule until the first handover of the new one, with no gap", () => {
    const s = schedule([closedSunday, friday19]);
    // valid_to of the old rule (2026-06-01) is before the new first handover (Fri 19:00 WEST).
    expect(holder("2026-06-03T12:00:00Z", s)).toMatchObject({ ruleId: "rule-sunday", memberId: B });
    expect(holder("2026-06-05T17:59:59Z", s)).toMatchObject({ ruleId: "rule-sunday", memberId: B });
    expect(holder("2026-06-05T18:00:00Z", s)).toEqual({
      memberId: B,
      source: "rule",
      ruleId: "rule-friday",
      weekIndex: 0,
    });
  });

  it("follows only the new rule afterwards", () => {
    const s = schedule([closedSunday, friday19]);
    // The old rule would hand over to A on Sunday 2026-06-07; the new one does not.
    expect(holder("2026-06-07T17:00:00Z", s)).toMatchObject({ ruleId: "rule-friday", memberId: B });
    expect(holder("2026-06-12T17:59:59Z", s)).toMatchObject({ memberId: B, weekIndex: 0 });
    expect(holder("2026-06-12T18:00:00Z", s)).toMatchObject({ memberId: A, weekIndex: 1 });
  });

  it("does not depend on the order of the rules", () => {
    expect(holder("2026-06-12T18:00:00Z", schedule([friday19, closedSunday]))).toMatchObject({
      ruleId: "rule-friday",
      memberId: A,
    });
    expect(holder("2026-03-01T12:00:00Z", schedule([friday19, closedSunday]))).toMatchObject({
      ruleId: "rule-sunday",
    });
  });

  it("applies a new rule with a past starts_on from 00:00 local of valid_from", () => {
    // Same alternation, anchored on Friday 2026-01-02, in force from 2026-06-01 (23:00Z on 31 May).
    const anchoredInPast = { ...friday19, id: "rule-past", starts_on: "2026-01-02" };
    const s = schedule([closedSunday, anchoredInPast]);
    expect(holder("2026-05-31T22:59:59Z", s)).toMatchObject({ ruleId: "rule-sunday", memberId: B });
    // 150 days (week 21) after 2026-01-02: odd week, so the member who is not first (A).
    expect(holder("2026-05-31T23:00:00Z", s)).toMatchObject({ ruleId: "rule-past", memberId: A, weekIndex: 21 });
  });

  it("uses the newest version when two share the same start", () => {
    const newer = { ...friday19, id: "rule-friday-v2", first_member_id: A, created_at: "2026-05-21T10:00:00Z" };
    expect(holder("2026-06-06T12:00:00Z", schedule([newer, closedSunday, friday19]))).toMatchObject({
      ruleId: "rule-friday-v2",
      memberId: A,
    });
  });

  it("has no holder after valid_to of the last rule", () => {
    const s = schedule([{ ...sunday18, valid_to: "2026-02-01" }]);
    expect(who("2026-01-31T23:59:59Z", s)).toBe(B);
    expect(holder("2026-02-01T00:00:00Z", s)).toBeNull();
  });

  it("has no holder with no rules", () => {
    expect(holder("2026-02-01T00:00:00Z", schedule([]))).toBeNull();
  });
});

describe("getCustodyHolder: overrides", () => {
  // Week 3 (2026-01-25 18:00 -> 2026-02-01 18:00) is B's week.
  const holiday: CustodyOverride = {
    id: "ov-holiday",
    starts_at: "2026-01-27T10:00:00Z",
    ends_at: "2026-01-29T10:00:00Z",
    member_id: A,
    reason: "Feriado",
    created_at: "2026-01-20T10:00:00Z",
  };

  it("override wins over the rule, from starts_at (inclusive) to ends_at (exclusive)", () => {
    const s = schedule([sunday18], { overrides: [holiday] });
    expect(who("2026-01-27T09:59:59Z", s)).toBe(B);
    expect(holder("2026-01-27T10:00:00Z", s)).toEqual({
      memberId: A,
      source: "override",
      overrideId: "ov-holiday",
      reason: "Feriado",
    });
    expect(holder("2026-01-29T10:00:00Z", s)).toMatchObject({ source: "rule", memberId: B });
  });

  it("the latest created override wins on overlap", () => {
    const later: CustodyOverride = {
      id: "ov-later",
      starts_at: "2026-01-28T00:00:00Z",
      ends_at: "2026-01-30T00:00:00Z",
      member_id: B,
      reason: "Troca combinada",
      created_at: "2026-01-21T10:00:00Z",
    };
    const older: CustodyOverride = { ...later, id: "ov-older", member_id: A, created_at: "2026-01-10T10:00:00Z" };
    const s = schedule([sunday18], { overrides: [later, holiday, older] });
    expect(holder("2026-01-27T12:00:00Z", s)).toMatchObject({ overrideId: "ov-holiday", memberId: A });
    expect(holder("2026-01-28T12:00:00Z", s)).toMatchObject({ overrideId: "ov-later", memberId: B });
    expect(holder("2026-01-29T12:00:00Z", s)).toMatchObject({ overrideId: "ov-later", memberId: B });
  });

  it("applies even where no rule exists", () => {
    const s = schedule([], { overrides: [holiday] });
    expect(who("2026-01-28T00:00:00Z", s)).toBe(A);
  });
});

describe("getCustodyHolder: edge cases", () => {
  it("has no holder in the other member's weeks while the family has one member", () => {
    const s = schedule([sunday18], { memberIds: [A] });
    expect(who("2026-01-05T12:00:00Z", s)).toBe(A);
    expect(holder("2026-01-12T12:00:00Z", s)).toBeNull();
  });

  it("rejects an invalid instant", () => {
    expect(() => getCustodyHolder(new Date("nope"), schedule([sunday18]))).toThrow("Invalid instant");
  });

  it("rejects malformed rule dates and times", () => {
    expect(() => holder("2026-02-01T12:00:00Z", schedule([{ ...sunday18, starts_on: "2026-02-30" }]))).toThrow();
    expect(() => holder("2026-02-01T12:00:00Z", schedule([{ ...sunday18, handover_time: "25:00" }]))).toThrow();
  });
});

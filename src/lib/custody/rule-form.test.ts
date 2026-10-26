import { describe, expect, it } from "vitest";
import type { CustodyRule } from "./holder";
import {
  describeRule,
  initialRuleForm,
  latestRule,
  nextWeekdayOnOrAfter,
  ruleSaveErrorMessage,
  toCustodyRuleInsert,
  todayIn,
  validateRuleForm,
  weekdayOf,
  type RuleFormInput,
} from "./rule-form";

const A = "member-a";
const B = "member-b";

const valid: RuleFormInput = {
  firstMemberId: A,
  startsOn: "2026-10-18", // a Sunday
  handoverWeekday: 0,
  handoverTime: "18:00",
  validFrom: null,
};

const rule: CustodyRule = {
  id: "r1",
  starts_on: "2026-01-02",
  first_member_id: B,
  handover_weekday: 5,
  handover_time: "19:30:00",
  valid_from: "2026-01-02",
  valid_to: null,
};

describe("dates", () => {
  it("weekdayOf and nextWeekdayOnOrAfter use 0 = Sunday", () => {
    expect(weekdayOf("2026-10-18")).toBe(0);
    expect(weekdayOf("2026-10-14")).toBe(3);
    expect(nextWeekdayOnOrAfter("2026-10-14", 0)).toBe("2026-10-18");
    expect(nextWeekdayOnOrAfter("2026-10-14", 3)).toBe("2026-10-14");
    expect(nextWeekdayOnOrAfter("2026-12-30", 5)).toBe("2027-01-01");
  });

  it("todayIn uses the family zone, not UTC", () => {
    const lateUtc = Date.parse("2026-10-14T23:30:00Z");
    expect(todayIn("Europe/Lisbon", lateUtc)).toBe("2026-10-15"); // WEST, 00:30
    expect(todayIn("America/Sao_Paulo", lateUtc)).toBe("2026-10-14");
  });
});

describe("validateRuleForm", () => {
  it("accepts a complete form", () => {
    expect(validateRuleForm(valid, [A, B])).toEqual({});
    expect(validateRuleForm({ ...valid, validFrom: "2026-10-14" }, [A, B])).toEqual({});
  });

  it("requires a member of the family to start", () => {
    expect(validateRuleForm({ ...valid, firstMemberId: "stranger" }, [A, B]).firstMemberId).toBeDefined();
  });

  it("requires the first handover to fall on the handover weekday", () => {
    const errors = validateRuleForm({ ...valid, startsOn: "2026-10-19" }, [A, B]);
    expect(errors.startsOn).toContain("domingo");
  });

  it("rejects bad dates, times and weekdays", () => {
    expect(validateRuleForm({ ...valid, startsOn: "2026-02-30" }, [A]).startsOn).toBeDefined();
    expect(validateRuleForm({ ...valid, handoverTime: "24:00" }, [A]).handoverTime).toBeDefined();
    expect(validateRuleForm({ ...valid, handoverTime: "" }, [A]).handoverTime).toBeDefined();
    expect(validateRuleForm({ ...valid, handoverWeekday: 7 }, [A]).handoverWeekday).toBeDefined();
    expect(validateRuleForm({ ...valid, validFrom: "" }, [A]).validFrom).toBeDefined();
  });
});

describe("initialRuleForm", () => {
  it("defaults the first rule to Sunday 18:00, next Sunday, first member, no valid_from", () => {
    expect(initialRuleForm(null, [A, B], "2026-10-14")).toEqual({
      firstMemberId: A,
      startsOn: "2026-10-18",
      handoverWeekday: 0,
      handoverTime: "18:00",
      validFrom: null,
    });
  });

  it("starts a change from the current rule, valid from today", () => {
    expect(initialRuleForm(rule, [A, B], "2026-10-14")).toEqual({
      firstMemberId: B,
      startsOn: "2026-10-16",
      handoverWeekday: 5,
      handoverTime: "19:30",
      validFrom: "2026-10-14",
    });
  });
});

describe("toCustodyRuleInsert", () => {
  it("leaves valid_from to the database for the first version", () => {
    expect(toCustodyRuleInsert("f1", valid)).toEqual({
      family_id: "f1",
      first_member_id: A,
      starts_on: "2026-10-18",
      handover_weekday: 0,
      handover_time: "18:00",
    });
  });

  it("sends valid_from for a new version", () => {
    expect(toCustodyRuleInsert("f1", { ...valid, validFrom: "2026-10-14" })).toMatchObject({ valid_from: "2026-10-14" });
  });
});

describe("display helpers", () => {
  it("latestRule picks the last saved version", () => {
    const rows = [
      { id: "v1", created_at: "2026-10-01T10:00:00Z" },
      { id: "v3", created_at: "2026-10-14T10:00:00.5Z" },
      { id: "v2", created_at: "2026-10-14T10:00:00Z" },
    ];
    expect(latestRule(rows)?.id).toBe("v3");
    expect(latestRule([])).toBeNull();
  });

  it("describeRule names the weekday, time, first handover and member", () => {
    expect(describeRule(rule, { [B]: "Bruno" })).toBe("Sexta-feira às 19:30; primeira troca em 02/01/2026 com Bruno");
  });

  it("maps database errors to messages", () => {
    expect(ruleSaveErrorMessage("23514")).toContain("dia da troca");
    expect(ruleSaveErrorMessage("42501")).toContain("permissão");
    expect(ruleSaveErrorMessage(undefined)).toContain("Tenta novamente");
  });
});

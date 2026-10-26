import { describe, expect, it } from "vitest";
import { getCustodyHolder, type CustodyRule } from "./holder";
import {
  describeOverridePeriod,
  formatInstant,
  initialOverrideForm,
  localInstant,
  overrideSaveErrorMessage,
  splitOverrides,
  toCustodyOverrideInsert,
  validateOverrideForm,
  type OverrideFormInput,
} from "./override-form";

const TZ = "Europe/Lisbon";
const members = ["ana", "bruno"];

function form(extra: Partial<OverrideFormInput> = {}): OverrideFormInput {
  return {
    memberId: "bruno",
    startDate: "2026-12-24",
    startTime: "18:00",
    endDate: "2026-12-26",
    endTime: "18:00",
    reason: "Natal",
    ...extra,
  };
}

describe("localInstant (RNF-04)", () => {
  it("reads the date and time in the family zone, winter and summer", () => {
    expect(new Date(localInstant("2026-12-24", "18:00", TZ)!).toISOString()).toBe("2026-12-24T18:00:00.000Z");
    expect(new Date(localInstant("2026-07-01", "18:00", TZ)!).toISOString()).toBe("2026-07-01T17:00:00.000Z");
    expect(new Date(localInstant("2026-07-01", "18:00", "America/Sao_Paulo")!).toISOString()).toBe(
      "2026-07-01T21:00:00.000Z",
    );
  });

  it("moves a time skipped by summer time forward, like the rule", () => {
    // Lisbon 2026-03-29 01:30 does not exist; it becomes 02:30 WEST = 01:30 UTC.
    expect(new Date(localInstant("2026-03-29", "01:30", TZ)!).toISOString()).toBe("2026-03-29T01:30:00.000Z");
  });

  it("is null for malformed input", () => {
    for (const [d, t] of [["2026-02-30", "18:00"], ["", "18:00"], ["2026-12-24", ""], ["2026-12-24", "25:00"], ["2026-12-24", "18:00:00"]]) {
      expect(localInstant(d, t, TZ)).toBeNull();
    }
  });
});

describe("initialOverrideForm", () => {
  it("runs from today to tomorrow at the rule's handover time", () => {
    expect(initialOverrideForm("2026-12-31", "19:30:00", members)).toEqual({
      memberId: "ana",
      startDate: "2026-12-31",
      startTime: "19:30",
      endDate: "2027-01-01",
      endTime: "19:30",
      reason: "",
    });
    expect(initialOverrideForm("2026-10-14", null, []).startTime).toBe("18:00");
  });
});

describe("validateOverrideForm", () => {
  it("accepts a valid exception", () => {
    expect(validateOverrideForm(form(), members, TZ)).toEqual({});
  });

  it("requires a family member, a period and a reason", () => {
    expect(validateOverrideForm(form({ memberId: "carla" }), members, TZ)).toEqual({
      memberId: "Escolhe com quem a criança fica.",
    });
    expect(validateOverrideForm(form({ startDate: "" }), members, TZ)).toEqual({
      startDate: "Indica a data e a hora de início.",
    });
    expect(validateOverrideForm(form({ endTime: "" }), members, TZ)).toEqual({
      endDate: "Indica a data e a hora de fim.",
    });
    expect(validateOverrideForm(form({ reason: "   " }), members, TZ)).toEqual({
      reason: "Indica o motivo (por exemplo, férias ou feriado).",
    });
    expect(validateOverrideForm(form({ reason: "x".repeat(201) }), members, TZ).reason).toBe(
      "O motivo tem no máximo 200 caracteres.",
    );
  });

  it("requires the end after the start, compared as instants", () => {
    expect(validateOverrideForm(form({ endDate: "2026-12-24" }), members, TZ)).toEqual({
      endDate: "O fim deve ser depois do início.",
    });
    expect(validateOverrideForm(form({ endDate: "2026-12-24", endTime: "18:01" }), members, TZ)).toEqual({});
    // The night summer time ends, 01:30 happens twice; 01:00 -> 01:30 is still forward.
    expect(validateOverrideForm(form({ startDate: "2026-10-25", startTime: "01:00", endDate: "2026-10-25", endTime: "01:30" }), members, TZ)).toEqual({});
  });

  it("limits an exception to one year", () => {
    expect(validateOverrideForm(form({ startDate: "2026-01-01", endDate: "2027-01-02", endTime: "18:00" }), members, TZ)).toEqual({});
    expect(validateOverrideForm(form({ startDate: "2026-01-01", endDate: "2027-01-03" }), members, TZ).endDate).toMatch(
      /no máximo um ano/,
    );
  });
});

describe("toCustodyOverrideInsert", () => {
  it("sends instants in UTC and a trimmed reason", () => {
    expect(toCustodyOverrideInsert("f1", form({ reason: "  Férias de verão  ", startDate: "2026-08-01", endDate: "2026-08-15" }), TZ)).toEqual({
      family_id: "f1",
      member_id: "bruno",
      starts_at: "2026-08-01T17:00:00.000Z",
      ends_at: "2026-08-15T17:00:00.000Z",
      reason: "Férias de verão",
    });
  });

  it("refuses an invalid period", () => {
    expect(() => toCustodyOverrideInsert("f1", form({ startDate: "x" }), TZ)).toThrow();
  });

  it("produces a row that overrides the rule exactly over its period", () => {
    const rule: CustodyRule = {
      id: "r1",
      starts_on: "2026-01-04",
      first_member_id: "ana",
      handover_weekday: 0,
      handover_time: "18:00",
      valid_from: "2026-01-04",
      valid_to: null,
    };
    // 24/12/2026 is in Ana's week (week 51 since 04/01).
    const row = toCustodyOverrideInsert("f1", form(), TZ);
    const schedule = {
      timezone: TZ,
      memberIds: members,
      rules: [rule],
      overrides: [{ id: "o1", ...row, created_at: "2026-12-01T10:00:00Z" }],
    };
    const at = (iso: string) => getCustodyHolder(new Date(iso), schedule);
    expect(at("2026-12-24T17:59:59Z")).toMatchObject({ memberId: "ana", source: "rule" });
    expect(at("2026-12-24T18:00:00Z")).toMatchObject({ memberId: "bruno", source: "override", reason: "Natal" });
    expect(at("2026-12-26T17:59:59Z")).toMatchObject({ memberId: "bruno", source: "override" });
    expect(at("2026-12-26T18:00:00Z")).toMatchObject({ memberId: "ana", source: "rule" });
  });
});

describe("display helpers", () => {
  it("formats the period in the family zone", () => {
    expect(formatInstant("2026-07-01T17:00:00+00:00", TZ)).toBe("01/07/2026 18:00");
    expect(describeOverridePeriod({ starts_at: "2026-12-24T18:00:00Z", ends_at: "2026-12-26T18:00:00Z" }, TZ)).toBe(
      "de 24/12/2026 18:00 a 26/12/2026 18:00",
    );
  });

  it("splits upcoming (soonest first) from past (latest first)", () => {
    const o = (id: string, s: string, e: string) => ({ id, starts_at: s, ends_at: e });
    const list = [
      o("past-old", "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z"),
      o("later", "2026-12-24T00:00:00Z", "2026-12-26T00:00:00Z"),
      o("ongoing", "2026-10-10T00:00:00Z", "2026-10-20T00:00:00Z"),
      o("past-recent", "2026-09-01T00:00:00Z", "2026-10-14T09:00:00Z"),
    ];
    const { upcoming, past } = splitOverrides(list, Date.parse("2026-10-14T09:00:00Z"));
    expect(upcoming.map((x) => x.id)).toEqual(["ongoing", "later"]);
    expect(past.map((x) => x.id)).toEqual(["past-recent", "past-old"]);
  });

  it("explains database errors", () => {
    expect(overrideSaveErrorMessage("23514")).toMatch(/fim deve ser depois do início/);
    expect(overrideSaveErrorMessage("23503")).toBe("O responsável escolhido não faz parte da família.");
    expect(overrideSaveErrorMessage("42501")).toMatch(/permissão/);
    expect(overrideSaveErrorMessage(undefined)).toBe("Não foi possível guardar a exceção. Tenta novamente.");
    expect(overrideSaveErrorMessage("XX000", "remover")).toBe("Não foi possível remover a exceção. Tenta novamente.");
  });
});

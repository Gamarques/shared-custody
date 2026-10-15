import { describe, expect, it } from "vitest";
import { otherMember, toSettlementInsert, validateSettlementForm, type SettlementFormInput } from "./settlement-form";

const ids = ["m1", "m2"];
const ok: SettlementFormInput = { amount: "6,00", settledOn: "2026-10-15", fromMember: "m1", note: "" };

describe("validateSettlementForm", () => {
  it("accepts a valid settlement", () => {
    expect(validateSettlementForm(ok, ids, "2026-10-15")).toEqual({});
  });

  it("rejects bad amounts", () => {
    for (const amount of ["", "abc", "0", "0,00", "-5", "2000000"]) {
      expect(validateSettlementForm({ ...ok, amount }, ids, "2026-10-15").amount).toBeTruthy();
    }
  });

  it("rejects a bad or future date", () => {
    expect(validateSettlementForm({ ...ok, settledOn: "" }, ids, "2026-10-15").settledOn).toBeTruthy();
    expect(validateSettlementForm({ ...ok, settledOn: "2026-02-31" }, ids, "2026-10-15").settledOn).toBeTruthy();
    expect(validateSettlementForm({ ...ok, settledOn: "2026-10-16" }, ids, "2026-10-15").settledOn).toBeTruthy();
  });

  it("rejects a payer that is not a member, or a family without two members", () => {
    expect(validateSettlementForm({ ...ok, fromMember: "x" }, ids, "2026-10-15").fromMember).toBeTruthy();
    expect(validateSettlementForm(ok, ["m1"], "2026-10-15").fromMember).toBeUndefined();
    expect(validateSettlementForm(ok, ["m1"], "2026-10-15").toMember).toBeTruthy();
  });

  it("limits the note", () => {
    expect(validateSettlementForm({ ...ok, note: "a".repeat(201) }, ids, "2026-10-15").note).toBeTruthy();
  });
});

describe("toSettlementInsert", () => {
  it("builds the row in integer cents with the other member as receiver", () => {
    expect(toSettlementInsert("f1", ids, { ...ok, amount: "1.234,56", note: "  pix " })).toEqual({
      family_id: "f1",
      from_member: "m1",
      to_member: "m2",
      amount_cents: 123_456,
      settled_on: "2026-10-15",
      note: "pix",
    });
  });

  it("blank note becomes null; invalid input throws", () => {
    expect(toSettlementInsert("f1", ids, ok).note).toBeNull();
    expect(() => toSettlementInsert("f1", ids, { ...ok, fromMember: "x" })).toThrow();
  });

  it("otherMember needs exactly two members", () => {
    expect(otherMember(ids, "m2")).toBe("m1");
    expect(otherMember(["m1"], "m1")).toBeNull();
  });
});

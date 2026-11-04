import { describe, expect, it } from "vitest";
import {
  amountReady,
  defaultShareReady,
  disputeCommentReady,
  expenseFormReady,
  hasText,
  loginReady,
  memberProfileReady,
  onboardingReady,
  overrideFormReady,
  ruleFormReady,
  settlementFormReady,
} from "./ready";

describe("hasText / amountReady", () => {
  it("whitespace is not content", () => {
    expect(hasText("")).toBe(false);
    expect(hasText("   \n\t")).toBe(false);
    expect(hasText(null)).toBe(false);
    expect(hasText(" a ")).toBe(true);
  });

  it("an amount needs something typed that is not zero", () => {
    for (const a of ["", "  ", "0", "0,00", "0.0", " 0 € "]) expect(amountReady(a)).toBe(false);
    for (const a of ["12,50", "0,01", "1.234,56"]) expect(amountReady(a)).toBe(true);
    // Not an amount: the button stays usable so validation can say what is wrong.
    expect(amountReady("12,5x")).toBe(true);
  });
});

describe("expense form", () => {
  const full = { amount: "12,50", spentOn: "2026-10-15", description: "Dentista", category: "saude", paidBy: "m1", payerPercent: "50" };
  it("ready only with amount > 0, date, description, category, payer and share", () => {
    expect(expenseFormReady(full)).toBe(true);
    expect(expenseFormReady({ ...full, amount: "" })).toBe(false);
    expect(expenseFormReady({ ...full, amount: "0,00" })).toBe(false);
    expect(expenseFormReady({ ...full, description: "   " })).toBe(false);
    expect(expenseFormReady({ ...full, spentOn: "" })).toBe(false);
    expect(expenseFormReady({ ...full, paidBy: "" })).toBe(false);
    expect(expenseFormReady({ ...full, payerPercent: " " })).toBe(false);
    // 0 % is a valid share.
    expect(expenseFormReady({ ...full, payerPercent: "0" })).toBe(true);
  });
});

describe("dispute (contestação)", () => {
  it("needs a comment with real text", () => {
    expect(disputeCommentReady("")).toBe(false);
    expect(disputeCommentReady("   \n ")).toBe(false);
    expect(disputeCommentReady("Valor errado")).toBe(true);
  });
});

describe("settlement form", () => {
  const full = { amount: "6,00", settledOn: "2026-10-15", fromMember: "m1", note: "" };
  it("ready with amount > 0, date and payer; the note is optional", () => {
    expect(settlementFormReady(full)).toBe(true);
    expect(settlementFormReady({ ...full, amount: "" })).toBe(false);
    expect(settlementFormReady({ ...full, amount: "0" })).toBe(false);
    expect(settlementFormReady({ ...full, settledOn: "" })).toBe(false);
    expect(settlementFormReady({ ...full, fromMember: "" })).toBe(false);
  });
});

describe("override form (exceção)", () => {
  const full = { memberId: "m1", startDate: "2026-12-24", startTime: "10:00", endDate: "2026-12-26", endTime: "18:00", reason: "Feriado" };
  it("ready with member, both dates and times and a reason", () => {
    expect(overrideFormReady(full)).toBe(true);
    for (const key of Object.keys(full) as (keyof typeof full)[]) {
      expect(overrideFormReady({ ...full, [key]: "  " })).toBe(false);
    }
  });
});

describe("custody rule form", () => {
  const first = { firstMemberId: "m1", startsOn: "2026-10-18", handoverWeekday: 0, handoverTime: "18:00", validFrom: null };
  it("ready with who starts, first date and time; validFrom only when changing the rule", () => {
    expect(ruleFormReady(first)).toBe(true);
    expect(ruleFormReady({ ...first, firstMemberId: "" })).toBe(false);
    expect(ruleFormReady({ ...first, startsOn: "" })).toBe(false);
    expect(ruleFormReady({ ...first, handoverTime: "" })).toBe(false);
    expect(ruleFormReady({ ...first, validFrom: "" })).toBe(false);
    expect(ruleFormReady({ ...first, validFrom: "2026-11-01" })).toBe(true);
  });
});

describe("onboarding and invite acceptance", () => {
  it("need the names with real text and a color", () => {
    expect(memberProfileReady({ displayName: "Ana", color: "#2f6f5e" })).toBe(true);
    expect(memberProfileReady({ displayName: "  ", color: "#2f6f5e" })).toBe(false);
    expect(memberProfileReady({ displayName: "Ana", color: "" })).toBe(false);
    expect(onboardingReady({ familyName: "Silva", displayName: "Ana", color: "#2f6f5e" })).toBe(true);
    expect(onboardingReady({ familyName: " ", displayName: "Ana", color: "#2f6f5e" })).toBe(false);
  });
});

describe("default share", () => {
  it("needs text and a value different from the saved one", () => {
    expect(defaultShareReady("", 5000)).toBe(false);
    expect(defaultShareReady("50", 5000)).toBe(false);
    expect(defaultShareReady("60", 5000)).toBe(true);
  });
});

describe("login", () => {
  it("magic link needs an e-mail; password mode needs both", () => {
    expect(loginReady("link", "", "")).toBe(false);
    expect(loginReady("link", "   ", "")).toBe(false);
    expect(loginReady("link", "ana@example.com", "")).toBe(true);
    expect(loginReady("password", "ana@example.com", "")).toBe(false);
    expect(loginReady("password", "", "s3gredo")).toBe(false);
    expect(loginReady("password", "ana@example.com", "s3gredo")).toBe(true);
  });
});

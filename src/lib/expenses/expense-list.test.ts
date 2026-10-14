import { describe, expect, it } from "vitest";
import { ALL_MONTHS, monthDateRange, parseExpenseFilters, totalCents } from "./expense-list";

describe("parseExpenseFilters (RF-10)", () => {
  const ids = ["m1", "m2"];

  it("defaults to the current month with no category or payer", () => {
    expect(parseExpenseFilters({}, "2026-10", ids)).toEqual({ month: "2026-10", category: null, paidBy: null });
  });

  it("reads month, category and payer", () => {
    expect(parseExpenseFilters({ mes: "2026-09", categoria: "saude", pagou: "m2" }, "2026-10", ids)).toEqual({
      month: "2026-09",
      category: "saude",
      paidBy: "m2",
    });
  });

  it("'todos' lists every month", () => {
    expect(parseExpenseFilters({ mes: ALL_MONTHS }, "2026-10", ids).month).toBeNull();
  });

  it("ignores malformed or foreign values", () => {
    expect(parseExpenseFilters({ mes: "2026-13", categoria: "x", pagou: "other-family" }, "2026-10", ids)).toEqual({
      month: "2026-10",
      category: null,
      paidBy: null,
    });
  });

  it("takes the first value of a repeated parameter", () => {
    expect(parseExpenseFilters({ categoria: ["lazer", "saude"] }, "2026-10", ids).category).toBe("lazer");
  });
});

describe("monthDateRange", () => {
  it("is [first day, first day of next month)", () => {
    expect(monthDateRange("2026-10")).toEqual({ from: "2026-10-01", to: "2026-11-01" });
  });
  it("rolls over the year", () => {
    expect(monthDateRange("2026-12")).toEqual({ from: "2026-12-01", to: "2027-01-01" });
  });
  it("rejects a malformed month", () => {
    expect(() => monthDateRange("2026-1")).toThrow();
  });
});

describe("totalCents", () => {
  it("sums integer cents exactly", () => {
    expect(totalCents([{ amount_cents: 10 }, { amount_cents: 20 }, { amount_cents: 29 }])).toBe(59);
    expect(totalCents([])).toBe(0);
  });
});

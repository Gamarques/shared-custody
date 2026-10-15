import { describe, expect, it } from "vitest";
import {
  adjacentMonths,
  countExpenses,
  describeDebt,
  describeIfAccepted,
  describePeriod,
  nextDay,
  parseBalancePeriod,
  parseIsoDate,
  periodBounds,
} from "./balance-view";

// U+00A0 / U+202F separate the amount and the euro sign in pt-PT; compare without them.
const plain = (s: string) => s.replace(/[  ]/g, " ");
const names = { m1: "Ana", m2: "Bruno" };

describe("parseBalancePeriod (RF-13)", () => {
  it("defaults to the current month as [first day, first day of next month)", () => {
    expect(parseBalancePeriod({}, "2026-10")).toEqual({
      period: { kind: "month", month: "2026-10", from: "2026-10-01", to: "2026-11-01" },
      invalidRange: false,
    });
  });

  it("reads another month, and falls back to the current one when malformed", () => {
    expect(parseBalancePeriod({ mes: "2026-12" }, "2026-10").period).toMatchObject({ from: "2026-12-01", to: "2027-01-01" });
    expect(parseBalancePeriod({ mes: "2026-13" }, "2026-10").period).toMatchObject({ month: "2026-10" });
  });

  it("'todos' has no bounds", () => {
    const { period } = parseBalancePeriod({ mes: "todos" }, "2026-10");
    expect(period.kind).toBe("all");
    expect(periodBounds(period)).toEqual({ from: null, to: null });
  });

  it("a date range includes both days (to = day after the end)", () => {
    expect(parseBalancePeriod({ de: "2026-09-15", ate: "2026-10-14" }, "2026-10")).toEqual({
      period: { kind: "range", start: "2026-09-15", end: "2026-10-14", from: "2026-09-15", to: "2026-10-15" },
      invalidRange: false,
    });
  });

  it("a range takes precedence over the month", () => {
    expect(parseBalancePeriod({ mes: "2026-01", de: "2026-02-01", ate: "2026-02-28" }, "2026-10").period.kind).toBe("range");
  });

  it("a reversed, partial or impossible range falls back to the current month and is flagged", () => {
    for (const params of [
      { de: "2026-10-14", ate: "2026-10-01" },
      { de: "2026-10-01" },
      { ate: "2026-10-01" },
      { de: "2026-02-30", ate: "2026-03-01" },
    ]) {
      expect(parseBalancePeriod(params, "2026-10")).toEqual({
        period: { kind: "month", month: "2026-10", from: "2026-10-01", to: "2026-11-01" },
        invalidRange: true,
      });
    }
  });

  it("takes the first value of a repeated parameter", () => {
    expect(parseBalancePeriod({ mes: ["2026-09", "2026-08"] }, "2026-10").period).toMatchObject({ month: "2026-09" });
  });
});

describe("dates", () => {
  it("parseIsoDate accepts only real dates", () => {
    expect(parseIsoDate("2028-02-29")).toBe("2028-02-29");
    expect(parseIsoDate("2026-02-29")).toBeNull();
    expect(parseIsoDate("2026-1-01")).toBeNull();
    expect(parseIsoDate(undefined)).toBeNull();
  });

  it("nextDay crosses month and year ends", () => {
    expect(nextDay("2026-10-31")).toBe("2026-11-01");
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
    expect(nextDay("2028-02-28")).toBe("2028-02-29");
  });
});

describe("describePeriod and adjacentMonths", () => {
  it("names the period", () => {
    expect(describePeriod(parseBalancePeriod({}, "2026-10").period)).toBe("Outubro de 2026");
    expect(describePeriod(parseBalancePeriod({ mes: "todos" }, "2026-10").period)).toBe("Todo o período");
    expect(describePeriod(parseBalancePeriod({ de: "2026-10-01", ate: "2026-10-15" }, "2026-10").period)).toBe(
      "De 01/10/2026 a 15/10/2026",
    );
    expect(describePeriod(parseBalancePeriod({ de: "2026-10-01", ate: "2026-10-01" }, "2026-10").period)).toBe("Dia 01/10/2026");
  });

  it("gives the months around a month period only", () => {
    expect(adjacentMonths(parseBalancePeriod({ mes: "2026-01" }, "2026-10").period)).toEqual({ prev: "2025-12", next: "2026-02" });
    expect(adjacentMonths(parseBalancePeriod({ mes: "todos" }, "2026-10").period)).toBeNull();
  });
});

describe("who owes whom", () => {
  it("names the debtor, the amount and the creditor", () => {
    expect(plain(describeDebt({ debtor: "m1", creditor: "m2", amountCents: 600 }, names, "EUR"))).toBe("Ana deve 6,00 € a Bruno.");
    expect(plain(describeDebt({ debtor: "m2", creditor: "m1", amountCents: 123456 }, names, "EUR"))).toBe(
      "Bruno deve 1234,56 € a Ana.",
    );
  });

  it("says nobody owes anything when even", () => {
    expect(describeDebt({ debtor: null, creditor: null, amountCents: 0 }, names, "EUR")).toBe("Ninguém deve nada.");
    expect(describeDebt({ debtor: null, creditor: null, amountCents: 0 }, names, "EUR", "Zero.")).toBe("Zero.");
  });

  it("the disputed line is conditional", () => {
    expect(plain(describeIfAccepted({ debtor: "m1", creditor: "m2", amountCents: 2275 }, names, "EUR"))).toBe(
      "Se aceitas, Ana deveria 22,75 € a Bruno por elas.",
    );
    expect(describeIfAccepted({ debtor: null, creditor: null, amountCents: 0 }, names, "EUR")).toMatch(/ninguém deveria nada/);
  });

  it("counts expenses in Portuguese", () => {
    expect(countExpenses(0)).toBe("0 despesas");
    expect(countExpenses(1)).toBe("1 despesa");
    expect(countExpenses(2)).toBe("2 despesas");
  });
});

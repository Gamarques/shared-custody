import { describe, expect, it } from "vitest";
import {
  centsToInput,
  formatBps,
  formatCents,
  MAX_AMOUNT_CENTS,
  parseAmountToCents,
  parsePercentToBps,
  splitExpense,
} from "./money";

// Intl separates the amount and the symbol with a no-break space.
const plain = (s: string) => s.replace(/[  ]/g, " ");

describe("parseAmountToCents (RNF-02: integer cents, never float)", () => {
  it.each([
    ["12", 1200],
    ["12,5", 1250],
    ["12,50", 1250],
    ["12.50", 1250],
    ["0,29", 29],
    ["0.1", 10],
    ["1.234", 123400],
    ["1.234,56", 123456],
    ["1,234.56", 123456],
    ["1 234,56", 123456],
    ["12.345.678,90", 1234567890],
    [" 80,00 € ", 8000],
    ["R$ 80", 8000],
    ["0", 0],
  ])("%j -> %i", (text, cents) => {
    expect(parseAmountToCents(text)).toBe(cents);
  });

  it("is exact where floats are not (0,29 × 100 = 28,999… as a float)", () => {
    expect(0.29 * 100).not.toBe(29);
    expect(parseAmountToCents("0,29")).toBe(29);
    expect(parseAmountToCents("1,13")).toBe(113);
    expect(parseAmountToCents("4,35")).toBe(435);
  });

  it("reads a separator followed by 3 digits as thousands, as documented", () => {
    expect(parseAmountToCents("12,345")).toBe(1234500);
  });

  it.each(["", "abc", "1,2,3", "12,5,0", "-5", "1e3", "12.", ",50", "1.23.45", "12,3456", "1.234.5"])("rejects %j", (text) => {
    expect(parseAmountToCents(text)).toBeNull();
  });

  it("round-trips through the input format", () => {
    for (const cents of [1, 29, 100, 123456, MAX_AMOUNT_CENTS]) {
      expect(parseAmountToCents(centsToInput(cents))).toBe(cents);
    }
    expect(centsToInput(5)).toBe("0,05");
  });
});

describe("formatCents", () => {
  it("uses the family currency", () => {
    expect(plain(formatCents(10000, "EUR"))).toBe("100,00 €");
    expect(plain(formatCents(5, "EUR"))).toBe("0,05 €");
    expect(plain(formatCents(123456, "EUR"))).toBe("1234,56 €");
    expect(plain(formatCents(8000, "BRL"))).toBe("80,00 R$");
  });
});

describe("parsePercentToBps / formatBps", () => {
  it.each([
    ["50", 5000],
    ["0", 0],
    ["100", 10000],
    ["33,33", 3333],
    ["12.5", 1250],
    ["40%", 4000],
    [" 30 ", 3000],
  ])("%j -> %i bps", (text, bps) => {
    expect(parsePercentToBps(text)).toBe(bps);
  });

  it.each(["", "-1", "100,01", "101", "33,333", "abc", "1000"])("rejects %j", (text) => {
    expect(parsePercentToBps(text)).toBeNull();
  });

  it("formats basis points as a percent without trailing zeros", () => {
    expect(formatBps(5000)).toBe("50");
    expect(formatBps(3333)).toBe("33,33");
    expect(formatBps(1250)).toBe("12,5");
    expect(formatBps(5)).toBe("0,05");
    expect(formatBps(10000)).toBe("100");
    for (const bps of [0, 1, 5, 1250, 3333, 5000, 10000]) expect(parsePercentToBps(formatBps(bps))).toBe(bps);
  });
});

describe("splitExpense (business rule 1: the two parts add up exactly)", () => {
  it("matches the plan's example", () => {
    // Material escolar: Ana pays 100,00 € at 50%, Bruno owes 50,00 €.
    expect(splitExpense(10000, 5000)).toEqual({ payerCents: 5000, otherCents: 5000 });
    // Dentista: Bruno pays 80,00 € at 30%, Ana owes 56,00 €.
    expect(splitExpense(8000, 3000)).toEqual({ payerCents: 2400, otherCents: 5600 });
  });

  it("rounds the payer's part to the cent, half up, and gives the rest to the other", () => {
    expect(splitExpense(1, 5000)).toEqual({ payerCents: 1, otherCents: 0 });
    expect(splitExpense(3, 5000)).toEqual({ payerCents: 2, otherCents: 1 });
    expect(splitExpense(1000, 3333)).toEqual({ payerCents: 333, otherCents: 667 });
    expect(splitExpense(999, 3333)).toEqual({ payerCents: 333, otherCents: 666 });
    expect(splitExpense(10000, 0)).toEqual({ payerCents: 0, otherCents: 10000 });
    expect(splitExpense(10000, 10000)).toEqual({ payerCents: 10000, otherCents: 0 });
  });

  it("always closes to the cent, even at the largest amount", () => {
    for (const amount of [1, 7, 99, 12345, 9999999, MAX_AMOUNT_CENTS]) {
      for (const bps of [0, 1, 3333, 5000, 6667, 9999, 10000]) {
        const { payerCents, otherCents } = splitExpense(amount, bps);
        expect(Number.isInteger(payerCents)).toBe(true);
        expect(payerCents + otherCents).toBe(amount);
        expect(payerCents).toBeGreaterThanOrEqual(0);
        expect(otherCents).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

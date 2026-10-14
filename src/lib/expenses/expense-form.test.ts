import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  categoryLabel,
  describeSavedExpense,
  describeSplit,
  expenseSaveErrorMessage,
  initialExpenseForm,
  toExpenseInsert,
  validateDefaultShare,
  validateExpenseForm,
  type ExpenseFormInput,
} from "./expense-form";

const TODAY = "2026-10-14";
const MEMBERS = [
  { id: "m1", name: "Ana" },
  { id: "m2", name: "Bruno" },
];
const IDS = MEMBERS.map((m) => m.id);
const plain = (s: string | null) => s?.replace(/[  ]/g, " ") ?? null;

function valid(patch: Partial<ExpenseFormInput> = {}): ExpenseFormInput {
  return {
    amount: "100,00",
    spentOn: "2026-10-10",
    description: "Material escolar",
    category: "escola",
    paidBy: "m1",
    payerPercent: "50",
    ...patch,
  };
}

describe("initialExpenseForm (RF-09: the family default comes filled in)", () => {
  it("starts today, paid by the caller, with the family default share", () => {
    expect(initialExpenseForm(TODAY, 5000, "m2")).toEqual({
      amount: "",
      spentOn: TODAY,
      description: "",
      category: "outros",
      paidBy: "m2",
      payerPercent: "50",
    });
    expect(initialExpenseForm(TODAY, 3333, "m1").payerPercent).toBe("33,33");
    expect(initialExpenseForm(TODAY, 0, "m1").payerPercent).toBe("0");
  });
});

describe("validateExpenseForm", () => {
  it("accepts a complete expense", () => {
    expect(validateExpenseForm(valid(), IDS, TODAY)).toEqual({});
    expect(validateExpenseForm(valid({ spentOn: TODAY, payerPercent: "33,33" }), IDS, TODAY)).toEqual({});
  });

  it("requires a positive amount within the limit", () => {
    expect(validateExpenseForm(valid({ amount: "" }), IDS, TODAY).amount).toBeDefined();
    expect(validateExpenseForm(valid({ amount: "12,345,6" }), IDS, TODAY).amount).toBeDefined();
    expect(validateExpenseForm(valid({ amount: "0,00" }), IDS, TODAY).amount).toBe("O valor deve ser maior que zero.");
    expect(validateExpenseForm(valid({ amount: "1.000.000,01" }), IDS, TODAY).amount).toBeDefined();
    expect(validateExpenseForm(valid({ amount: "1.000.000,00" }), IDS, TODAY)).toEqual({});
  });

  it("requires a date that is not in the future", () => {
    expect(validateExpenseForm(valid({ spentOn: "" }), IDS, TODAY).spentOn).toBeDefined();
    expect(validateExpenseForm(valid({ spentOn: "2026-02-30" }), IDS, TODAY).spentOn).toBeDefined();
    expect(validateExpenseForm(valid({ spentOn: "2026-10-15" }), IDS, TODAY).spentOn).toBe("A data não pode ser no futuro.");
  });

  it("requires a description of up to 200 characters", () => {
    expect(validateExpenseForm(valid({ description: "   " }), IDS, TODAY).description).toBeDefined();
    expect(validateExpenseForm(valid({ description: "x".repeat(201) }), IDS, TODAY).description).toBeDefined();
    expect(validateExpenseForm(valid({ description: "x".repeat(200) }), IDS, TODAY)).toEqual({});
  });

  it("requires a known category and a payer of the family", () => {
    expect(validateExpenseForm(valid({ category: "viagem" }), IDS, TODAY).category).toBeDefined();
    expect(validateExpenseForm(valid({ paidBy: "m9" }), IDS, TODAY).paidBy).toBeDefined();
  });

  it("requires a share between 0 and 100 (RF-09)", () => {
    for (const p of ["", "101", "-10", "33,333", "abc"]) {
      expect(validateExpenseForm(valid({ payerPercent: p }), IDS, TODAY).payerPercent).toBeDefined();
    }
    for (const p of ["0", "100", "70", "12,5"]) {
      expect(validateExpenseForm(valid({ payerPercent: p }), IDS, TODAY)).toEqual({});
    }
  });
});

describe("toExpenseInsert", () => {
  it("sends the amount in cents and the share in basis points", () => {
    expect(toExpenseInsert("f1", valid({ amount: "80,5", payerPercent: "30", paidBy: "m2", description: " Dentista " }))).toEqual({
      family_id: "f1",
      paid_by: "m2",
      amount_cents: 8050,
      spent_on: "2026-10-10",
      description: "Dentista",
      category: "escola",
      payer_share_bps: 3000,
    });
  });

  it("never sends status, receipt or authorship (the database sets them)", () => {
    const row = toExpenseInsert("f1", valid());
    expect(Object.keys(row)).not.toContain("status");
    expect(Object.keys(row)).not.toContain("created_by");
    expect(Object.keys(row)).not.toContain("deleted_at");
    expect(Number.isInteger(row.amount_cents)).toBe(true);
  });

  it("refuses an invalid form", () => {
    expect(() => toExpenseInsert("f1", valid({ amount: "x" }))).toThrow();
    expect(() => toExpenseInsert("f1", valid({ payerPercent: "200" }))).toThrow();
  });
});

describe("describeSplit", () => {
  it("shows what each member carries, closing to the cent", () => {
    expect(plain(describeSplit(valid(), MEMBERS, "EUR"))).toBe("Ana paga 50,00 € (50%) e Bruno, 50,00 € (50%).");
    expect(plain(describeSplit(valid({ amount: "80", payerPercent: "30", paidBy: "m2" }), MEMBERS, "EUR"))).toBe(
      "Bruno paga 24,00 € (30%) e Ana, 56,00 € (70%).",
    );
    expect(plain(describeSplit(valid({ amount: "10", payerPercent: "33,33" }), MEMBERS, "EUR"))).toBe(
      "Ana paga 3,33 € (33,33%) e Bruno, 6,67 € (66,67%).",
    );
  });

  it("names the other member generically before the invite is accepted", () => {
    expect(plain(describeSplit(valid(), [MEMBERS[0]], "EUR"))).toBe("Ana paga 50,00 € (50%) e o outro responsável, 50,00 € (50%).");
  });

  it("is empty while the amount or the share is not valid", () => {
    expect(describeSplit(valid({ amount: "" }), MEMBERS, "EUR")).toBeNull();
    expect(describeSplit(valid({ amount: "0" }), MEMBERS, "EUR")).toBeNull();
    expect(describeSplit(valid({ payerPercent: "150" }), MEMBERS, "EUR")).toBeNull();
  });
});

describe("labels and messages", () => {
  it("has a label for each category of the database check", () => {
    expect(CATEGORIES.map((c) => c.value)).toEqual(["saude", "escola", "alimentacao", "vestuario", "lazer", "transporte", "outros"]);
    expect(categoryLabel("saude")).toBe("Saúde");
  });

  it("describes a saved expense", () => {
    expect(plain(describeSavedExpense({ description: "Dentista", amount_cents: 8000, spent_on: "2026-10-10" }, "EUR"))).toBe(
      "Dentista: 80,00 € em 10/10/2026",
    );
  });

  it("maps database errors", () => {
    expect(expenseSaveErrorMessage("23503")).toBe("Quem pagou não faz parte da família.");
    expect(expenseSaveErrorMessage("42501")).toContain("permissão");
    expect(expenseSaveErrorMessage("23514")).toContain("Dados inválidos");
    expect(expenseSaveErrorMessage(undefined)).toContain("Tente novamente");
  });

  it("validates the family default share", () => {
    expect(validateDefaultShare("60")).toBeNull();
    expect(validateDefaultShare("100,5")).not.toBeNull();
  });
});

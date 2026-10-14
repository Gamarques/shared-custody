import { formatDate } from "@/lib/custody/rule-form";
import { parseDate } from "@/lib/custody/timezone";
import { formatBps, formatCents, MAX_AMOUNT_CENTS, parseAmountToCents, parsePercentToBps, splitExpense } from "./money";

/**
 * Expense form (RF-08, RF-09, T-13). The amount is typed as text and stored as integer cents;
 * the payer's share comes prefilled with the family default (families.default_payer_share_bps)
 * and can be changed for each expense. The receipt photo arrives in T-14.
 */

/** Same values as the expenses.category check; the labels are what the screen shows. */
export const CATEGORIES = [
  { value: "saude", label: "Saúde" },
  { value: "escola", label: "Escola" },
  { value: "alimentacao", label: "Alimentação" },
  { value: "vestuario", label: "Vestuário" },
  { value: "lazer", label: "Lazer" },
  { value: "transporte", label: "Transporte" },
  { value: "outros", label: "Outros" },
] as const;

export type Category = (typeof CATEGORIES)[number]["value"];

export const DESCRIPTION_MAX_LENGTH = 200;

export type ExpenseFormInput = {
  /** As typed: "12,50", "1.234,56". */
  amount: string;
  /** YYYY-MM-DD, local to the family zone. */
  spentOn: string;
  description: string;
  category: string;
  /** members.id of who paid. */
  paidBy: string;
  /** Share of the payer, in percent as typed: "50", "33,33". */
  payerPercent: string;
};

export type ExpenseFormErrors = Partial<Record<keyof ExpenseFormInput, string>>;

export function categoryLabel(value: string): string {
  return CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

/** Empty expense paid by the caller today, with the family's default share filled in. */
export function initialExpenseForm(today: string, defaultShareBps: number, myMemberId: string): ExpenseFormInput {
  return {
    amount: "",
    spentOn: today,
    description: "",
    category: "outros",
    paidBy: myMemberId,
    payerPercent: formatBps(defaultShareBps),
  };
}

function isValidDate(date: string): boolean {
  try {
    parseDate(date);
    return true;
  } catch {
    return false;
  }
}

export function validateExpenseForm(
  input: ExpenseFormInput,
  memberIds: readonly string[],
  today: string,
): ExpenseFormErrors {
  const errors: ExpenseFormErrors = {};
  const cents = parseAmountToCents(input.amount);
  if (cents === null) errors.amount = "Informe o valor, por exemplo 12,50.";
  else if (cents === 0) errors.amount = "O valor deve ser maior que zero.";
  else if (cents > MAX_AMOUNT_CENTS) errors.amount = "Valor alto demais para uma despesa.";

  if (!isValidDate(input.spentOn)) errors.spentOn = "Informe a data da despesa.";
  else if (input.spentOn > today) errors.spentOn = "A data não pode ser no futuro.";

  const description = input.description.trim();
  if (description.length === 0) errors.description = "Descreva a despesa.";
  else if (description.length > DESCRIPTION_MAX_LENGTH)
    errors.description = `A descrição tem no máximo ${DESCRIPTION_MAX_LENGTH} caracteres.`;

  if (!CATEGORIES.some((c) => c.value === input.category)) errors.category = "Escolha uma categoria.";
  if (!memberIds.includes(input.paidBy)) errors.paidBy = "Escolha quem pagou.";
  if (parsePercentToBps(input.payerPercent) === null)
    errors.payerPercent = "Informe um percentual entre 0 e 100, com até 2 casas decimais.";
  return errors;
}

/** Row for `insert into expenses`; call only when validateExpenseForm found nothing. */
export function toExpenseInsert(familyId: string, input: ExpenseFormInput) {
  const amountCents = parseAmountToCents(input.amount);
  const payerShareBps = parsePercentToBps(input.payerPercent);
  if (amountCents === null || payerShareBps === null) throw new Error("Invalid expense");
  return {
    family_id: familyId,
    paid_by: input.paidBy,
    amount_cents: amountCents,
    spent_on: input.spentOn,
    description: input.description.trim(),
    category: input.category,
    payer_share_bps: payerShareBps,
  };
}

export type SplitMember = { id: string; name: string };

/**
 * "Ana paga 30,00 € (60%) e Bruno, 20,00 € (40%)", or null while the amount or the share is
 * not valid yet. Shown under the form so the split is clear before saving.
 */
export function describeSplit(
  input: Pick<ExpenseFormInput, "amount" | "paidBy" | "payerPercent">,
  members: readonly SplitMember[],
  currency: string,
): string | null {
  const cents = parseAmountToCents(input.amount);
  const bps = parsePercentToBps(input.payerPercent);
  const payer = members.find((m) => m.id === input.paidBy);
  if (!cents || cents > MAX_AMOUNT_CENTS || bps === null || !payer) return null;
  const other = members.find((m) => m.id !== input.paidBy);
  const { payerCents, otherCents } = splitExpense(cents, bps);
  const payerPart = `${payer.name} paga ${formatCents(payerCents, currency)} (${formatBps(bps)}%)`;
  const otherPart = `${other?.name ?? "o outro responsável"}, ${formatCents(otherCents, currency)} (${formatBps(10_000 - bps)}%)`;
  return `${payerPart} e ${otherPart}.`;
}

/** "Material escolar: 100,00 € em 10/10/2026". */
export function describeSavedExpense(
  row: { description: string; amount_cents: number; spent_on: string },
  currency: string,
): string {
  return `${row.description}: ${formatCents(row.amount_cents, currency)} em ${formatDate(row.spent_on)}`;
}

/** Message for a failed insert (Postgres SQLSTATE from supabase-js). */
export function expenseSaveErrorMessage(code: string | undefined): string {
  switch (code) {
    case "23514":
    case "22003":
      return "Dados inválidos: confira o valor, a descrição, a categoria e o percentual.";
    case "23503":
      return "Quem pagou não faz parte da família.";
    case "42501":
      return "Você não tem permissão para registrar despesas nesta família.";
    default:
      return "Não foi possível salvar a despesa. Tente novamente.";
  }
}

/** Family default share (RF-09): the percent typed for "quem pagou arca com", in basis points. */
export function validateDefaultShare(percent: string): string | null {
  return parsePercentToBps(percent) === null ? "Informe um percentual entre 0 e 100, com até 2 casas decimais." : null;
}

export function defaultShareSaveErrorMessage(code: string | undefined): string {
  switch (code) {
    case "23514":
      return "O percentual deve estar entre 0 e 100.";
    case "42501":
      return "Você não tem permissão para alterar esta família.";
    default:
      return "Não foi possível salvar o padrão. Tente novamente.";
  }
}

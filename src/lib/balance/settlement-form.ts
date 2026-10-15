import { parseIsoDate } from "./balance-view";
import { MAX_AMOUNT_CENTS, parseAmountToCents } from "@/lib/expenses/money";

/**
 * Settlement form (RF-14, T-21): a payment from one member to the other. The amount is typed
 * as text and stored as integer cents; the page prefills the direction and amount with the
 * current debt.
 */

export const NOTE_MAX_LENGTH = 200;

export type SettlementFormInput = {
  /** As typed: "6,00". */
  amount: string;
  /** YYYY-MM-DD. */
  settledOn: string;
  /** members.id of who pays. */
  fromMember: string;
  /** Optional free text. */
  note: string;
};

export type SettlementFormErrors = Partial<Record<keyof SettlementFormInput | "toMember", string>>;

export function validateSettlementForm(
  input: SettlementFormInput,
  memberIds: readonly string[],
  today: string,
): SettlementFormErrors {
  const errors: SettlementFormErrors = {};
  const cents = parseAmountToCents(input.amount);
  if (cents === null) errors.amount = "Informe o valor, por exemplo 6,00.";
  else if (cents === 0) errors.amount = "O valor deve ser maior que zero.";
  else if (cents > MAX_AMOUNT_CENTS) errors.amount = "Valor alto demais para um acerto.";

  const date = parseIsoDate(input.settledOn);
  if (!date) errors.settledOn = "Informe a data do acerto.";
  else if (date > today) errors.settledOn = "A data não pode ser no futuro.";

  if (!memberIds.includes(input.fromMember)) errors.fromMember = "Escolha quem pagou.";
  else if (memberIds.length !== 2) errors.toMember = "O acerto precisa dos dois responsáveis.";

  if (input.note.trim().length > NOTE_MAX_LENGTH) {
    errors.note = `A observação deve ter no máximo ${NOTE_MAX_LENGTH} caracteres.`;
  }
  return errors;
}

/** The other member of the pair, or null when `fromMember` is not one of exactly two. */
export function otherMember(memberIds: readonly string[], fromMember: string): string | null {
  if (memberIds.length !== 2 || !memberIds.includes(fromMember)) return null;
  return memberIds.find((id) => id !== fromMember) ?? null;
}

/** The settlements row to insert; call only when validateSettlementForm returned no errors. */
export function toSettlementInsert(familyId: string, memberIds: readonly string[], input: SettlementFormInput) {
  const to = otherMember(memberIds, input.fromMember);
  const cents = parseAmountToCents(input.amount);
  if (!to || cents === null) throw new Error("invalid settlement form");
  return {
    family_id: familyId,
    from_member: input.fromMember,
    to_member: to,
    amount_cents: cents,
    settled_on: input.settledOn,
    note: input.note.trim() || null,
  };
}

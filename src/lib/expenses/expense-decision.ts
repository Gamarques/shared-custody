/** Confirm or dispute an expense (RF-11, T-16). The server enforces the rules; this is UI-side. */

export const MAX_DISPUTE_COMMENT = 500;

/** Screen labels of expenses.status. */
export const STATUS_LABELS: Readonly<Record<string, string>> = {
  pending: "Pendente",
  confirmed: "Confirmada",
  disputed: "Contestada",
};

/** Trimmed comment, or an error message in pt-BR when a dispute comment is blank or too long. */
export function validateDisputeComment(raw: string): { ok: true; comment: string } | { ok: false; error: string } {
  const comment = raw.trim();
  if (!comment) return { ok: false, error: "Explique o motivo da contestação." };
  if (comment.length > MAX_DISPUTE_COMMENT) {
    return { ok: false, error: `O comentário deve ter no máximo ${MAX_DISPUTE_COMMENT} caracteres.` };
  }
  return { ok: true, comment };
}

/** The decision buttons are shown only to the member who did not pay, while not deleted. */
export function canDecide(expense: { paid_by: string; status: string }, myMemberId: string | null): boolean {
  return myMemberId !== null && expense.paid_by !== myMemberId && expense.status !== "confirmed";
}

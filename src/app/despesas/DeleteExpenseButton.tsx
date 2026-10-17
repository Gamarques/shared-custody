"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { expenseSaveErrorMessage } from "@/lib/expenses/expense-form";
import { createClient } from "@/lib/supabase/client";
import { RowIcon } from "./RowIcons";
import styles from "./despesas.module.css";

/** Logical deletion (RF-17): sets deleted_at; the history stays in expense_audit. */
export function DeleteExpenseButton({ expenseId }: { expenseId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    setBusy(true);
    setError("");
    const { error: failed } = await createClient()
      .from("expenses")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", expenseId);
    setBusy(false);
    if (failed) {
      setError(expenseSaveErrorMessage(failed.code));
      return;
    }
    router.refresh();
  }

  return (
    <span className={styles.deleteWrap}>
      <button
        type="button"
        className={`btn btn-ghost btn-icon btn-sm ${styles.dangerHover}`}
        aria-label="Excluir"
        title="Excluir"
        aria-expanded={confirming}
        onClick={() => setConfirming((open) => !open)}
      >
        <RowIcon name="trash" />
      </button>
      {confirming && (
        <span data-testid="delete-confirm" className={styles.confirmDelete}>
          <span>Excluir esta despesa? O histórico é mantido.</span>
          <span className={styles.confirmButtons}>
            <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={remove}>
              Confirmar exclusão
            </button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setConfirming(false)}>
              Cancelar
            </button>
          </span>
          {error && <span role="alert">{error}</span>}
        </span>
      )}
    </span>
  );
}

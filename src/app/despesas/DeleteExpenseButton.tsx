"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
  const dialog = useRef<HTMLDialogElement>(null);

  // A modal dialog (top layer, dimmed backdrop, Esc closes) instead of a popover next to the icon:
  // it never floats away from the row on a phone and never covers the neighbouring rows on desktop.
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (confirming && !el.open) el.showModal();
    if (!confirming && el.open) el.close();
  }, [confirming]);

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
        <dialog
          ref={dialog}
          data-testid="delete-confirm"
          className={styles.confirmDelete}
          aria-labelledby={`delete-title-${expenseId}`}
          onClose={() => setConfirming(false)}
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirming(false);
          }}
        >
          <h2 id={`delete-title-${expenseId}`} className={styles.confirmTitle}>
            Excluir esta despesa?
          </h2>
          <p className={styles.confirmText}>O histórico é mantido.</p>
          {error && <p role="alert">{error}</p>}
          <div className={styles.confirmButtons}>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setConfirming(false)}>
              Cancelar
            </button>
            <button type="button" className="btn btn-danger" disabled={busy} onClick={remove}>
              Confirmar exclusão
            </button>
          </div>
        </dialog>
      )}
    </span>
  );
}

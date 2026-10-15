"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { expenseSaveErrorMessage } from "@/lib/expenses/expense-form";
import { createClient } from "@/lib/supabase/client";

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

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)}>
        Excluir
      </button>
    );
  }
  return (
    <span data-testid="delete-confirm">
      Excluir esta despesa? O histórico é mantido.{" "}
      <button type="button" disabled={busy} onClick={remove}>
        Confirmar exclusão
      </button>{" "}
      <button type="button" disabled={busy} onClick={() => setConfirming(false)}>
        Cancelar
      </button>
      {error && <span role="alert"> {error}</span>}
    </span>
  );
}

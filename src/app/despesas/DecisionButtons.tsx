"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { validateDisputeComment } from "@/lib/expenses/expense-decision";
import { createClient } from "@/lib/supabase/client";
import styles from "./despesas.module.css";

/** Confirm or dispute an expense (RF-11); shown only to the member who did not pay. */
export function DecisionButtons({ expenseId }: { expenseId: string }) {
  const router = useRouter();
  const [disputing, setDisputing] = useState(false);
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(call: () => PromiseLike<{ error: unknown }>) {
    setBusy(true);
    setError("");
    const { error: failed } = await call();
    setBusy(false);
    if (failed) {
      setError("Não foi possível registar a decisão.");
      return;
    }
    router.refresh();
  }

  const confirm = () => run(() => createClient().rpc("confirm_expense", { eid: expenseId }));

  function dispute() {
    const checked = validateDisputeComment(comment);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    return run(() => createClient().rpc("dispute_expense", { eid: expenseId, comment: checked.comment }));
  }

  return (
    <div data-testid="decision" className={styles.decision}>
      {!disputing ? (
        <div className={styles.decisionButtons}>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={confirm}>
            Confirmar
          </button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setDisputing(true)}>
            Contestar
          </button>
        </div>
      ) : (
        <>
          <label>
            Motivo da contestação
            <textarea value={comment} maxLength={500} onChange={(e) => setComment(e.target.value)} />
          </label>
          <div className={styles.decisionButtons}>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={dispute}>
              Enviar contestação
            </button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setDisputing(false)}>
              Cancelar
            </button>
          </div>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

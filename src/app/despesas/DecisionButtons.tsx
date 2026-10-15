"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { validateDisputeComment } from "@/lib/expenses/expense-decision";
import { createClient } from "@/lib/supabase/client";

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
      setError("Não foi possível registrar a decisão.");
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
    <div data-testid="decision">
      {!disputing ? (
        <>
          <button type="button" disabled={busy} onClick={confirm}>
            Confirmar
          </button>{" "}
          <button type="button" disabled={busy} onClick={() => setDisputing(true)}>
            Contestar
          </button>
        </>
      ) : (
        <>
          <label>
            Motivo da contestação
            <textarea value={comment} maxLength={500} onChange={(e) => setComment(e.target.value)} />
          </label>
          <button type="button" disabled={busy} onClick={dispute}>
            Enviar contestação
          </button>{" "}
          <button type="button" disabled={busy} onClick={() => setDisputing(false)}>
            Cancelar
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

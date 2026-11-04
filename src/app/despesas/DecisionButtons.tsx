"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { validateDisputeComment } from "@/lib/expenses/expense-decision";
import { disputeCommentReady } from "@/lib/forms/ready";
import { createClient } from "@/lib/supabase/client";
import { showFeedback, type FeedbackCode } from "../_components/feedback-store";
import styles from "./despesas.module.css";

/** Confirm or dispute an expense (RF-11); shown only to the member who did not pay. */
export function DecisionButtons({ expenseId }: { expenseId: string }) {
  const router = useRouter();
  const [disputing, setDisputing] = useState(false);
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState<"confirm" | "dispute" | null>(null);
  const busy = sending !== null;

  async function run(kind: "confirm" | "dispute", done: FeedbackCode, call: () => PromiseLike<{ error: unknown }>) {
    setSending(kind);
    setError("");
    const { error: failed } = await call();
    setSending(null);
    if (failed) {
      setError("Não foi possível registar a decisão.");
      return;
    }
    if (kind === "dispute") {
      // Sent: close the comment box (the expense may still be shown as disputed, with its buttons).
      setDisputing(false);
      setComment("");
    }
    showFeedback(done);
    router.refresh();
  }

  const confirm = () => run("confirm", "despesa-confirmada", () => createClient().rpc("confirm_expense", { eid: expenseId }));

  function dispute() {
    const checked = validateDisputeComment(comment);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    return run("dispute", "contestacao-enviada", () =>
      createClient().rpc("dispute_expense", { eid: expenseId, comment: checked.comment }),
    );
  }

  return (
    <div data-testid="decision" className={styles.decision}>
      {!disputing ? (
        <div className={styles.decisionButtons}>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={confirm}>
            {sending === "confirm" ? "A confirmar…" : "Confirmar"}
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
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy || !disputeCommentReady(comment)}
              onClick={dispute}
            >
              {sending === "dispute" ? "A enviar…" : "Enviar contestação"}
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

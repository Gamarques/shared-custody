"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { defaultShareSaveErrorMessage, validateDefaultShare } from "@/lib/expenses/expense-form";
import { formatBps, parsePercentToBps } from "@/lib/expenses/money";
import { createClient } from "@/lib/supabase/client";

type Props = { familyId: string; defaultShareBps: number };

/**
 * Edits the family default share (RF-09). The page keys this form by the saved value, so it
 * starts over from it after router.refresh().
 */
export function DefaultShareForm({ familyId, defaultShareBps }: Props) {
  const router = useRouter();
  const [percent, setPercent] = useState(formatBps(defaultShareBps));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const invalid = validateDefaultShare(percent);
    setError(invalid ?? "");
    const bps = parsePercentToBps(percent);
    if (invalid || bps === null) return;
    setBusy(true);
    // RLS turns an update of another family into zero rows, not an error: ask for the row back.
    const { data, error: saveError } = await createClient()
      .from("families")
      .update({ default_payer_share_bps: bps })
      .eq("id", familyId)
      .select("id");
    setBusy(false);
    if (saveError || !data?.length) {
      setError(defaultShareSaveErrorMessage(saveError?.code ?? "42501"));
      return;
    }
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit}>
      <label htmlFor="defaultPercent">Quem pagou fica com (%)</label>
      <input
        id="defaultPercent"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={percent}
        onChange={(e) => setPercent(e.target.value)}
      />
      <button type="submit" disabled={busy || parsePercentToBps(percent) === defaultShareBps}>
        {busy ? "Salvando…" : "Salvar padrão"}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

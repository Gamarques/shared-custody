"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { overrideSaveErrorMessage } from "@/lib/custody/override-form";
import { createClient } from "@/lib/supabase/client";

/** Removes an override after confirmation; the rule applies again for its period. */
export function DeleteOverrideButton({ id, reason }: { id: string; reason: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onClick() {
    if (!window.confirm(`Remover a exceção "${reason}"? A regra de guarda volta a valer nesse período.`)) return;
    setBusy(true);
    setError("");
    const { error: failed } = await createClient().from("custody_overrides").delete().eq("id", id);
    setBusy(false);
    if (failed) {
      setError(overrideSaveErrorMessage(failed.code, "remover"));
      return;
    }
    router.refresh();
  }

  return (
    <>
      <button type="button" className="btn btn-danger btn-sm" onClick={onClick} disabled={busy}>
        {busy ? "A remover…" : "Remover"}
      </button>
      {error && <span role="alert"> {error}</span>}
    </>
  );
}

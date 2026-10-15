"use client";

import { useState } from "react";
import { getReceiptUrl, openReceipt } from "@/lib/receipts/receipts";
import { createClient } from "@/lib/supabase/client";

/** Opens a receipt through a fresh short-lived signed URL (RNF-08); the bucket is private. */
export function ReceiptLink({ path }: { path: string }) {
  const [error, setError] = useState("");

  async function open() {
    setError("");
    const opened = await openReceipt(window, () => getReceiptUrl(createClient().storage, path));
    if (!opened) setError("Não foi possível abrir o comprovante.");
  }

  return (
    <>
      <button type="button" className="link-button" onClick={open}>
        Ver comprovante
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}

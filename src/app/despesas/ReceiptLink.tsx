"use client";

import { useState } from "react";
import { getReceiptUrl } from "@/lib/receipts/receipts";
import { createClient } from "@/lib/supabase/client";

/** Opens a receipt through a fresh short-lived signed URL (RNF-08); the bucket is private. */
export function ReceiptLink({ path }: { path: string }) {
  const [error, setError] = useState("");

  async function open() {
    setError("");
    const url = await getReceiptUrl(createClient().storage, path);
    if (!url) {
      setError("Não foi possível abrir o comprovante.");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
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

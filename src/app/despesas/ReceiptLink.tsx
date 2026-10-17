"use client";

import { useState } from "react";
import { getReceiptUrl, openReceipt } from "@/lib/receipts/receipts";
import { createClient } from "@/lib/supabase/client";
import { RowIcon } from "./RowIcons";
import styles from "./despesas.module.css";

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
      <button type="button" className={styles.receipt} onClick={open}>
        <RowIcon name="paperclip" size={14} />
        Ver comprovante
      </button>
      {error && (
        <p role="alert" className={styles.receiptError}>
          {error}
        </p>
      )}
    </>
  );
}

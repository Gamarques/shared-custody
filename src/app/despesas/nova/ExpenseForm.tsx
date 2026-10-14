"use client";

import { useRef, useState, type FormEvent } from "react";
import {
  CATEGORIES,
  describeSavedExpense,
  describeSplit,
  DESCRIPTION_MAX_LENGTH,
  expenseSaveErrorMessage,
  toExpenseInsert,
  validateExpenseForm,
  type ExpenseFormErrors,
  type ExpenseFormInput,
  type SplitMember,
} from "@/lib/expenses/expense-form";
import { formatBps } from "@/lib/expenses/money";
import { checkReceiptFile, compressReceiptPhoto, receiptErrorMessage } from "@/lib/receipts/compress";
import { RECEIPT_BUCKET, receiptPath } from "@/lib/receipts/receipts";
import { createClient } from "@/lib/supabase/client";

type Props = {
  familyId: string;
  currency: string;
  /** Today in the family zone: the latest date accepted. */
  today: string;
  members: SplitMember[];
  /** Family default share; refills the percent while the person has not changed it. */
  defaultShareBps: number;
  initial: ExpenseFormInput;
};

/** Registers an expense (RF-08) with the payer's share for this expense (RF-09). */
export function ExpenseForm({ familyId, currency, today, members, defaultShareBps, initial }: Props) {
  const [form, setForm] = useState<ExpenseFormInput>(initial);
  const [percentEdited, setPercentEdited] = useState(false);
  const [shownDefault, setShownDefault] = useState(defaultShareBps);
  const [errors, setErrors] = useState<ExpenseFormErrors>({});
  const [submitError, setSubmitError] = useState("");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<File | null>(null);
  const [receiptError, setReceiptError] = useState("");
  const receiptInput = useRef<HTMLInputElement>(null);
  const defaultPercent = formatBps(defaultShareBps);

  // The family default changed (saved below on the same page): follow it unless edited here.
  if (shownDefault !== defaultShareBps) {
    setShownDefault(defaultShareBps);
    if (!percentEdited) setForm((f) => ({ ...f, payerPercent: defaultPercent }));
  }

  function update(patch: Partial<ExpenseFormInput>) {
    setForm((f) => ({ ...f, ...patch }));
    setSaved("");
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const found = validateExpenseForm(form, members.map((m) => m.id), today);
    setErrors(found);
    setSubmitError("");
    setSaved("");
    if (Object.keys(found).length > 0) return;
    const check = receipt ? checkReceiptFile(receipt) : "ok";
    if (receipt && check !== "ok") {
      setReceiptError(receiptErrorMessage(null, check));
      return;
    }
    setReceiptError("");
    setBusy(true);
    const supabase = createClient();
    let path: string | null = null;
    if (receipt) {
      let photo: Blob;
      try {
        photo = await compressReceiptPhoto(receipt);
      } catch (err) {
        setBusy(false);
        setReceiptError(receiptErrorMessage(err));
        return;
      }
      path = receiptPath(familyId, crypto.randomUUID());
      const { error: uploadError } = await supabase.storage
        .from(RECEIPT_BUCKET)
        .upload(path, photo, { contentType: "image/jpeg", upsert: false });
      if (uploadError) {
        setBusy(false);
        setReceiptError("Não foi possível enviar a foto. Tente novamente.");
        return;
      }
    }
    const row = toExpenseInsert(familyId, form, path);
    const { error } = await supabase.from("expenses").insert(row);
    setBusy(false);
    if (error) {
      // Do not leave an orphan photo behind.
      if (path) await supabase.storage.from(RECEIPT_BUCKET).remove([path]);
      setSubmitError(expenseSaveErrorMessage(error.code));
      return;
    }
    setSaved(`Despesa registrada: ${describeSavedExpense(row, currency)}. Aguarda a confirmação do outro responsável.`);
    setForm({ ...initial, spentOn: form.spentOn, paidBy: form.paidBy, payerPercent: defaultPercent });
    setPercentEdited(false);
    setReceipt(null);
    if (receiptInput.current) receiptInput.current.value = "";
  }

  const split = describeSplit(form, members, currency);

  return (
    <form onSubmit={onSubmit}>
      <label htmlFor="amount">Valor ({currency})</label>
      <input
        id="amount"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder="0,00"
        value={form.amount}
        onChange={(e) => update({ amount: e.target.value })}
      />
      {errors.amount && <p role="alert">{errors.amount}</p>}

      <label htmlFor="spentOn">Data</label>
      <input id="spentOn" type="date" max={today} value={form.spentOn} onChange={(e) => update({ spentOn: e.target.value })} />
      {errors.spentOn && <p role="alert">{errors.spentOn}</p>}

      <label htmlFor="description">Descrição</label>
      <input
        id="description"
        type="text"
        maxLength={DESCRIPTION_MAX_LENGTH}
        placeholder="Ex.: Material escolar, Dentista"
        value={form.description}
        onChange={(e) => update({ description: e.target.value })}
      />
      {errors.description && <p role="alert">{errors.description}</p>}

      <label htmlFor="category">Categoria</label>
      <select id="category" value={form.category} onChange={(e) => update({ category: e.target.value })}>
        {CATEGORIES.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
      {errors.category && <p role="alert">{errors.category}</p>}

      <label htmlFor="paidBy">Quem pagou</label>
      <select id="paidBy" value={form.paidBy} onChange={(e) => update({ paidBy: e.target.value })}>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      {errors.paidBy && <p role="alert">{errors.paidBy}</p>}

      <label htmlFor="payerPercent">Parte de quem pagou (%)</label>
      <input
        id="payerPercent"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={form.payerPercent}
        onChange={(e) => {
          update({ payerPercent: e.target.value });
          setPercentEdited(true);
        }}
      />
      {form.payerPercent !== defaultPercent && (
        <button
          type="button"
          className="link-button"
          onClick={() => {
            update({ payerPercent: defaultPercent });
            setPercentEdited(false);
          }}
        >
          Usar o padrão da família ({defaultPercent}%)
        </button>
      )}
      {errors.payerPercent && <p role="alert">{errors.payerPercent}</p>}
      {split && (
        <p data-testid="split">
          {split}
        </p>
      )}

      <label htmlFor="receipt">Comprovante (foto, opcional)</label>
      <input
        id="receipt"
        ref={receiptInput}
        type="file"
        accept="image/*"
        onChange={(e) => {
          setReceipt(e.target.files?.[0] ?? null);
          setReceiptError("");
          setSaved("");
        }}
      />
      <p>A foto é reduzida para cerca de 300 KB antes do envio e só os dois responsáveis a veem.</p>
      {receiptError && <p role="alert">{receiptError}</p>}

      <button type="submit" disabled={busy}>
        {busy ? "Salvando…" : "Registrar despesa"}
      </button>
      {submitError && <p role="alert">{submitError}</p>}
      {saved && <p role="status">{saved}</p>}
    </form>
  );
}

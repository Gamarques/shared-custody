"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  CATEGORIES,
  describeSavedExpense,
  describeSplit,
  DESCRIPTION_MAX_LENGTH,
  expenseSaveErrorMessage,
  toExpenseInsert,
  toExpenseUpdate,
  validateExpenseForm,
  type ExpenseFormErrors,
  type ExpenseFormInput,
  type SplitMember,
} from "@/lib/expenses/expense-form";
import { formatBps } from "@/lib/expenses/money";
import { checkReceiptFile, compressReceiptPhoto, receiptErrorMessage } from "@/lib/receipts/compress";
import { RECEIPT_BUCKET, receiptPath } from "@/lib/receipts/receipts";
import { createClient } from "@/lib/supabase/client";
import { RowIcon } from "../RowIcons";
import styles from "../despesas.module.css";

type Props = {
  familyId: string;
  currency: string;
  /** Today in the family zone: the latest date accepted. */
  today: string;
  members: SplitMember[];
  /** Family default share; refills the percent while the person has not changed it. */
  defaultShareBps: number;
  initial: ExpenseFormInput;
  /** Edit mode (RF-17): updates this expense instead of inserting; the receipt is kept. */
  expenseId?: string;
  /** Secondary action (a back link) shown left of the submit button. */
  cancel?: ReactNode;
};

/** Registers (RF-08) or edits (RF-17) an expense, with the payer's share for this expense (RF-09). */
export function ExpenseForm({ familyId, currency, today, members, defaultShareBps, initial, expenseId, cancel }: Props) {
  const router = useRouter();
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
    if (expenseId) {
      setBusy(true);
      const { error: updateError } = await createClient()
        .from("expenses")
        .update(toExpenseUpdate(form))
        .eq("id", expenseId)
        .eq("family_id", familyId);
      setBusy(false);
      if (updateError) {
        setSubmitError(expenseSaveErrorMessage(updateError.code));
        return;
      }
      router.push("/despesas");
      router.refresh();
      return;
    }
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
    <form onSubmit={onSubmit} className={styles.form}>
      <div className={styles.group}>
        <div className={styles.field}>
          <label htmlFor="amount">Valor ({currency})</label>
          <div className={styles.affix}>
            <input
              id="amount"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0,00"
              value={form.amount}
              onChange={(e) => update({ amount: e.target.value })}
            />
            <span className={styles.affixText} aria-hidden="true">
              {currency}
            </span>
          </div>
          {errors.amount && <p role="alert">{errors.amount}</p>}
        </div>

        <div className={styles.field}>
          <label htmlFor="spentOn">Data</label>
          <input id="spentOn" type="date" max={today} value={form.spentOn} onChange={(e) => update({ spentOn: e.target.value })} />
          {errors.spentOn && <p role="alert">{errors.spentOn}</p>}
        </div>

        <div className={`${styles.field} ${styles.span2}`}>
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
        </div>

        <div className={`${styles.field} ${styles.span2}`}>
          <label htmlFor="category">Categoria</label>
          <select id="category" value={form.category} onChange={(e) => update({ category: e.target.value })}>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          {errors.category && <p role="alert">{errors.category}</p>}
        </div>
      </div>

      <div className={styles.group}>
        <div className={styles.field}>
          <label htmlFor="paidBy">Quem pagou</label>
          <select id="paidBy" value={form.paidBy} onChange={(e) => update({ paidBy: e.target.value })}>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          {errors.paidBy && <p role="alert">{errors.paidBy}</p>}
        </div>

        <div className={styles.field}>
          <label htmlFor="payerPercent">Parte de quem pagou (%)</label>
          <div className={styles.affix}>
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
            <span className={styles.affixText} aria-hidden="true">
              %
            </span>
          </div>
          {form.payerPercent !== defaultPercent && (
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => {
                update({ payerPercent: defaultPercent });
                setPercentEdited(false);
              }}
            >
              Usar o padrão da família ({defaultPercent}%)
            </button>
          )}
          {errors.payerPercent && <p role="alert">{errors.payerPercent}</p>}
        </div>

        {split && (
          <p data-testid="split" className={`${styles.split} ${styles.span2}`}>
            <RowIcon name="check" size={16} />
            <span>{split}</span>
          </p>
        )}
      </div>

      {!expenseId && (
        <div className={styles.group}>
          <div className={`${styles.field} ${styles.span2}`}>
            <label htmlFor="receipt">Comprovante (foto, opcional)</label>
            <div className={styles.file}>
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
            </div>
            <p className={styles.hint}>A foto é reduzida para cerca de 300 KB antes do envio e só os dois responsáveis a veem.</p>
            {receiptError && <p role="alert">{receiptError}</p>}
          </div>
        </div>
      )}

      {(submitError || saved) && (
        <div className={styles.footerNotes}>
          {submitError && <p role="alert">{submitError}</p>}
          {saved && <p role="status">{saved}</p>}
        </div>
      )}

      <div className={styles.footerBar}>
        {cancel}
        <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
          {busy ? "Salvando…" : expenseId ? "Salvar alterações" : "Registrar despesa"}
        </button>
      </div>
    </form>
  );
}

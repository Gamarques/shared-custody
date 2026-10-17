"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  toSettlementInsert,
  validateSettlementForm,
  type SettlementFormErrors,
  type SettlementFormInput,
} from "@/lib/balance/settlement-form";
import { createClient } from "@/lib/supabase/client";
import styles from "./saldo.module.css";

type Member = { id: string; display_name: string };

/** Register a settlement between the two members (RF-14). */
export function SettlementForm({
  familyId,
  members,
  initial,
  today,
}: {
  familyId: string;
  members: Member[];
  initial: SettlementFormInput;
  today: string;
}) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<SettlementFormErrors>({});
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const ids = members.map((m) => m.id);
  const set = (patch: Partial<SettlementFormInput>) => setForm((f) => ({ ...f, ...patch }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const found = validateSettlementForm(form, ids, today);
    setErrors(found);
    setFailed(false);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    const { error } = await createClient().from("settlements").insert(toSettlementInsert(familyId, ids, form));
    setBusy(false);
    if (error) {
      setFailed(true);
      return;
    }
    setForm({ ...form, amount: "", note: "" });
    router.refresh();
  }

  return (
    <form onSubmit={submit} data-testid="settlement-form" className={styles.form}>
      <label className={styles.field}>
        Quem pagou
        <select value={form.fromMember} onChange={(e) => set({ fromMember: e.target.value })}>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.display_name}
            </option>
          ))}
        </select>
      </label>
      {errors.fromMember && <p role="alert" className={styles.error}>{errors.fromMember}</p>}
      <label className={styles.field}>
        Valor
        <input inputMode="decimal" value={form.amount} onChange={(e) => set({ amount: e.target.value })} />
      </label>
      {errors.amount && <p role="alert" className={styles.error}>{errors.amount}</p>}
      <label className={styles.field}>
        Data
        <input type="date" max={today} value={form.settledOn} onChange={(e) => set({ settledOn: e.target.value })} />
      </label>
      {errors.settledOn && <p role="alert" className={styles.error}>{errors.settledOn}</p>}
      <label className={styles.field}>
        Observação
        <input value={form.note} maxLength={200} onChange={(e) => set({ note: e.target.value })} />
      </label>
      {errors.note && <p role="alert" className={styles.error}>{errors.note}</p>}
      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
        Registrar acerto
      </button>
      {failed && <p role="alert" className={styles.error}>Não foi possível registrar o acerto.</p>}
    </form>
  );
}

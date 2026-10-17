"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  OVERRIDE_PRESETS,
  overrideSaveErrorMessage,
  REASON_MAX_LENGTH,
  toCustodyOverrideInsert,
  validateOverrideForm,
  type OverrideFormErrors,
  type OverrideFormInput,
} from "@/lib/custody/override-form";
import { createClient } from "@/lib/supabase/client";
import styles from "./OverrideForm.module.css";

export type MemberOption = { id: string; name: string };

type Props = {
  familyId: string;
  /** Family zone: the dates and times typed here are local to it (RNF-04). */
  timezone: string;
  members: MemberOption[];
  initial: OverrideFormInput;
};

/** Adds a custody override (RF-07). */
export function OverrideForm({ familyId, timezone, members, initial }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<OverrideFormInput>(initial);
  const [errors, setErrors] = useState<OverrideFormErrors>({});
  const [submitError, setSubmitError] = useState("");
  const [busy, setBusy] = useState(false);

  function update(patch: Partial<OverrideFormInput>) {
    setForm((f) => ({ ...f, ...patch }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const found = validateOverrideForm(form, members.map((m) => m.id), timezone);
    setErrors(found);
    setSubmitError("");
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    const { error } = await createClient()
      .from("custody_overrides")
      .insert(toCustodyOverrideInsert(familyId, form, timezone));
    setBusy(false);
    if (error) {
      setSubmitError(overrideSaveErrorMessage(error.code));
      return;
    }
    setForm(initial);
    router.refresh();
  }

  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor="member">Com quem a criança fica</label>
        <select id="member" value={form.memberId} onChange={(e) => update({ memberId: e.target.value })}>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        {errors.memberId && <p role="alert">{errors.memberId}</p>}
      </div>

      <div className="field">
        <label htmlFor="startDate">Início</label>
        <div className={styles.row}>
          <input id="startDate" type="date" value={form.startDate} onChange={(e) => update({ startDate: e.target.value })} />
          <input
            id="startTime"
            type="time"
            aria-label="Hora de início"
            value={form.startTime}
            onChange={(e) => update({ startTime: e.target.value })}
          />
        </div>
        {errors.startDate && <p role="alert">{errors.startDate}</p>}
      </div>

      <div className="field">
        <label htmlFor="endDate">Fim</label>
        <div className={styles.row}>
          <input id="endDate" type="date" value={form.endDate} onChange={(e) => update({ endDate: e.target.value })} />
          <input
            id="endTime"
            type="time"
            aria-label="Hora de fim"
            value={form.endTime}
            onChange={(e) => update({ endTime: e.target.value })}
          />
        </div>
        {errors.endDate && <p role="alert">{errors.endDate}</p>}
      </div>

      <div className="field">
        <label htmlFor="reason">Motivo</label>
        <input
          id="reason"
          type="text"
          maxLength={REASON_MAX_LENGTH}
          placeholder="Ex.: Férias de verão, Feriado de Natal"
          value={form.reason}
          onChange={(e) => update({ reason: e.target.value })}
        />
        <div className={styles.presets}>
          {OVERRIDE_PRESETS.map((p) => (
            <button key={p} type="button" className={styles.preset} onClick={() => update({ reason: p })}>
              {p}
            </button>
          ))}
        </div>
        {errors.reason && <p role="alert">{errors.reason}</p>}
      </div>

      {submitError && <p role="alert">{submitError}</p>}
      <div className={styles.actions}>
        <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
          {busy ? "Salvando…" : "Adicionar exceção"}
        </button>
      </div>
    </form>
  );
}

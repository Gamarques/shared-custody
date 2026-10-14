"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  nextWeekdayOnOrAfter,
  ruleSaveErrorMessage,
  toCustodyRuleInsert,
  validateRuleForm,
  weekdayOf,
  WEEKDAYS,
  type RuleFormErrors,
  type RuleFormInput,
} from "@/lib/custody/rule-form";
import { createClient } from "@/lib/supabase/client";

export type MemberOption = { id: string; name: string };

type Props = {
  familyId: string;
  members: MemberOption[];
  initial: RuleFormInput;
  /** Today in the family time zone, for date defaults. */
  today: string;
};

/**
 * Saves the custody rule as a new version (RF-04). The page keys this form by the current
 * version, so it starts over from the saved values after router.refresh().
 */
export function RuleForm({ familyId, members, initial, today }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<RuleFormInput>(initial);
  const [errors, setErrors] = useState<RuleFormErrors>({});
  const [submitError, setSubmitError] = useState("");
  const [busy, setBusy] = useState(false);
  const isChange = initial.validFrom !== null;

  function update(patch: Partial<RuleFormInput>) {
    setForm((f) => ({ ...f, ...patch }));
  }

  // Weekday and first handover date stay consistent: changing one moves the other.
  function onWeekday(weekday: number) {
    update({ handoverWeekday: weekday, startsOn: nextWeekdayOnOrAfter(today, weekday) });
  }
  function onStartsOn(startsOn: string) {
    let weekday = form.handoverWeekday;
    try {
      weekday = weekdayOf(startsOn);
    } catch {
      // Incomplete date while typing; validation reports it on submit.
    }
    update({ startsOn, handoverWeekday: weekday });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const found = validateRuleForm(form, members.map((m) => m.id));
    setErrors(found);
    setSubmitError("");
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    const { error } = await createClient().from("custody_rules").insert(toCustodyRuleInsert(familyId, form));
    setBusy(false);
    if (error) {
      setSubmitError(ruleSaveErrorMessage(error.code));
      return;
    }
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit}>
      <label htmlFor="firstMember">Quem fica com a criança na primeira semana</label>
      <select id="firstMember" value={form.firstMemberId} onChange={(e) => update({ firstMemberId: e.target.value })}>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      {errors.firstMemberId && <p role="alert">{errors.firstMemberId}</p>}

      <label htmlFor="weekday">Dia da troca</label>
      <select id="weekday" value={form.handoverWeekday} onChange={(e) => onWeekday(Number(e.target.value))}>
        {WEEKDAYS.map((name, i) => (
          <option key={name} value={i}>
            {name}
          </option>
        ))}
      </select>
      {errors.handoverWeekday && <p role="alert">{errors.handoverWeekday}</p>}

      <label htmlFor="handoverTime">Hora da troca</label>
      <input id="handoverTime" type="time" value={form.handoverTime} onChange={(e) => update({ handoverTime: e.target.value })} />
      {errors.handoverTime && <p role="alert">{errors.handoverTime}</p>}

      <label htmlFor="startsOn">Data da primeira troca</label>
      <input id="startsOn" type="date" value={form.startsOn} onChange={(e) => onStartsOn(e.target.value)} />
      {errors.startsOn && <p role="alert">{errors.startsOn}</p>}

      {isChange && (
        <>
          <label htmlFor="validFrom">Nova regra vale a partir de</label>
          <input
            id="validFrom"
            type="date"
            value={form.validFrom ?? ""}
            onChange={(e) => update({ validFrom: e.target.value })}
          />
          <p className="status">
            As semanas antes desta data continuam com a regra anterior, que segue valendo até a primeira troca da nova.
            A versão anterior fica guardada no histórico.
          </p>
          {errors.validFrom && <p role="alert">{errors.validFrom}</p>}
        </>
      )}

      <button type="submit" disabled={busy}>
        {busy ? "Salvando…" : isChange ? "Salvar nova versão" : "Salvar regra"}
      </button>
      {submitError && <p role="alert">{submitError}</p>}
    </form>
  );
}

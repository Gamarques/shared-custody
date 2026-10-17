"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { MEMBER_COLORS, validateOnboarding, type OnboardingErrors } from "@/lib/onboarding/validate";
import { createClient } from "@/lib/supabase/client";
import { ColorPicker } from "../_auth/ColorPicker";
import styles from "../_auth/auth.module.css";

export function OnboardingForm() {
  const router = useRouter();
  const [familyName, setFamilyName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [color, setColor] = useState<string>(MEMBER_COLORS[0]);
  const [errors, setErrors] = useState<OnboardingErrors>({});
  const [submitError, setSubmitError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const found = validateOnboarding({ familyName, displayName, color });
    setErrors(found);
    setSubmitError("");
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    const { error } = await createClient().rpc("create_family", {
      family_name: familyName.trim(),
      member_display_name: displayName.trim(),
      member_color: color,
    });
    if (error) {
      setBusy(false);
      setSubmitError("Não foi possível criar a família. Tente novamente.");
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor="familyName">Nome da família</label>
        <input id="familyName" value={familyName} onChange={(e) => setFamilyName(e.target.value)} maxLength={80} />
        {errors.familyName && <p role="alert">{errors.familyName}</p>}
      </div>

      <div className="field">
        <label htmlFor="displayName">Seu nome de exibição</label>
        <input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={40} />
        {errors.displayName && <p role="alert">{errors.displayName}</p>}
      </div>

      <div>
        <ColorPicker colors={MEMBER_COLORS} value={color} onChange={setColor} />
        {errors.color && <p role="alert">{errors.color}</p>}
      </div>

      <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
        {busy ? "Criando…" : "Criar família"}
      </button>
      {submitError && <p role="alert">{submitError}</p>}
    </form>
  );
}

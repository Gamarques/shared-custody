"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { inviteErrorMessage } from "@/lib/invites/invites";
import { MEMBER_COLORS, validateMemberProfile, type OnboardingErrors } from "@/lib/onboarding/validate";
import { createClient } from "@/lib/supabase/client";
import { ColorPicker } from "../../_auth/ColorPicker";
import styles from "../../_auth/auth.module.css";

export function AcceptInviteForm({ token, takenColors }: { token: string; takenColors: string[] }) {
  const router = useRouter();
  const taken = new Set(takenColors.map((c) => c.toLowerCase()));
  const colors = MEMBER_COLORS.filter((c) => !taken.has(c.toLowerCase()));
  const [displayName, setDisplayName] = useState("");
  const [color, setColor] = useState<string>(colors[0] ?? "");
  const [errors, setErrors] = useState<OnboardingErrors>({});
  const [submitError, setSubmitError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const found = validateMemberProfile({ displayName, color });
    setErrors(found);
    setSubmitError("");
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    const { error } = await createClient().rpc("accept_invite", {
      invite_token: token,
      member_display_name: displayName.trim(),
      member_color: color,
    });
    if (error) {
      setBusy(false);
      setSubmitError(inviteErrorMessage(error.code));
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor="displayName">O teu nome a mostrar</label>
        <input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={40} />
        {errors.displayName && <p role="alert">{errors.displayName}</p>}
      </div>

      <div>
        <ColorPicker colors={colors} value={color} onChange={setColor} />
        {errors.color && <p role="alert">{errors.color}</p>}
      </div>

      <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
        {busy ? "A entrar…" : "Entrar na família"}
      </button>
      {submitError && <p role="alert">{submitError}</p>}
    </form>
  );
}

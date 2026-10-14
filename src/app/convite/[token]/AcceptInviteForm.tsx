"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { inviteErrorMessage } from "@/lib/invites/invites";
import { MEMBER_COLORS, validateMemberProfile, type OnboardingErrors } from "@/lib/onboarding/validate";
import { createClient } from "@/lib/supabase/client";

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
    <form onSubmit={onSubmit}>
      <label htmlFor="displayName">Seu nome de exibição</label>
      <input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={40} />
      {errors.displayName && <p role="alert">{errors.displayName}</p>}

      <fieldset>
        <legend>Sua cor</legend>
        {colors.map((c) => (
          <label key={c} style={{ marginRight: "0.75rem" }}>
            <input type="radio" name="color" value={c} checked={color === c} onChange={() => setColor(c)} />
            <span
              aria-label={c}
              style={{ background: c, display: "inline-block", width: "1rem", height: "1rem", marginLeft: "0.25rem" }}
            />
          </label>
        ))}
      </fieldset>
      {errors.color && <p role="alert">{errors.color}</p>}

      <button type="submit" disabled={busy}>
        {busy ? "Entrando…" : "Entrar na família"}
      </button>
      {submitError && <p role="alert">{submitError}</p>}
    </form>
  );
}

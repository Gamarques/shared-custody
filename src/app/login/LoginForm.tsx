"use client";

import { useState, type FormEvent } from "react";
import { isValidEmail, safeNextPath } from "@/lib/auth/paths";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "../_components/Icon";
import styles from "../_auth/auth.module.css";

export function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isValidEmail(email)) {
      setState("error");
      setMessage("Informe um e-mail válido.");
      return;
    }
    setState("sending");
    const redirect = `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNextPath(next))}`;
    const { error } = await createClient().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirect },
    });
    if (error) {
      setState("error");
      setMessage("Não foi possível enviar o link. Tente novamente.");
    } else {
      setState("sent");
    }
  }

  if (state === "sent") {
    return (
      <p role="status" className={styles.sent}>
        <span className={styles.sentIcon}>
          <Icon name="check" size={16} />
        </span>
        <span>Link enviado para {email}. Abra o e-mail neste aparelho e toque no link para entrar.</span>
      </p>
    );
  }

  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor="email">E-mail</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      {state === "error" && <p role="alert">{message}</p>}
      <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={state === "sending"}>
        {state === "sending" ? "Enviando…" : "Enviar link de acesso"}
      </button>
    </form>
  );
}

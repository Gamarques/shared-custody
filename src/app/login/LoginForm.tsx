"use client";

import { useState, type FormEvent } from "react";
import { isValidEmail, safeNextPath } from "@/lib/auth/paths";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "../_components/Icon";
import styles from "../_auth/auth.module.css";

export type LoginMode = "link" | "password";

/** Shown for every failed password sign-in: it never says whether the e-mail or the password was wrong. */
export const PASSWORD_LOGIN_ERROR = "E-mail ou palavra-passe incorretos.";

type PasswordAuth = {
  signInWithPassword(credentials: { email: string; password: string }): PromiseLike<{ error: unknown }>;
};

/**
 * Password sign-in for accounts created in the Supabase dashboard (e.g. the platform admin).
 * There is no password sign-up anywhere in the app. Returns where to go next, or the error.
 */
export async function signInWithPassword(
  auth: PasswordAuth,
  email: string,
  password: string,
  next: string,
): Promise<{ ok: true; redirectTo: string } | { ok: false; error: string }> {
  if (!isValidEmail(email) || password === "") return { ok: false, error: PASSWORD_LOGIN_ERROR };
  try {
    const { error } = await auth.signInWithPassword({ email: email.trim(), password });
    if (error) return { ok: false, error: PASSWORD_LOGIN_ERROR };
  } catch {
    return { ok: false, error: PASSWORD_LOGIN_ERROR };
  }
  return { ok: true, redirectTo: safeNextPath(next) };
}

export function LoginForm({ next, initialMode = "link" }: { next: string; initialMode?: LoginMode }) {
  const [mode, setMode] = useState<LoginMode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  function switchMode(to: LoginMode) {
    setMode(to);
    setState("idle");
    setMessage("");
    setPassword("");
  }

  async function onSubmitLink(e: FormEvent) {
    e.preventDefault();
    if (!isValidEmail(email)) {
      setState("error");
      setMessage("Indica um e-mail válido.");
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
      setMessage("Não foi possível enviar a ligação. Tenta novamente.");
    } else {
      setState("sent");
    }
  }

  async function onSubmitPassword(e: FormEvent) {
    e.preventDefault();
    setState("sending");
    const result = await signInWithPassword(createClient().auth, email, password, next);
    if (!result.ok) {
      setState("error");
      setMessage(result.error);
      return;
    }
    // Full navigation, so the server renders the next page with the new session cookie.
    window.location.assign(result.redirectTo);
  }

  if (state === "sent") {
    return (
      <p role="status" className={styles.sent}>
        <span className={styles.sentIcon}>
          <Icon name="check" size={16} />
        </span>
        <span>Ligação enviada para {email}. Abre o e-mail neste dispositivo e toca na ligação para entrar.</span>
      </p>
    );
  }

  const emailField = (
    <div className="field">
      <label htmlFor="email">E-mail</label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete={mode === "password" ? "username" : "email"}
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
    </div>
  );

  if (mode === "password") {
    return (
      <>
        <form className={styles.form} onSubmit={onSubmitPassword} data-testid="password-login">
          {emailField}
          <div className="field">
            <label htmlFor="password">Palavra-passe</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {state === "error" && <p role="alert">{message}</p>}
          <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={state === "sending"}>
            {state === "sending" ? "A entrar…" : "Entrar"}
          </button>
        </form>
        <button type="button" className={`btn btn-ghost btn-block ${styles.modeToggle}`} onClick={() => switchMode("link")}>
          Receber ligação por e-mail
        </button>
      </>
    );
  }

  return (
    <>
      <form className={styles.form} onSubmit={onSubmitLink} data-testid="link-login">
        {emailField}
        {state === "error" && <p role="alert">{message}</p>}
        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={state === "sending"}>
          {state === "sending" ? "A enviar…" : "Enviar ligação de acesso"}
        </button>
      </form>
      <button type="button" className={`btn btn-ghost btn-block ${styles.modeToggle}`} onClick={() => switchMode("password")}>
        Entrar com palavra-passe
      </button>
    </>
  );
}

"use client";

import { useState, type FormEvent } from "react";
import { isValidEmail, safeNextPath } from "@/lib/auth/paths";
import { loginReady } from "@/lib/forms/ready";
import { inviteErrorMessage, inviteTokenFromPath } from "@/lib/invites/invites";
import { createClient } from "@/lib/supabase/client";
import { showFeedback, withFeedback } from "../_components/feedback-store";
import { Icon } from "../_components/Icon";
import styles from "../_auth/auth.module.css";

export type LoginMode = "link" | "password";

/** Shown for every failed password sign-in: it never says whether the e-mail or the password was wrong. */
export const PASSWORD_LOGIN_ERROR = "E-mail ou palavra-passe incorretos.";

/** Normal login with an e-mail that has no account: sign-up is only possible from an invite link. */
export const NO_ACCOUNT_ERROR =
  "Não encontrámos nenhuma conta com este e-mail. Para entrar pela primeira vez, abre a ligação de convite que recebeste.";
/** Login from an invite link, but Supabase Auth still refused to create the account (the hook). */
export const INVITE_SIGNUP_REJECTED_ERROR =
  "Não foi possível criar a conta com este convite. Abre de novo a ligação de convite ou pede uma nova.";
export const RATE_LIMIT_ERROR = "Demasiados pedidos. Espera uns minutos e tenta novamente.";
export const INVALID_EMAIL_ERROR = "Indica um e-mail válido.";
export const LINK_SEND_ERROR = "Não foi possível enviar a ligação. Tenta novamente.";
export const FROM_INVITE_NOTE = "Estás a entrar a partir de um convite.";

type AuthErrorLike = { code?: string; status?: number; message?: string } | null | undefined;

/** Supabase Auth error codes (@supabase/auth-js ErrorCode) that mean "no account, and none may be created". */
const NO_ACCOUNT_CODES = new Set(["otp_disabled", "signup_disabled", "user_not_found"]);
const RATE_LIMIT_CODES = new Set(["over_email_send_rate_limit", "over_request_rate_limit"]);
const INVALID_EMAIL_CODES = new Set(["email_address_invalid", "validation_failed"]);
/** Message of the error object returned by shared_custody.hook_before_user_created. */
const HOOK_REJECT_MESSAGE = "signup_requires_invite";

/**
 * Maps a signInWithOtp error to a fixed pt-PT message, by error code first, then by HTTP status.
 * Never shows Supabase's own text.
 */
export function magicLinkErrorMessage(error: AuthErrorLike, fromInvite: boolean): string {
  const code = error?.code;
  const rejected = fromInvite ? INVITE_SIGNUP_REJECTED_ERROR : NO_ACCOUNT_ERROR;
  if (code && NO_ACCOUNT_CODES.has(code)) return rejected;
  if (code && RATE_LIMIT_CODES.has(code)) return RATE_LIMIT_ERROR;
  if (code && INVALID_EMAIL_CODES.has(code)) return INVALID_EMAIL_ERROR;
  // The Before User Created hook answers 403 with our own fixed message; auth-js has no code for it.
  if (error?.status === 403 || error?.message === HOOK_REJECT_MESSAGE) return rejected;
  if (error?.status === 429) return RATE_LIMIT_ERROR;
  return LINK_SEND_ERROR;
}

export type MagicLinkClient = {
  /** shared_custody.claim_invite(invite_token, invite_email) */
  claimInvite(token: string, email: string): PromiseLike<{ error: { code?: string } | null }>;
  signInWithOtp(credentials: {
    email: string;
    options: { shouldCreateUser: boolean; emailRedirectTo: string };
  }): PromiseLike<{ error: AuthErrorLike }>;
};

/**
 * Asks for a magic link. A normal login never creates an account (shouldCreateUser false). When
 * `next` is an invite page, the e-mail is first claimed on that invite (the "Before User Created"
 * hook only lets claimed or invited e-mails create an account), and only then may the link create
 * the account. If the claim fails, no link is requested.
 */
export async function sendMagicLink(
  client: MagicLinkClient,
  email: string,
  next: string,
  origin: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isValidEmail(email)) return { ok: false, error: INVALID_EMAIL_ERROR };
  const cleanEmail = email.trim();
  const safeNext = safeNextPath(next);
  const inviteToken = inviteTokenFromPath(safeNext);
  try {
    if (inviteToken) {
      const { error } = await client.claimInvite(inviteToken, cleanEmail);
      if (error) return { ok: false, error: inviteErrorMessage(error.code) };
    }
    const { error } = await client.signInWithOtp({
      email: cleanEmail,
      options: {
        shouldCreateUser: inviteToken !== null,
        emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(safeNext)}`,
      },
    });
    if (error) return { ok: false, error: magicLinkErrorMessage(error, inviteToken !== null) };
  } catch {
    return { ok: false, error: LINK_SEND_ERROR };
  }
  return { ok: true };
}

type PasswordAuth = {
  signInWithPassword(credentials: { email: string; password: string }): PromiseLike<{ error: unknown }>;
};

/**
 * Password sign-in for accounts created in the Supabase dashboard (e.g. the platform admin), only
 * at /login?modo=palavra-passe (not linked from the UI). There is no password sign-up anywhere in
 * the app. Returns where to go next, or the error.
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

function browserMagicLinkClient(): MagicLinkClient {
  const supabase = createClient();
  return {
    claimInvite: (token, email) => supabase.rpc("claim_invite", { invite_token: token, invite_email: email }),
    signInWithOtp: (credentials) => supabase.auth.signInWithOtp(credentials),
  };
}

export function LoginForm({ next, mode = "link" }: { next: string; mode?: LoginMode }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");
  const fromInvite = mode === "link" && inviteTokenFromPath(safeNextPath(next)) !== null;

  async function onSubmitLink(e: FormEvent) {
    e.preventDefault();
    setState("sending");
    const result = await sendMagicLink(browserMagicLinkClient(), email, next, window.location.origin);
    if (!result.ok) {
      setState("error");
      setMessage(result.error);
      return;
    }
    setState("sent");
    showFeedback("ligacao-enviada");
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
    // Full navigation, so the server renders the next page with the new session cookie; that page
    // shows "Sessão iniciada." (the code travels in ?ok=).
    window.location.assign(withFeedback(result.redirectTo, "sessao-iniciada"));
  }

  if (state === "sent") {
    return (
      // Details of where the link went; the toast (role="status") announces the success.
      <p className={styles.sent} data-testid="link-sent">
        <span className={styles.sentIcon}>
          <Icon name="check" size={16} />
        </span>
        <span>Ligação enviada para {email}. Abre o e-mail neste dispositivo e toca na ligação para entrar.</span>
      </p>
    );
  }

  const ready = loginReady(mode, email, password);

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
        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={state === "sending" || !ready}>
          {state === "sending" ? "A entrar…" : "Entrar"}
        </button>
      </form>
    );
  }

  return (
    <>
      {fromInvite && (
        <p className={styles.note} data-testid="from-invite">
          {FROM_INVITE_NOTE}
        </p>
      )}
      <form className={styles.form} onSubmit={onSubmitLink} data-testid="link-login">
        {emailField}
        {state === "error" && <p role="alert">{message}</p>}
        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={state === "sending" || !ready}>
          {state === "sending" ? "A enviar…" : "Enviar ligação de acesso"}
        </button>
      </form>
    </>
  );
}

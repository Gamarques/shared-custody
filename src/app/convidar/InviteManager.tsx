"use client";

import { useState, type FormEvent } from "react";
import { isValidEmail } from "@/lib/auth/paths";
import { inviteErrorMessage, inviteMailto, inviteUrl } from "@/lib/invites/invites";
import { createClient } from "@/lib/supabase/client";
import { showFeedback, showFeedbackError } from "../_components/feedback-store";
import { Card } from "../_components/ui";
import { Icon } from "../_components/Icon";
import styles from "../_auth/auth.module.css";

export type PendingInvite = {
  token: string;
  email: string | null;
  expiresAt: string;
};

type Props = {
  origin: string;
  familyName: string;
  initialPending: PendingInvite | null;
};

export function InviteManager({ origin, familyName, initialPending }: Props) {
  const [pending, setPending] = useState<PendingInvite | null>(initialPending);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<"create" | "revoke" | null>(null);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (email.trim() && !isValidEmail(email)) {
      setError("Indica um e-mail válido ou deixa em branco.");
      return;
    }
    setBusy("create");
    const { data, error: rpcError } = await createClient().rpc("create_invite", {
      invite_email: email.trim() || null,
    });
    setBusy(null);
    const row = (data as { token: string; expires_at: string }[] | null)?.[0];
    if (rpcError || !row) {
      setError(inviteErrorMessage(rpcError?.code));
      return;
    }
    setCopied(false);
    setPending({
      token: row.token,
      email: email.trim().toLowerCase() || null,
      expiresAt: row.expires_at,
    });
    showFeedback("convite-criado");
  }

  async function onRevoke() {
    if (!pending) return;
    setBusy("revoke");
    setError("");
    const { error: delError } = await createClient().from("invites").delete().eq("token", pending.token);
    setBusy(null);
    if (delError) {
      setError(inviteErrorMessage(delError.code));
      return;
    }
    setPending(null);
    showFeedback("convite-cancelado");
  }

  async function onCopy(url: string) {
    try {
      // Missing outside secure contexts (plain http on a LAN address): the catch covers it.
      await navigator.clipboard.writeText(url);
    } catch {
      setCopied(false);
      showFeedbackError("Não foi possível copiar. Seleciona a ligação e copia-a à mão.");
      return;
    }
    setCopied(true);
    showFeedback("ligacao-copiada");
  }

  if (pending) {
    const url = inviteUrl(origin, pending.token);
    return (
      <Card title="Convite pendente">
        <div className={styles.meta}>
          <p>
            Envia esta ligação ao outro responsável. É válida até {new Date(pending.expiresAt).toLocaleDateString("pt-PT")} e só
            pode ser usada uma vez.
          </p>
          {pending.email && <p>Só {pending.email} poderá aceitar.</p>}
        </div>
        <div className={styles.linkBox}>
          <textarea readOnly rows={3} value={url} aria-label="Ligação do convite" onFocus={(e) => e.target.select()} />
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onCopy(url)}
          >
            <Icon name={copied ? "check" : "copy"} size={16} />
            {copied ? "Copiado" : "Copiar ligação"}
          </button>
        </div>
        <div className={styles.actions} style={{ marginTop: "var(--space-4)" }}>
          {pending.email && (
            <a className="btn btn-secondary" href={inviteMailto(pending.email, url, familyName)}>
              Enviar por e-mail
            </a>
          )}
          <button type="button" className="btn btn-secondary" onClick={onRevoke} disabled={busy !== null}>
            {busy === "revoke" ? "A cancelar…" : "Cancelar convite"}
          </button>
        </div>
        {error && <p role="alert">{error}</p>}
      </Card>
    );
  }

  return (
    <Card title="Novo convite">
      <form className={styles.form} onSubmit={onCreate}>
        <div className="field">
          <label htmlFor="inviteEmail">E-mail do outro responsável (opcional)</label>
          <input id="inviteEmail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <p className="field-hint">Se indicares o e-mail, só quem entrar com ele poderá aceitar o convite.</p>
        </div>
        {error && <p role="alert">{error}</p>}
        <div>
          <button type="submit" className="btn btn-primary btn-lg" disabled={busy !== null}>
            <Icon name="invite" size={18} />
            {busy === "create" ? "A criar…" : "Criar ligação de convite"}
          </button>
        </div>
      </form>
    </Card>
  );
}

"use client";

import { useState, type FormEvent } from "react";
import { isValidEmail } from "@/lib/auth/paths";
import { inviteErrorMessage, inviteMailto, inviteUrl } from "@/lib/invites/invites";
import { createClient } from "@/lib/supabase/client";

export type PendingInvite = { token: string; email: string | null; expiresAt: string };

type Props = { origin: string; familyName: string; initialPending: PendingInvite | null };

export function InviteManager({ origin, familyName, initialPending }: Props) {
  const [pending, setPending] = useState<PendingInvite | null>(initialPending);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (email.trim() && !isValidEmail(email)) {
      setError("Informe um e-mail válido ou deixe em branco.");
      return;
    }
    setBusy(true);
    const { data, error: rpcError } = await createClient().rpc("create_invite", {
      invite_email: email.trim() || null,
    });
    setBusy(false);
    const row = (data as { token: string; expires_at: string }[] | null)?.[0];
    if (rpcError || !row) {
      setError(inviteErrorMessage(rpcError?.code));
      return;
    }
    setCopied(false);
    setPending({ token: row.token, email: email.trim().toLowerCase() || null, expiresAt: row.expires_at });
  }

  async function onRevoke() {
    if (!pending) return;
    setBusy(true);
    const { error: delError } = await createClient().from("invites").delete().eq("token", pending.token);
    setBusy(false);
    if (delError) {
      setError(inviteErrorMessage(delError.code));
      return;
    }
    setPending(null);
  }

  if (pending) {
    const url = inviteUrl(origin, pending.token);
    return (
      <section>
        <p>Envie este link ao outro responsável. Ele vale até {new Date(pending.expiresAt).toLocaleDateString("pt")} e só pode ser usado uma vez.</p>
        {pending.email && <p>Só {pending.email} poderá aceitar.</p>}
        <input readOnly value={url} aria-label="Link do convite" onFocus={(e) => e.target.select()} style={{ width: "100%" }} />
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(url);
            setCopied(true);
          }}
        >
          {copied ? "Copiado" : "Copiar link"}
        </button>{" "}
        {pending.email && <a href={inviteMailto(pending.email, url, familyName)}>Enviar por e-mail</a>}{" "}
        <button type="button" onClick={onRevoke} disabled={busy}>
          Cancelar convite
        </button>
        {error && <p role="alert">{error}</p>}
      </section>
    );
  }

  return (
    <form onSubmit={onCreate}>
      <label htmlFor="inviteEmail">E-mail do outro responsável (opcional)</label>
      <input id="inviteEmail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <p>Se informar o e-mail, só quem entrar com ele poderá aceitar o convite.</p>
      <button type="submit" disabled={busy}>
        {busy ? "Gerando…" : "Gerar link de convite"}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

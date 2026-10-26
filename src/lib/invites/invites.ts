/** Invite tokens are 64 hex chars (see supabase/migrations/*_invites.sql). */
const TOKEN = /^[0-9a-f]{64}$/;

export function isValidInviteToken(token: string): boolean {
  return TOKEN.test(token);
}

export function inviteUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/convite/${token}`;
}

/** Opens the user's mail app with the link ready to send (no SMTP needed). */
export function inviteMailto(email: string, url: string, familyName: string): string {
  const subject = `Convite para a família ${familyName}`;
  const body = `Olá! Entra na família "${familyName}" na app Guarda Partilhada através desta ligação:\n\n${url}\n\nA ligação é válida durante 7 dias.`;
  return `mailto:${encodeURIComponent(email.trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export type InviteStatus = "valid" | "expired" | "accepted" | "full";

export const INVITE_STATUS_MESSAGES: Record<Exclude<InviteStatus, "valid">, string> = {
  expired: "Este convite expirou. Pede uma nova ligação.",
  accepted: "Este convite já foi usado.",
  full: "Esta família já tem os dois responsáveis.",
};

/** SQLSTATE codes raised by create_invite / accept_invite. */
const ERROR_MESSAGES: Record<string, string> = {
  IV001: "Convite não encontrado. Pode ter sido substituído por uma ligação mais recente.",
  IV002: INVITE_STATUS_MESSAGES.accepted,
  IV003: INVITE_STATUS_MESSAGES.expired,
  IV004: "Este convite foi enviado para outro e-mail. Entra com o e-mail convidado.",
  IV005: INVITE_STATUS_MESSAGES.full,
  "23514": INVITE_STATUS_MESSAGES.full,
  IV006: "Essa cor já é do outro responsável. Escolhe outra.",
  IV007: "Já fazes parte de uma família.",
  IV008: "Cria a tua família antes de convidar alguém.",
};

export function inviteErrorMessage(code: string | undefined): string {
  return (code && ERROR_MESSAGES[code]) || "Algo correu mal. Tenta novamente.";
}

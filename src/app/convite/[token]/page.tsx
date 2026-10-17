import Link from "next/link";
import { isSupabaseConfigured } from "@/lib/env";
import { INVITE_STATUS_MESSAGES, isValidInviteToken, type InviteStatus } from "@/lib/invites/invites";
import { createClient } from "@/lib/supabase/server";
import { AuthHeader } from "../../_auth/AuthHeader";
import { AcceptInviteForm } from "./AcceptInviteForm";

type InviteRow = {
  family_name: string;
  inviter_name: string | null;
  invited_email: string | null;
  status: InviteStatus;
  taken_colors: string[];
};

/** Invite landing page (RF-02). The proxy sends anonymous visitors to /login?next=/convite/<token>. */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isSupabaseConfigured()) {
    return <InviteShell>Supabase ainda não configurado (ver .env.example).</InviteShell>;
  }
  if (!isValidInviteToken(token)) return <InviteShell>Convite não encontrado.</InviteShell>;

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) {
    return (
      <InviteShell>
        <Link href={`/login?next=${encodeURIComponent(`/convite/${token}`)}`}>Entre para aceitar o convite</Link>
      </InviteShell>
    );
  }

  const { data: membership } = await supabase.from("members").select("id").eq("user_id", user.id).limit(1);
  if ((membership?.length ?? 0) > 0) {
    return (
      <InviteShell>
        Você já faz parte de uma família. <Link href="/">Ir para o início</Link>
      </InviteShell>
    );
  }

  const { data } = await supabase.rpc("get_invite", { invite_token: token });
  const invite = (data as InviteRow[] | null)?.[0];
  if (!invite) return <InviteShell>Convite não encontrado. Peça um novo link.</InviteShell>;
  if (invite.status !== "valid") return <InviteShell>{INVITE_STATUS_MESSAGES[invite.status]}</InviteShell>;

  const inviter = invite.inviter_name ?? "O outro responsável";
  return (
    <main>
      <AuthHeader icon="invite" title="Convite">
        <p>
          {inviter} convidou você para a família <strong>{invite.family_name}</strong>.
        </p>
      </AuthHeader>
      {invite.invited_email && invite.invited_email !== user.email?.toLowerCase() && (
        <p role="alert">
          Este convite foi enviado para {invite.invited_email}. Entre com esse e-mail para aceitar.
        </p>
      )}
      <AcceptInviteForm token={token} takenColors={invite.taken_colors} />
    </main>
  );
}

function InviteShell({ children }: { children: React.ReactNode }) {
  return (
    <main>
      <AuthHeader icon="info" title="Convite">
        <p>{children}</p>
      </AuthHeader>
    </main>
  );
}

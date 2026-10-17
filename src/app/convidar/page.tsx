import { headers } from "next/headers";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { Card, EmptyState, PageHeader } from "../_components/ui";
import styles from "./page.module.css";
import { InviteManager, type PendingInvite } from "./InviteManager";

// Per-user data: never prerender, even when built without Supabase env vars.
export const dynamic = "force-dynamic";

/** A member invites the other responsible adult by link (RF-02). */
export default async function InviteOtherPage() {
  if (!isSupabaseConfigured()) {
    return (
      <main>
        <PageHeader title="Convidar o outro responsável" />
        <p>Supabase ainda não configurado (ver .env.example).</p>
      </main>
    );
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id ?? "";
  const { data: me } = await supabase
    .from("members")
    .select("family_id, families(name)")
    .eq("user_id", userId)
    .maybeSingle();
  const familyId = (me as { family_id: string } | null)?.family_id ?? "";
  const familyName = (me as { families: { name: string } | null } | null)?.families?.name ?? "";

  const { count } = await supabase
    .from("members")
    .select("id", { count: "exact", head: true })
    .eq("family_id", familyId);
  const full = (count ?? 0) >= 2;

  let pending: PendingInvite | null = null;
  if (!full) {
    const { data } = await supabase
      .from("invites")
      .select("token, email, expires_at")
      .eq("family_id", familyId)
      .is("accepted_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1);
    const row = data?.[0];
    if (row) pending = { token: row.token, email: row.email, expiresAt: row.expires_at };
  }

  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;

  return (
    <main>
      <PageHeader title="Convidar o outro responsável" />
      <div className={styles.column}>
        {full ? (
          <Card>
            <EmptyState icon="check" title="A família já tem os dois responsáveis.">
              Não é possível convidar mais ninguém.
            </EmptyState>
          </Card>
        ) : (
          <InviteManager origin={origin} familyName={familyName} initialPending={pending} />
        )}
      </div>
    </main>
  );
}

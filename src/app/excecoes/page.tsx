import Link from "next/link";
import { isSupabaseConfigured } from "@/lib/env";
import {
  describeOverridePeriod,
  initialOverrideForm,
  splitOverrides,
  type CustodyOverrideRow,
} from "@/lib/custody/override-form";
import { latestRule, todayIn } from "@/lib/custody/rule-form";
import { createClient } from "@/lib/supabase/server";
import { Icon } from "../_components/Icon";
import { Badge, Card, EmptyState, PageHeader } from "../_components/ui";
import { DeleteOverrideButton } from "./DeleteOverrideButton";
import { OverrideForm } from "./OverrideForm";
import styles from "./page.module.css";

// Per-user data that depends on the clock: never prerender.
export const dynamic = "force-dynamic";

type MemberRow = { id: string; user_id: string; display_name: string; color: string };

function OverrideItem({
  o,
  timezone,
  members,
  canDelete,
}: {
  o: CustodyOverrideRow;
  timezone: string;
  members: MemberRow[];
  canDelete: boolean;
}) {
  const member = members.find((m) => m.id === o.member_id);
  const author = members.find((m) => m.user_id === o.created_by);
  return (
    <li data-testid="override">
      <span className={styles.swatch} style={{ background: member?.color }} />{" "}
      <span className={styles.text}>
        <strong>{o.reason}</strong>: com {member?.display_name ?? "responsável removido"} {describeOverridePeriod(o, timezone)}
        {author ? `. Criada por ${author.display_name}` : ""}.
      </span>{" "}
      {canDelete && <DeleteOverrideButton id={o.id} reason={o.reason} />}
    </li>
  );
}

/** Custody overrides (RF-07): swapped days, holidays and school breaks, each with a reason. */
export default async function OverridesPage() {
  if (!isSupabaseConfigured()) {
    return (
      <main>
        <PageHeader title="Exceções" />
        <p>Supabase ainda não configurado (ver .env.example).</p>
      </main>
    );
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id ?? "";
  const { data: me } = await supabase
    .from("members")
    .select("family_id, families(timezone)")
    .eq("user_id", userId)
    .maybeSingle();
  const family = me as { family_id: string; families: { timezone: string } | null } | null;
  if (!family) {
    return (
      <main>
        <PageHeader title="Exceções" />
        <p>Não foi possível carregar a família.</p>
      </main>
    );
  }
  const familyId = family.family_id;
  const timezone = family.families?.timezone ?? "Europe/Lisbon";

  const { data: memberData } = await supabase
    .from("members")
    .select("id, user_id, display_name, color")
    .eq("family_id", familyId)
    .order("created_at");
  const members = (memberData ?? []) as MemberRow[];

  const { data: ruleData } = await supabase
    .from("custody_rules")
    .select("handover_time, created_at")
    .eq("family_id", familyId)
    .order("created_at", { ascending: false });
  const rule = latestRule((ruleData ?? []) as { handover_time: string; created_at: string }[]);

  const { data: overrideData } = await supabase
    .from("custody_overrides")
    .select("id, starts_at, ends_at, member_id, reason, created_at, created_by")
    .eq("family_id", familyId)
    .order("starts_at", { ascending: false });
  const { upcoming, past } = splitOverrides((overrideData ?? []) as CustodyOverrideRow[], Date.now());

  const today = todayIn(timezone);
  const memberIds = members.map((m) => m.id);

  return (
    <main className={`page-wide ${styles.page}`}>
      <PageHeader
        title="Exceções"
        subtitle={`Uma exceção muda com quem a criança fica num período (troca de dias, férias, feriado) e prevalece sobre a regra semanal. Se duas exceções se sobrepõem, vale a criada por último. Datas e horas no fuso ${timezone}.`}
        actions={
          <Link className="btn btn-secondary" href="/calendario">
            <Icon name="calendar" size={18} />
            Ver no calendário
          </Link>
        }
      />

      <div className={styles.layout}>
        <Card
          className={styles.listCard}
          title="Próximas e em curso"
          action={upcoming.length > 0 ? <Badge tone="accent">{upcoming.length}</Badge> : undefined}
        >
          {upcoming.length > 0 ? (
            <ul className={styles.list} data-testid="upcoming-overrides">
              {upcoming.map((o) => (
                <OverrideItem key={o.id} o={o} timezone={timezone} members={members} canDelete />
              ))}
            </ul>
          ) : (
            <EmptyState icon="exception" title="Nenhuma exceção prevista." />
          )}
        </Card>

        <Card className={styles.formCard} title="Nova exceção">
          <OverrideForm
            familyId={familyId}
            timezone={timezone}
            members={members.map((m) => ({ id: m.id, name: m.display_name }))}
            initial={initialOverrideForm(today, rule?.handover_time ?? null, memberIds)}
          />
        </Card>

        {past.length > 0 && (
          <details className={`card ${styles.past}`}>
            <summary>Exceções passadas ({past.length})</summary>
            <ul className={styles.list} data-testid="past-overrides">
              {past.map((o) => (
                <OverrideItem key={o.id} o={o} timezone={timezone} members={members} canDelete={false} />
              ))}
            </ul>
          </details>
        )}
      </div>
    </main>
  );
}

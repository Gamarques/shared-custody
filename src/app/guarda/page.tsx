import { isSupabaseConfigured } from "@/lib/env";
import {
  describeRule,
  formatDate,
  initialRuleForm,
  latestRule,
  todayIn,
  type CustodyRuleRow,
} from "@/lib/custody/rule-form";
import { createClient } from "@/lib/supabase/server";
import { Icon } from "../_components/Icon";
import { Card, EmptyState, PageHeader } from "../_components/ui";
import styles from "./page.module.css";
import { RuleForm } from "./RuleForm";

// Per-user data: never prerender, even when built without Supabase env vars.
export const dynamic = "force-dynamic";

type MemberRow = { id: string; user_id: string; display_name: string };

/** Custody rule configuration (RF-04): saving creates a new version; old ones are kept. */
export default async function CustodyRulePage() {
  if (!isSupabaseConfigured()) {
    return (
      <main>
        <PageHeader title="Regra de guarda" />
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
  const familyId = (me as { family_id: string } | null)?.family_id ?? "";
  const timezone = (me as { families: { timezone: string } | null } | null)?.families?.timezone ?? "Europe/Lisbon";

  const { data: memberData } = await supabase
    .from("members")
    .select("id, user_id, display_name")
    .eq("family_id", familyId)
    .order("created_at");
  const members = (memberData ?? []) as MemberRow[];
  const memberNames = Object.fromEntries(members.map((m) => [m.id, m.display_name]));
  const userNames = Object.fromEntries(members.map((m) => [m.user_id, m.display_name]));

  const { data: ruleData } = await supabase
    .from("custody_rules")
    .select("id, starts_on, first_member_id, handover_weekday, handover_time, valid_from, valid_to, created_at, created_by")
    .eq("family_id", familyId)
    .order("created_at", { ascending: false });
  const versions = (ruleData ?? []) as CustodyRuleRow[];
  const current = latestRule(versions);

  const today = todayIn(timezone);
  const initial = initialRuleForm(current, members.map((m) => m.id), today);

  return (
    <main className="page-wide">
      <PageHeader
        title="Regra de guarda"
        subtitle={`A guarda alterna toda semana. Na hora da troca, a criança passa para o outro responsável (fuso ${timezone}).`}
      />

      <div className={styles.layout}>
        <Card className={styles.current} title="Regra atual" eyebrow={current ? "Em vigor" : undefined}>
          {current ? (
            <div className={styles.currentBody}>
              <span className={styles.currentIcon}>
                <Icon name="rule" size={22} />
              </span>
              <p className={styles.currentText} data-testid="current-rule">
                {describeRule(current, memberNames)}.
              </p>
            </div>
          ) : (
            <EmptyState icon="rule" title="Nenhuma regra definida ainda." />
          )}
        </Card>

        <Card className={styles.formCard} title={current ? "Mudar a regra" : "Definir a regra"}>
          <RuleForm
            key={current?.id ?? "new"}
            familyId={familyId}
            members={members.map((m) => ({ id: m.id, name: m.display_name }))}
            initial={initial}
            today={today}
          />
        </Card>

        {versions.length > 0 && (
          <Card className={styles.historyCard} title="Histórico de versões">
            <ol className={styles.history} data-testid="rule-versions">
              {versions.map((v) => (
                <li key={v.id}>
                  {v.id === current?.id ? <strong>Atual: </strong> : null}
                  {describeRule(v, memberNames)}; vale a partir de {formatDate(v.valid_from)}
                  {v.valid_to ? ` até ${formatDate(v.valid_to)}` : ""}. Salva em{" "}
                  {new Date(v.created_at).toLocaleString("pt-PT", { timeZone: timezone, dateStyle: "short", timeStyle: "short" })}
                  {v.created_by && userNames[v.created_by] ? ` por ${userNames[v.created_by]}` : ""}.
                </li>
              ))}
            </ol>
          </Card>
        )}
      </div>
    </main>
  );
}

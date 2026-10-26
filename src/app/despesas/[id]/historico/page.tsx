import Link from "next/link";
import { isSupabaseConfigured } from "@/lib/env";
import { formatDate } from "@/lib/custody/rule-form";
import { buildHistory, type AuditRow } from "@/lib/expenses/expense-history";
import { formatCents } from "@/lib/expenses/money";
import { createClient } from "@/lib/supabase/server";
import { Badge, EmptyState, PageHeader } from "../../../_components/ui";
import { RowIcon, type RowIconName } from "../../RowIcons";
import styles from "../../despesas.module.css";

// Per-user data: never prerender.
export const dynamic = "force-dynamic";

type MemberRow = { id: string; user_id: string; display_name: string };
type ExpenseRow = { id: string; description: string; amount_cents: number; spent_on: string; deleted_at: string | null };

function BackLink() {
  return (
    <Link href="/despesas" className="btn btn-secondary">
      <RowIcon name="arrowLeft" size={16} />
      Voltar às despesas
    </Link>
  );
}

function Message({ text }: { text: string }) {
  return (
    <main>
      <PageHeader title="Histórico da despesa" actions={<BackLink />} />
      <div className="card">
        <p>{text}</p>
      </div>
    </main>
  );
}

/** Timeline marker of an entry, from its title (the audit action is not part of the item). */
function markerFor(title: string): { icon: RowIconName; tone: string } {
  if (title.startsWith("Criou")) return { icon: "plus", tone: "" };
  if (title.startsWith("Eliminou")) return { icon: "trash", tone: styles.nodeDelete };
  if (title.startsWith("Confirmou")) return { icon: "check", tone: "" };
  if (title.startsWith("Contestou")) return { icon: "alert", tone: styles.nodeDelete };
  return { icon: "edit", tone: styles.nodeUpdate };
}

/**
 * Who changed what and when in one expense (RF-12), newest first, from expense_audit (written
 * only by the expenses_audit trigger, RNF-03). Deleted expenses keep their history here.
 */
export default async function ExpenseHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return <Message text="Supabase ainda não configurado (ver .env.example)." />;

  const { id } = await params;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const { data: me } = await supabase
    .from("members")
    .select("id, family_id, families(timezone, currency)")
    .eq("user_id", userData.user?.id ?? "")
    .maybeSingle();
  const mine = me as { family_id: string; families: { timezone: string; currency: string } | null } | null;
  if (!mine?.families) return <Message text="Não foi possível carregar a família." />;
  const { timezone, currency } = mine.families;

  const { data: expenseData } = await supabase
    .from("expenses")
    .select("id, description, amount_cents, spent_on, deleted_at")
    .eq("id", id)
    .eq("family_id", mine.family_id)
    .maybeSingle();
  const expense = expenseData as ExpenseRow | null;
  if (!expense) return <Message text="Despesa não encontrada." />;

  const { data: memberData } = await supabase
    .from("members")
    .select("id, user_id, display_name")
    .eq("family_id", mine.family_id);
  const members = (memberData ?? []) as MemberRow[];

  const { data: auditData, error } = await supabase
    .from("expense_audit")
    .select("seq, action, changed_by, changed_at, old_data, new_data")
    .eq("expense_id", expense.id)
    .order("seq", { ascending: false });

  const items = buildHistory((auditData ?? []) as AuditRow[], {
    currency,
    timeZone: timezone,
    memberNames: Object.fromEntries(members.map((m) => [m.id, m.display_name])),
    userNames: Object.fromEntries(members.map((m) => [m.user_id, m.display_name])),
  });

  return (
    <main className={`page-wide ${styles.narrow}`}>
      <PageHeader
        title="Histórico da despesa"
        subtitle="Cada criação, alteração e eliminação fica registada aqui e não pode ser apagada."
        actions={<BackLink />}
      />

      <section className={`card ${styles.expenseCard}`}>
        <div className={styles.expenseText}>
          <p className={styles.expenseTitle}>{expense.description}</p>
          <p className={styles.expenseMeta}>
            <span>{formatDate(expense.spent_on)}</span>
            {expense.deleted_at && <Badge tone="danger">(eliminada)</Badge>}
          </p>
        </div>
        <span className={styles.expenseAmount}>{formatCents(expense.amount_cents, currency)}</span>
      </section>

      {error ? (
        <p role="alert">Não foi possível carregar o histórico.</p>
      ) : items.length === 0 ? (
        <div className="card">
          <EmptyState icon="clock" title="Nenhum registo." />
        </div>
      ) : (
        <section className={`card ${styles.timelineCard}`}>
          <ol data-testid="history" className={styles.timeline}>
            {items.map((item) => {
              const marker = markerFor(item.title);
              return (
                <li key={item.key} data-testid="history-entry" className={styles.entry}>
                  <span className={`${styles.node} ${marker.tone}`}>
                    <RowIcon name={marker.icon} size={16} />
                  </span>
                  <div className={styles.entryBody}>
                    <strong className={styles.entryTitle}>{item.title}</strong>
                    <span className={styles.who}>
                      {item.who}, {item.when}
                    </span>
                    {item.changes.length > 0 && (
                      <ul className={styles.changes}>
                        {item.changes.map((c) => (
                          <li key={c.label}>
                            {c.label}: {c.from === null ? c.to : `${c.from} → ${c.to}`}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </main>
  );
}

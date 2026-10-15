import Link from "next/link";
import { isSupabaseConfigured } from "@/lib/env";
import { formatDate } from "@/lib/custody/rule-form";
import { buildHistory, type AuditRow } from "@/lib/expenses/expense-history";
import { formatCents } from "@/lib/expenses/money";
import { createClient } from "@/lib/supabase/server";

// Per-user data: never prerender.
export const dynamic = "force-dynamic";

type MemberRow = { id: string; user_id: string; display_name: string };
type ExpenseRow = { id: string; description: string; amount_cents: number; spent_on: string; deleted_at: string | null };

function Message({ text }: { text: string }) {
  return (
    <main>
      <h1>Histórico da despesa</h1>
      <p>{text}</p>
      <p>
        <Link href="/despesas">Voltar às despesas</Link>
      </p>
    </main>
  );
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
    <main>
      <h1>Histórico da despesa</h1>
      <p>
        <strong>{expense.description}</strong> — {formatCents(expense.amount_cents, currency)} em{" "}
        {formatDate(expense.spent_on)}
        {expense.deleted_at && <> (excluída)</>}
      </p>
      <p>Cada criação, alteração e exclusão fica registrada aqui e não pode ser apagada.</p>

      {error ? (
        <p role="alert">Não foi possível carregar o histórico.</p>
      ) : items.length === 0 ? (
        <p>Nenhum registro.</p>
      ) : (
        <ol data-testid="history">
          {items.map((item) => (
            <li key={item.key} data-testid="history-entry">
              <strong>{item.title}</strong> — {item.who}, {item.when}
              {item.changes.length > 0 && (
                <ul>
                  {item.changes.map((c) => (
                    <li key={c.label}>
                      {c.label}: {c.from === null ? c.to : `${c.from} → ${c.to}`}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}

      <p>
        <Link href="/despesas">Voltar às despesas</Link>
      </p>
    </main>
  );
}

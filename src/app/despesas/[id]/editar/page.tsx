import Link from "next/link";
import { isSupabaseConfigured } from "@/lib/env";
import { todayIn } from "@/lib/custody/rule-form";
import { expenseToForm } from "@/lib/expenses/expense-form";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "../../../_components/ui";
import { RowIcon } from "../../RowIcons";
import { ExpenseForm } from "../../nova/ExpenseForm";
import styles from "../../despesas.module.css";

// Per-user data and today's date in the family zone: never prerender.
export const dynamic = "force-dynamic";

type ExpenseRow = {
  id: string;
  paid_by: string;
  amount_cents: number;
  spent_on: string;
  description: string;
  category: string;
  payer_share_bps: number;
  status: string;
  deleted_at: string | null;
};

function BackLink() {
  return (
    <Link href="/despesas" className="btn btn-ghost btn-lg">
      <RowIcon name="arrowLeft" size={16} />
      Voltar às despesas
    </Link>
  );
}

function Message({ text }: { text: string }) {
  return (
    <main>
      <PageHeader title="Editar despesa" />
      <div className="card">
        <p>{text}</p>
        <BackLink />
      </div>
    </main>
  );
}

/** Edit one expense (RF-17). Editing a decided expense sends it back to "pendente" (server rule). */
export default async function EditExpensePage({ params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return <Message text="Supabase ainda não configurado (ver .env.example)." />;

  const { id } = await params;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const { data: me } = await supabase
    .from("members")
    .select("id, family_id, families(timezone, currency, default_payer_share_bps)")
    .eq("user_id", userData.user?.id ?? "")
    .maybeSingle();
  const mine = me as {
    family_id: string;
    families: { timezone: string; currency: string; default_payer_share_bps: number } | null;
  } | null;
  if (!mine?.families) return <Message text="Não foi possível carregar a família." />;
  const family = mine.families;

  const { data: expenseData } = await supabase
    .from("expenses")
    .select("id, paid_by, amount_cents, spent_on, description, category, payer_share_bps, status, deleted_at")
    .eq("id", id)
    .eq("family_id", mine.family_id)
    .maybeSingle();
  const expense = expenseData as ExpenseRow | null;
  if (!expense || expense.deleted_at) return <Message text="Despesa não encontrada ou já excluída." />;

  const { data: memberData } = await supabase
    .from("members")
    .select("id, display_name")
    .eq("family_id", mine.family_id)
    .order("created_at");
  const members = ((memberData ?? []) as { id: string; display_name: string }[]).map((m) => ({
    id: m.id,
    name: m.display_name,
  }));

  return (
    <main className={`page-wide ${styles.narrow}`}>
      <PageHeader title="Editar despesa" />
      {expense.status !== "pending" && (
        <p data-testid="reset-warning" className={styles.notice}>
          <RowIcon name="alert" size={16} />
          <span>
            Esta despesa já foi {expense.status === "confirmed" ? "confirmada" : "contestada"}. Ao salvar, ela volta a
            pendente e o outro responsável decide de novo.
          </span>
        </p>
      )}
      <div className={styles.formCard}>
        <ExpenseForm
          familyId={mine.family_id}
          currency={family.currency}
          today={todayIn(family.timezone)}
          members={members}
          defaultShareBps={family.default_payer_share_bps}
          initial={expenseToForm(expense)}
          expenseId={expense.id}
          cancel={<BackLink />}
        />
      </div>
    </main>
  );
}

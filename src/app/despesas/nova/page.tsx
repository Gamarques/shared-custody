import Link from "next/link";
import { isSupabaseConfigured } from "@/lib/env";
import { initialExpenseForm } from "@/lib/expenses/expense-form";
import { formatBps } from "@/lib/expenses/money";
import { todayIn } from "@/lib/custody/rule-form";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "../../_components/ui";
import { RowIcon } from "../RowIcons";
import { DefaultShareForm } from "./DefaultShareForm";
import { ExpenseForm } from "./ExpenseForm";
import styles from "../despesas.module.css";

// Per-user data and today's date in the family zone: never prerender.
export const dynamic = "force-dynamic";

type FamilyRow = { timezone: string; currency: string; default_payer_share_bps: number };
type MemberRow = { id: string; display_name: string };

/** New expense (RF-08) with the payer's share prefilled from the family default (RF-09). */
export default async function NewExpensePage() {
  if (!isSupabaseConfigured()) {
    return (
      <main>
        <PageHeader title="Nova despesa" />
        <p>Supabase ainda não configurado (ver .env.example).</p>
      </main>
    );
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const { data: me } = await supabase
    .from("members")
    .select("id, family_id, families(timezone, currency, default_payer_share_bps)")
    .eq("user_id", userData.user?.id ?? "")
    .maybeSingle();
  const mine = me as { id: string; family_id: string; families: FamilyRow | null } | null;
  if (!mine?.families) {
    return (
      <main>
        <PageHeader title="Nova despesa" />
        <p>Não foi possível carregar a família.</p>
      </main>
    );
  }
  const family = mine.families;

  const { data: memberData } = await supabase
    .from("members")
    .select("id, display_name")
    .eq("family_id", mine.family_id)
    .order("created_at");
  const members = ((memberData ?? []) as MemberRow[]).map((m) => ({ id: m.id, name: m.display_name }));
  const defaultBps = family.default_payer_share_bps;
  const today = todayIn(family.timezone);

  return (
    <main className="page-wide">
      <PageHeader
        title="Nova despesa"
        subtitle={
          <>
            Valores em {family.currency}. O percentual é a parte que fica com quem pagou; o outro responsável fica com o
            restante. Padrão da família: {formatBps(defaultBps)}% para quem pagou.
          </>
        }
      />

      <div className={styles.formLayout}>
        <div className={styles.formCard}>
          <ExpenseForm
            familyId={mine.family_id}
            currency={family.currency}
            today={today}
            members={members}
            defaultShareBps={defaultBps}
            initial={initialExpenseForm(today, defaultBps, mine.id)}
            cancel={
              <Link href="/" className="btn btn-ghost btn-lg">
                <RowIcon name="arrowLeft" size={16} />
                Voltar
              </Link>
            }
          />
        </div>

        <aside className={styles.aside}>
          <section className={`card ${styles.asideCard}`}>
            <h2 className="card-title">Padrão da família</h2>
            <p className={styles.hint}>
              Percentual que vem preenchido em cada nova despesa. Mudar o padrão não altera as despesas já registradas.
            </p>
            <DefaultShareForm key={defaultBps} familyId={mine.family_id} defaultShareBps={defaultBps} />
          </section>
        </aside>
      </div>
    </main>
  );
}

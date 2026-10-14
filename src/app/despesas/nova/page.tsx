import Link from "next/link";
import { isSupabaseConfigured } from "@/lib/env";
import { initialExpenseForm } from "@/lib/expenses/expense-form";
import { formatBps } from "@/lib/expenses/money";
import { todayIn } from "@/lib/custody/rule-form";
import { createClient } from "@/lib/supabase/server";
import { DefaultShareForm } from "./DefaultShareForm";
import { ExpenseForm } from "./ExpenseForm";

// Per-user data and today's date in the family zone: never prerender.
export const dynamic = "force-dynamic";

type FamilyRow = { timezone: string; currency: string; default_payer_share_bps: number };
type MemberRow = { id: string; display_name: string };

/** New expense (RF-08) with the payer's share prefilled from the family default (RF-09). */
export default async function NewExpensePage() {
  if (!isSupabaseConfigured()) {
    return (
      <main>
        <h1>Nova despesa</h1>
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
        <h1>Nova despesa</h1>
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
    <main>
      <h1>Nova despesa</h1>
      <p>
        Valores em {family.currency}. O percentual é a parte que fica com quem pagou; o outro responsável fica com o
        restante. Padrão da família: {formatBps(defaultBps)}% para quem pagou.
      </p>

      <ExpenseForm
        familyId={mine.family_id}
        currency={family.currency}
        today={today}
        members={members}
        defaultShareBps={defaultBps}
        initial={initialExpenseForm(today, defaultBps, mine.id)}
      />

      <section>
        <h2>Padrão da família</h2>
        <p>
          Percentual que vem preenchido em cada nova despesa. Mudar o padrão não altera as despesas já registradas.
        </p>
        <DefaultShareForm key={defaultBps} familyId={mine.family_id} defaultShareBps={defaultBps} />
      </section>

      <p>
        <Link href="/">Voltar</Link>
      </p>
    </main>
  );
}

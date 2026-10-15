import Link from "next/link";
import { isSupabaseConfigured } from "@/lib/env";
import { currentMonth, formatMonth } from "@/lib/custody/calendar";
import { formatDate } from "@/lib/custody/rule-form";
import { categoryLabel, CATEGORIES } from "@/lib/expenses/expense-form";
import { ALL_MONTHS, monthDateRange, parseExpenseFilters, totalCents } from "@/lib/expenses/expense-list";
import { canDecide, STATUS_LABELS } from "@/lib/expenses/expense-decision";
import { formatBps, formatCents } from "@/lib/expenses/money";
import { createClient } from "@/lib/supabase/server";
import { DecisionButtons } from "./DecisionButtons";
import { DeleteExpenseButton } from "./DeleteExpenseButton";
import { ReceiptLink } from "./ReceiptLink";

// Per-user data that depends on the clock: never prerender.
export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
type MemberRow = { id: string; display_name: string };
type ExpenseRow = {
  id: string;
  paid_by: string;
  amount_cents: number;
  spent_on: string;
  description: string;
  category: string;
  payer_share_bps: number;
  status: string;
  receipt_path: string | null;
  dispute_comment: string | null;
};

/** Expense list (RF-10) filtered by month, category and payer, with the total of the filter. */
export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Params> }) {
  if (!isSupabaseConfigured()) {
    return (
      <main>
        <h1>Despesas</h1>
        <p>Supabase ainda não configurado (ver .env.example).</p>
      </main>
    );
  }

  const params = await searchParams;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const { data: me } = await supabase
    .from("members")
    .select("id, family_id, families(timezone, currency)")
    .eq("user_id", userData.user?.id ?? "")
    .maybeSingle();
  const mine = me as { id?: string; family_id: string; families: { timezone: string; currency: string } | null } | null;
  if (!mine?.families) {
    return (
      <main>
        <h1>Despesas</h1>
        <p>Não foi possível carregar a família.</p>
      </main>
    );
  }
  const { timezone, currency } = mine.families;

  const { data: memberData } = await supabase
    .from("members")
    .select("id, display_name")
    .eq("family_id", mine.family_id)
    .order("created_at");
  const members = (memberData ?? []) as MemberRow[];
  const names = Object.fromEntries(members.map((m) => [m.id, m.display_name]));

  const filters = parseExpenseFilters(
    params,
    formatMonth(currentMonth(Date.now(), timezone)),
    members.map((m) => m.id),
  );

  let query = supabase
    .from("expenses")
    .select("id, paid_by, amount_cents, spent_on, description, category, payer_share_bps, status, receipt_path, dispute_comment")
    .eq("family_id", mine.family_id)
    .is("deleted_at", null);
  if (filters.month) {
    const { from, to } = monthDateRange(filters.month);
    query = query.gte("spent_on", from).lt("spent_on", to);
  }
  if (filters.category) query = query.eq("category", filters.category);
  if (filters.paidBy) query = query.eq("paid_by", filters.paidBy);
  const { data, error } = await query.order("spent_on", { ascending: false }).order("created_at", { ascending: false });
  const rows = (data ?? []) as ExpenseRow[];

  return (
    <main>
      <h1>Despesas</h1>

      <form method="get" action="/despesas" data-testid="filters">
        <label>
          Mês
          <input type="month" name="mes" defaultValue={filters.month ?? ""} />
        </label>
        <label>
          Categoria
          <select name="categoria" defaultValue={filters.category ?? ""}>
            <option value="">Todas</option>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Quem pagou
          <select name="pagou" defaultValue={filters.paidBy ?? ""}>
            <option value="">Todos</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.display_name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Filtrar</button>
        <Link href={`/despesas?mes=${ALL_MONTHS}`}>Todos os meses</Link>
      </form>

      {error ? (
        <p role="alert">Não foi possível carregar as despesas.</p>
      ) : (
        <>
          <p data-testid="total">
            Total: <strong>{formatCents(totalCents(rows), currency)}</strong> em {rows.length}{" "}
            {rows.length === 1 ? "despesa" : "despesas"}
          </p>
          {rows.length === 0 ? (
            <p>Nenhuma despesa para este filtro.</p>
          ) : (
            <ul data-testid="expenses">
              {rows.map((e) => (
                <li key={e.id} data-testid="expense">
                  <strong>{e.description}</strong> — {formatCents(e.amount_cents, currency)}
                  <br />
                  {formatDate(e.spent_on)} · {categoryLabel(e.category)} · pago por {names[e.paid_by] ?? "?"} (
                  {formatBps(e.payer_share_bps)}%) · {STATUS_LABELS[e.status] ?? e.status}
                  {e.receipt_path && (
                    <>
                      {" "}
                      <ReceiptLink path={e.receipt_path} />
                    </>
                  )}
                  {e.status === "disputed" && e.dispute_comment && (
                    <p data-testid="dispute-comment">Motivo: {e.dispute_comment}</p>
                  )}
                  {canDecide(e, mine.id ?? null) && <DecisionButtons expenseId={e.id} />}
                  <Link href={`/despesas/${e.id}/editar`}>Editar</Link> <DeleteExpenseButton expenseId={e.id} />{" "}
                  <Link href={`/despesas/${e.id}/historico`}>Histórico</Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <p>
        <Link href="/despesas/nova">Nova despesa</Link>
      </p>
      <p>
        <Link href="/">Voltar</Link>
      </p>
    </main>
  );
}

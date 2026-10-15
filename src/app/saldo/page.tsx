import Link from "next/link";
import type { ReactNode } from "react";
import { isSupabaseConfigured } from "@/lib/env";
import { currentMonth, formatMonth } from "@/lib/custody/calendar";
import { formatDate } from "@/lib/custody/rule-form";
import { computeBalance, type Balance } from "@/lib/balance/balance";
import {
  adjacentMonths,
  countExpenses,
  describeDebt,
  describeIfAccepted,
  describePeriod,
  parseBalancePeriod,
  periodBounds,
} from "@/lib/balance/balance-view";
import { ALL_MONTHS } from "@/lib/expenses/expense-list";
import { formatCents, splitExpense } from "@/lib/expenses/money";
import { createClient } from "@/lib/supabase/server";

// Per-user data that depends on the clock: never prerender.
export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
type MemberRow = { id: string; display_name: string };
type ExpenseRow = {
  id: string;
  paid_by: string;
  amount_cents: number;
  payer_share_bps: number;
  status: string;
  spent_on: string;
  description: string;
  dispute_comment: string | null;
};
type SettlementRow = { from_member: string; to_member: string; amount_cents: number; settled_on: string };

function Shell({ children }: { children: ReactNode }) {
  return (
    <main>
      <h1>Saldo</h1>
      {children}
      <p>
        <Link href="/despesas">Despesas</Link>
      </p>
      <p>
        <Link href="/">Voltar</Link>
      </p>
    </main>
  );
}

/**
 * Balance of a period (RF-13): who owes whom on the pending and confirmed expenses, minus the
 * settlements, and a separate "em disputa" line with the disputed expenses (business rule 4).
 */
export default async function BalancePage({ searchParams }: { searchParams: Promise<Params> }) {
  if (!isSupabaseConfigured()) {
    return (
      <Shell>
        <p>Supabase ainda não configurado (ver .env.example).</p>
      </Shell>
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
      <Shell>
        <p>Não foi possível carregar a família.</p>
      </Shell>
    );
  }
  const { timezone, currency } = mine.families;

  const { period, invalidRange } = parseBalancePeriod(params, formatMonth(currentMonth(Date.now(), timezone)));
  const bounds = periodBounds(period);
  const adjacent = adjacentMonths(period);

  const filters = (
    <form method="get" action="/saldo" data-testid="period">
      <label>
        Mês
        <input type="month" name="mes" defaultValue={period.kind === "month" ? period.month : ""} />
      </label>
      <button type="submit">Ver mês</button>
      <Link href={`/saldo?mes=${ALL_MONTHS}`}>Todo o período</Link>
    </form>
  );
  const rangeForm = (
    <form method="get" action="/saldo" data-testid="range">
      <label>
        De
        <input type="date" name="de" defaultValue={period.kind === "range" ? period.start : ""} required />
      </label>
      <label>
        Até
        <input type="date" name="ate" defaultValue={period.kind === "range" ? period.end : ""} required />
      </label>
      <button type="submit">Ver intervalo</button>
    </form>
  );

  const { data: memberData } = await supabase
    .from("members")
    .select("id, display_name")
    .eq("family_id", mine.family_id)
    .order("created_at");
  const members = (memberData ?? []) as MemberRow[];
  const names = Object.fromEntries(members.map((m) => [m.id, m.display_name]));

  if (members.length < 2) {
    return (
      <Shell>
        <p>O saldo aparece quando o outro responsável entrar na família.</p>
        <p>
          <Link href="/convidar">Convidar o outro responsável</Link>
        </p>
      </Shell>
    );
  }
  const [a, b] = members;

  let expenseQuery = supabase
    .from("expenses")
    .select("id, paid_by, amount_cents, payer_share_bps, status, spent_on, description, dispute_comment")
    .eq("family_id", mine.family_id)
    .is("deleted_at", null);
  let settlementQuery = supabase
    .from("settlements")
    .select("from_member, to_member, amount_cents, settled_on")
    .eq("family_id", mine.family_id);
  if (bounds.from) {
    expenseQuery = expenseQuery.gte("spent_on", bounds.from);
    settlementQuery = settlementQuery.gte("settled_on", bounds.from);
  }
  if (bounds.to) {
    expenseQuery = expenseQuery.lt("spent_on", bounds.to);
    settlementQuery = settlementQuery.lt("settled_on", bounds.to);
  }
  const [expenseResult, settlementResult] = await Promise.all([
    expenseQuery.order("spent_on", { ascending: false }),
    settlementQuery.order("settled_on", { ascending: false }),
  ]);
  const expenses = (expenseResult.data ?? []) as ExpenseRow[];
  const settlements = (settlementResult.data ?? []) as SettlementRow[];

  let balance: Balance | null = null;
  if (!expenseResult.error && !settlementResult.error) {
    try {
      balance = computeBalance(a.id, b.id, expenses, settlements, bounds);
    } catch {
      balance = null; // a row that does not involve the two members: show no number rather than a wrong one
    }
  }
  const disputedRows = expenses.filter((e) => e.status === "disputed");
  const settledCents = settlements.reduce((sum, s) => sum + s.amount_cents, 0);

  return (
    <Shell>
      {filters}
      {rangeForm}
      {invalidRange && (
        <p role="status" data-testid="invalid-range">
          Intervalo inválido: mostrando o mês atual.
        </p>
      )}

      <h2 data-testid="period-label">{describePeriod(period)}</h2>
      {adjacent && (
        <p>
          <Link href={`/saldo?mes=${adjacent.prev}`}>‹ Anterior</Link> <Link href={`/saldo?mes=${adjacent.next}`}>Próximo ›</Link>
        </p>
      )}

      {!balance ? (
        <p role="alert">Não foi possível calcular o saldo.</p>
      ) : (
        <>
          <section data-testid="balance">
            <p className="balance-main">
              <strong>{describeDebt(balance, names, currency, "Ninguém deve nada neste período.")}</strong>
            </p>
            <p>
              {countExpenses(balance.expenseCount)} no saldo (pendentes e confirmadas)
              {settlements.length > 0 && (
                <>
                  , já descontados {settlements.length} {settlements.length === 1 ? "acerto" : "acertos"} (
                  {formatCents(settledCents, currency)})
                </>
              )}
              .
            </p>
          </section>

          <section data-testid="disputed">
            <h3>Em disputa</h3>
            {balance.disputed.count === 0 ? (
              <p>Nenhuma despesa em disputa neste período.</p>
            ) : (
              <>
                <p data-testid="disputed-total">
                  Fora do saldo: {countExpenses(balance.disputed.count)}.{" "}
                  {describeIfAccepted(balance.disputed, names, currency)}
                </p>
                <ul>
                  {disputedRows.map((e) => (
                    <li key={e.id} data-testid="disputed-expense">
                      {formatDate(e.spent_on)} · <strong>{e.description}</strong> — {formatCents(e.amount_cents, currency)}, pago
                      por {names[e.paid_by] ?? "?"}; parte de {names[e.paid_by === a.id ? b.id : a.id]}:{" "}
                      {formatCents(splitExpense(e.amount_cents, e.payer_share_bps).otherCents, currency)}.
                      {e.dispute_comment && <> Motivo: {e.dispute_comment}</>}{" "}
                      <Link href={`/despesas/${e.id}/historico`}>Histórico</Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </>
      )}
    </Shell>
  );
}

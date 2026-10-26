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
import { centsToInput } from "@/lib/expenses/money";
import { todayIn } from "@/lib/custody/rule-form";
import { createClient } from "@/lib/supabase/server";
import { SettlementForm } from "./SettlementForm";
import { Icon } from "../_components/Icon";
import { Badge, Card, EmptyState, PageHeader, StatCard } from "../_components/ui";
import styles from "./saldo.module.css";

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
type SettlementRow = {
  id?: string;
  from_member: string;
  to_member: string;
  amount_cents: number;
  settled_on: string;
  note?: string | null;
};

function Shell({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <main className="page-wide">
      <PageHeader title="Saldo" subtitle="Divisão das despesas, acertos de contas e disputas." actions={actions} />
      {children}
      <div className={styles.footer}>
        <Link href="/despesas" className="btn btn-secondary">
          Despesas
        </Link>
        <Link href="/" className="btn btn-secondary">
          Voltar
        </Link>
      </div>
    </main>
  );
}

function Avatar({ name, slot }: { name: string; slot: "a" | "b" }) {
  return (
    <span className={`${styles.avatar} ${slot === "a" ? styles.avatarA : styles.avatarB}`} aria-hidden="true">
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
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
        <Card>
          <EmptyState icon="info" title="Supabase ainda não configurado (ver .env.example)." />
        </Card>
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
        <Card>
          <EmptyState icon="info" title="Não foi possível carregar a família." />
        </Card>
      </Shell>
    );
  }
  const { timezone, currency } = mine.families;

  const { period, invalidRange } = parseBalancePeriod(params, formatMonth(currentMonth(Date.now(), timezone)));
  const bounds = periodBounds(period);
  const adjacent = adjacentMonths(period);

  const filters = (
    <form method="get" action="/saldo" data-testid="period" className={styles.filter}>
      <label className={styles.field}>
        <span>Mês</span>
        <input type="month" name="mes" defaultValue={period.kind === "month" ? period.month : ""} />
      </label>
      <div className={styles.filterActions}>
        <button type="submit" className="btn btn-secondary btn-sm">
          Ver mês
        </button>
        <Link href={`/saldo?mes=${ALL_MONTHS}`} className="btn btn-secondary btn-sm">
          Todo o período
        </Link>
      </div>
    </form>
  );
  const rangeForm = (
    <form method="get" action="/saldo" data-testid="range" className={styles.filter}>
      <div className={styles.fieldPair}>
        <label className={styles.field}>
          <span>De</span>
          <input type="date" name="de" defaultValue={period.kind === "range" ? period.start : ""} required />
        </label>
        <label className={styles.field}>
          <span>Até</span>
          <input type="date" name="ate" defaultValue={period.kind === "range" ? period.end : ""} required />
        </label>
      </div>
      <div className={styles.filterActions}>
        <button type="submit" className="btn btn-secondary btn-sm">
          Ver intervalo
        </button>
      </div>
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
        <Card>
          <EmptyState
            icon="invite"
            title="O saldo aparece quando o outro responsável entrar na família."
            action={
              <Link href="/convidar" className="btn btn-primary">
                Convidar o outro responsável
              </Link>
            }
          />
        </Card>
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
    .select("id, from_member, to_member, amount_cents, settled_on, note")
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

  const today = todayIn(timezone);
  // Prefill: the debtor pays the creditor the whole debt; with no debt, the caller pays.
  const debtorId = balance?.debtor ?? mine.id ?? a.id;
  const settlementInitial = {
    amount: balance && balance.amountCents > 0 ? centsToInput(balance.amountCents) : "",
    settledOn: today,
    fromMember: debtorId,
    note: "",
  };

  const counted = expenses.filter((e) => e.status !== "disputed");
  const totalCents = counted.reduce((sum, e) => sum + e.amount_cents, 0);
  const pending = counted.filter((e) => e.status === "pending");
  const pendingCents = pending.reduce((sum, e) => sum + e.amount_cents, 0);
  const paidBy = [a, b].map((m) => ({
    member: m,
    cents: counted.filter((e) => e.paid_by === m.id).reduce((sum, e) => sum + e.amount_cents, 0),
  }));
  const slotOf = (id: string): "a" | "b" => (id === a.id ? "a" : "b");

  const stepper = (
    <div className={styles.stepper}>
      {adjacent && (
        <Link href={`/saldo?mes=${adjacent.prev}`} className="btn btn-secondary btn-icon" aria-label="Anterior">
          <Icon name="chevronRight" size={18} className={styles.flip} />
        </Link>
      )}
      <h2 data-testid="period-label" className={styles.periodLabel}>
        {describePeriod(period)}
      </h2>
      {adjacent && (
        <Link href={`/saldo?mes=${adjacent.next}`} className="btn btn-secondary btn-icon" aria-label="Próximo">
          <Icon name="chevronRight" size={18} />
        </Link>
      )}
    </div>
  );

  return (
    <Shell actions={stepper}>
      {invalidRange && (
        <p role="status" data-testid="invalid-range" className={styles.notice}>
          <Icon name="info" size={18} />
          Intervalo inválido: a mostrar o mês atual.
        </p>
      )}

      <div className={styles.layout}>
        <div className={styles.main}>
          {!balance ? (
            <p role="alert" className={styles.alert}>
              <Icon name="info" size={18} />
              Não foi possível calcular o saldo.
            </p>
          ) : (
            <>
              <section data-testid="balance" className={styles.hero}>
                <p className={styles.heroEyebrow}>Saldo do período</p>
                <div className={styles.heroParties}>
                  {balance.debtor && balance.creditor ? (
                    <>
                      <span className={styles.party}>
                        <Avatar name={names[balance.debtor] ?? "?"} slot={slotOf(balance.debtor)} />
                        {names[balance.debtor] ?? "?"}
                      </span>
                      <Icon name="chevronRight" size={18} className={styles.heroArrow} />
                      <span className={styles.party}>
                        <Avatar name={names[balance.creditor] ?? "?"} slot={slotOf(balance.creditor)} />
                        {names[balance.creditor] ?? "?"}
                      </span>
                    </>
                  ) : (
                    <Badge tone="success">Contas em dia</Badge>
                  )}
                </div>
                <p className={styles.heroAmount} aria-hidden="true">
                  {formatCents(balance.amountCents, currency)}
                </p>
                <p className={`balance-main ${styles.heroMain}`}>
                  <strong>{describeDebt(balance, names, currency, "Ninguém deve nada neste período.")}</strong>
                </p>
                <p className={styles.heroNote}>
                  {countExpenses(balance.expenseCount)} no saldo (pendentes e confirmadas)
                  {settlements.length > 0 && (
                    <>
                      , já descontados {settlements.length} {settlements.length === 1 ? "acerto" : "acertos"} (
                      {formatCents(settledCents, currency)})
                    </>
                  )}
                  .
                </p>
                <ul className={styles.shares} aria-label="Quanto cada responsável pagou">
                  {paidBy.map(({ member, cents }) => (
                    <li key={member.id} className={styles.share}>
                      <div className={styles.shareHead}>
                        <span>{member.display_name}</span>
                        <span className={styles.shareValue}>{formatCents(cents, currency)}</span>
                      </div>
                      <div className={styles.track}>
                        <div
                          className={`${styles.fill} ${slotOf(member.id) === "a" ? styles.fillA : styles.fillB}`}
                          style={{ width: `${totalCents > 0 ? Math.round((cents / totalCents) * 100) : 0}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </section>

              <div className={styles.stats}>
                <StatCard
                  label="Total"
                  icon="receipt"
                  value={formatCents(totalCents, currency)}
                  hint={countExpenses(counted.length)}
                />
                <StatCard
                  label="Pendentes"
                  icon="clock"
                  value={formatCents(pendingCents, currency)}
                  hint={countExpenses(pending.length)}
                />
                <StatCard
                  label="Acertado"
                  icon="check"
                  value={formatCents(settledCents, currency)}
                  hint={`${settlements.length} ${settlements.length === 1 ? "acerto" : "acertos"}`}
                  tone={settlements.length > 0 ? "up" : undefined}
                />
              </div>

              <section data-testid="settlements" className={`card card-flush ${styles.panel}`}>
                <div className={styles.panelHead}>
                  <h3>Acertos de contas</h3>
                </div>
                {settlements.length === 0 ? (
                  <EmptyState icon="wallet" title="Nenhum acerto neste período." />
                ) : (
                  <ul className={styles.rows}>
                    {settlements.map((s, i) => (
                      <li key={s.id ?? i} data-testid="settlement" className={styles.row}>
                        <span className={styles.rowIcon}>
                          <Icon name="swap" size={18} />
                        </span>
                        <div className={styles.rowMain}>
                          <span className={styles.rowTitle}>
                            {names[s.from_member] ?? "?"} pagou a {names[s.to_member] ?? "?"}
                          </span>
                          <span className={styles.rowMeta}>
                            {formatDate(s.settled_on)}
                            {s.note && <> · {s.note}</>}
                          </span>
                        </div>
                        <strong className={styles.rowValue}>{formatCents(s.amount_cents, currency)}</strong>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section data-testid="disputed" className={`card card-flush ${styles.panel} ${styles.disputed}`}>
                <div className={styles.panelHead}>
                  <h3>Em disputa</h3>
                  {balance.disputed.count > 0 && <Badge tone="danger">{String(balance.disputed.count)}</Badge>}
                </div>
                {balance.disputed.count === 0 ? (
                  <EmptyState icon="check" title="Nenhuma despesa em disputa neste período." />
                ) : (
                  <>
                    <p data-testid="disputed-total" className={styles.disputedTotal}>
                      Fora do saldo: {countExpenses(balance.disputed.count)}.{" "}
                      {describeIfAccepted(balance.disputed, names, currency)}
                    </p>
                    <ul className={styles.rows}>
                      {disputedRows.map((e) => (
                        <li key={e.id} data-testid="disputed-expense" className={styles.row}>
                          <div className={styles.rowMain}>
                            <span className={styles.rowTitle}>
                              {formatDate(e.spent_on)} · <strong>{e.description}</strong>
                            </span>
                            <span className={styles.rowMeta}>
                              {`${formatCents(e.amount_cents, currency)}, pago por ${names[e.paid_by] ?? "?"}; parte de ${names[e.paid_by === a.id ? b.id : a.id]}: ${formatCents(splitExpense(e.amount_cents, e.payer_share_bps).otherCents, currency)}.`}
                              {e.dispute_comment && ` Motivo: ${e.dispute_comment}`}
                            </span>
                          </div>
                          <Link href={`/despesas/${e.id}/historico`} className="btn btn-secondary btn-sm">
                            Histórico
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </section>
            </>
          )}
        </div>

        <aside className={styles.aside}>
          {balance && (
            <Card eyebrow="Novo" title="Registar acerto">
              <SettlementForm familyId={mine.family_id} members={members} initial={settlementInitial} today={today} />
            </Card>
          )}
          <Card eyebrow="Filtrar" title="Período">
            {filters}
            <hr className={styles.divider} />
            {rangeForm}
          </Card>
        </aside>
      </div>
    </Shell>
  );
}

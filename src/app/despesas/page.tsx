import Link from "next/link";
import { isSupabaseConfigured } from "@/lib/env";
import { currentMonth, formatMonth, MONTHS, parseMonth } from "@/lib/custody/calendar";
import { formatDate } from "@/lib/custody/rule-form";
import { categoryLabel, CATEGORIES } from "@/lib/expenses/expense-form";
import { ALL_MONTHS, monthDateRange, parseExpenseFilters, totalCents } from "@/lib/expenses/expense-list";
import { canDecide, STATUS_LABELS } from "@/lib/expenses/expense-decision";
import { formatBps, formatCents } from "@/lib/expenses/money";
import { createClient } from "@/lib/supabase/server";
import { Badge, EmptyState, PageHeader, StatCard, type BadgeTone } from "../_components/ui";
import { DecisionButtons } from "./DecisionButtons";
import { DeleteExpenseButton } from "./DeleteExpenseButton";
import { ReceiptLink } from "./ReceiptLink";
import { RowIcon } from "./RowIcons";
import styles from "./despesas.module.css";

const BADGE: Record<string, BadgeTone> = {
  pending: "warning",
  confirmed: "success",
  disputed: "danger",
};

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
        <PageHeader title="Despesas" />
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
        <PageHeader title="Despesas" />
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

  const ym = parseMonth(filters.month);
  const period = ym ? `${MONTHS[ym.month - 1]} de ${ym.year}` : "Todos os meses";
  const pending = rows.filter((e) => e.status === "pending");
  const disputed = rows.filter((e) => e.status === "disputed");
  const count = (n: number) => `${n} ${n === 1 ? "despesa" : "despesas"}`;

  return (
    <main className="page-wide">
      <PageHeader
        title="Despesas"
        subtitle={period}
        actions={
          <>
            {filters.month && (
              <a href={`/despesas/exportar?mes=${filters.month}`} download className="btn btn-secondary">
                <RowIcon name="download" size={16} />
                Exportar mês em CSV
              </a>
            )}
            <Link href="/despesas/nova" className="btn btn-primary">
              <RowIcon name="plus" size={16} />
              Nova despesa
            </Link>
          </>
        }
      />

      {!error && (
        <section className={styles.stats} aria-label={period}>
          <StatCard
            label={ym ? "Total do mês" : "Total"}
            value={formatCents(totalCents(rows), currency)}
            hint={count(rows.length)}
            icon="wallet"
          />
          <StatCard
            label="Pendentes"
            value={pending.length}
            hint={pending.length ? formatCents(totalCents(pending), currency) : "Nada a decidir"}
            tone={pending.length ? "down" : undefined}
            icon="clock"
          />
          <StatCard
            label="Contestadas"
            value={disputed.length}
            hint={disputed.length ? formatCents(totalCents(disputed), currency) : "Nenhuma contestação"}
            tone={disputed.length ? "down" : undefined}
            icon="info"
          />
        </section>
      )}

      <div className={styles.panel}>
        <form method="get" action="/despesas" data-testid="filters" className={styles.filters}>
          <label className={styles.fieldMonth}>
            <span>Mês</span>
            <input type="month" name="mes" defaultValue={filters.month ?? ""} />
          </label>
          <label>
            <span>Categoria</span>
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
            <span>Quem pagou</span>
            <select name="pagou" defaultValue={filters.paidBy ?? ""}>
              <option value="">Todos</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.filterActions}>
            <button type="submit" className="btn btn-primary">
              <RowIcon name="filter" size={16} />
              Filtrar
            </button>
            <Link href={`/despesas?mes=${ALL_MONTHS}`} className="btn btn-secondary">
              Todos os meses
            </Link>
          </div>
        </form>

        {error ? (
          <p role="alert" className={styles.loadError}>
            Não foi possível carregar as despesas.
          </p>
        ) : (
          <>
            <p data-testid="total" className={styles.summary}>
              <span>
                Total: <strong>{formatCents(totalCents(rows), currency)}</strong>
              </span>
              <span>
                em {rows.length} {rows.length === 1 ? "despesa" : "despesas"}
              </span>
            </p>
            {rows.length === 0 ? (
              <div className={styles.empty}>
                <EmptyState
                  icon="receipt"
                  title="Nenhuma despesa para este filtro."
                  action={
                    <div className={styles.emptyActions}>
                      <Link href="/despesas/nova" className="btn btn-primary">
                        <RowIcon name="plus" size={16} />
                        Nova despesa
                      </Link>
                      <Link href={`/despesas?mes=${ALL_MONTHS}`} className="btn btn-secondary">
                        Todos os meses
                      </Link>
                    </div>
                  }
                />
              </div>
            ) : (
              <table data-testid="expenses" className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Descrição</th>
                    <th scope="col">Data</th>
                    <th scope="col">Quem pagou</th>
                    <th scope="col">Estado</th>
                    <th scope="col" className={styles.num}>
                      Valor
                    </th>
                    <th scope="col">
                      <span className="visually-hidden">Ações</span>
                    </th>
                  </tr>
                </thead>
                {rows.map((e) => {
                  const decide = canDecide(e, mine.id ?? null);
                  const reason = e.status === "disputed" ? e.dispute_comment : null;
                  return (
                    <tbody key={e.id} data-testid="expense">
                      <tr className={styles.row}>
                        <td className={styles.cTitle}>
                          <span className={styles.title}>{e.description}</span>
                          <span className={styles.sub}>
                            <span className={styles.categoryPill}>{categoryLabel(e.category)}</span>
                            {e.receipt_path && <ReceiptLink path={e.receipt_path} />}
                          </span>
                        </td>
                        <td className={`${styles.cDate} ${styles.date}`}>{formatDate(e.spent_on)}</td>
                        <td className={styles.cPayer}>
                          <span className={styles.payer}>
                            {names[e.paid_by] ?? "?"}
                            <span className={styles.share}>({formatBps(e.payer_share_bps)}%)</span>
                          </span>
                        </td>
                        <td className={styles.cStatus}>
                          <Badge tone={BADGE[e.status] ?? "neutral"}>{STATUS_LABELS[e.status] ?? e.status}</Badge>
                        </td>
                        <td className={`${styles.cAmount} ${styles.num} ${styles.amount}`}>
                          {formatCents(e.amount_cents, currency)}
                        </td>
                        <td className={styles.cActions}>
                          <div className={styles.actions}>
                            <Link
                              href={`/despesas/${e.id}/historico`}
                              className="btn btn-ghost btn-icon btn-sm"
                              aria-label="Histórico"
                              title="Histórico"
                            >
                              <RowIcon name="history" />
                            </Link>
                            <Link
                              href={`/despesas/${e.id}/editar`}
                              className="btn btn-ghost btn-icon btn-sm"
                              aria-label="Editar"
                              title="Editar"
                            >
                              <RowIcon name="edit" />
                            </Link>
                            <DeleteExpenseButton expenseId={e.id} />
                          </div>
                        </td>
                      </tr>
                      {(reason || decide) && (
                        <tr className={styles.extra}>
                          <td colSpan={6}>
                            <div className={styles.extraBody}>
                              {reason && (
                                <p data-testid="dispute-comment" className={styles.dispute}>
                                  <RowIcon name="alert" size={16} />
                                  <span>Motivo: {reason}</span>
                                </p>
                              )}
                              {decide && <DecisionButtons expenseId={e.id} />}
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  );
                })}
              </table>
            )}
          </>
        )}
      </div>
    </main>
  );
}

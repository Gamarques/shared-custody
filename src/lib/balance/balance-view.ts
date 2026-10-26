import { addMonths, formatMonth, MONTHS, parseMonth } from "@/lib/custody/calendar";
import { formatDate } from "@/lib/custody/rule-form";
import { ALL_MONTHS, monthDateRange } from "@/lib/expenses/expense-list";
import { formatCents } from "@/lib/expenses/money";
import type { BalancePeriod, Debt } from "./balance";

/**
 * Balance screen (RF-13, T-20): which period to show, read from the query string, and the
 * sentences that say who owes whom. The arithmetic is computeBalance (T-19).
 *
 * Periods: `?mes=YYYY-MM` (one month, the default being the current one), `?mes=todos` (since the
 * first expense), or `?de=YYYY-MM-DD&ate=YYYY-MM-DD` (both days included). A malformed or
 * reversed range falls back to the current month and is flagged so the page can say so.
 */

export type BalancePeriodView =
  | { kind: "month"; month: string; from: string; to: string }
  | { kind: "all"; from: null; to: null }
  | { kind: "range"; start: string; end: string; from: string; to: string };

export type ParsedBalancePeriod = { period: BalancePeriodView; invalidRange: boolean };

type Raw = string | string[] | undefined;

const MS_PER_DAY = 86_400_000;

function first(value: Raw): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** "YYYY-MM-DD" when it is a real calendar date, else null. */
export function parseIsoDate(value: string | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== value) return null;
  return value!;
}

/** The day after a "YYYY-MM-DD" date. */
export function nextDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + MS_PER_DAY).toISOString().slice(0, 10);
}

function monthPeriod(month: string): BalancePeriodView {
  return { kind: "month", month, ...monthDateRange(month) };
}

export function parseBalancePeriod(params: Record<string, Raw>, currentMonth: string): ParsedBalancePeriod {
  const de = first(params.de);
  const ate = first(params.ate);
  if (de || ate) {
    const start = parseIsoDate(de);
    const end = parseIsoDate(ate);
    if (start && end && start <= end) {
      return { period: { kind: "range", start, end, from: start, to: nextDay(end) }, invalidRange: false };
    }
    return { period: monthPeriod(currentMonth), invalidRange: true };
  }

  const mes = first(params.mes);
  if (mes === ALL_MONTHS) return { period: { kind: "all", from: null, to: null }, invalidRange: false };
  return { period: monthPeriod(parseMonth(mes) ? mes! : currentMonth), invalidRange: false };
}

/** The [from, to) bounds computeBalance and the queries use. */
export function periodBounds(period: BalancePeriodView): BalancePeriod {
  return { from: period.from, to: period.to };
}

/** "Outubro de 2026", "Todo o período", "De 01/10/2026 a 15/10/2026". */
export function describePeriod(period: BalancePeriodView): string {
  if (period.kind === "all") return "Todo o período";
  if (period.kind === "range") {
    return period.start === period.end
      ? `Dia ${formatDate(period.start)}`
      : `De ${formatDate(period.start)} a ${formatDate(period.end)}`;
  }
  const ym = parseMonth(period.month)!;
  return `${MONTHS[ym.month - 1]} de ${ym.year}`;
}

/** The months before and after a month period, for the "Anterior"/"Próximo" links. */
export function adjacentMonths(period: BalancePeriodView): { prev: string; next: string } | null {
  if (period.kind !== "month") return null;
  const ym = parseMonth(period.month)!;
  return { prev: formatMonth(addMonths(ym, -1)), next: formatMonth(addMonths(ym, 1)) };
}

function nameOf(names: Readonly<Record<string, string>>, id: string): string {
  return names[id] ?? "o outro responsável";
}

/** "Ana deve 6,00 € a Bruno", or `even` when nobody owes anything. */
export function describeDebt(
  debt: Debt,
  names: Readonly<Record<string, string>>,
  currency: string,
  even = "Ninguém deve nada.",
): string {
  if (!debt.debtor || !debt.creditor || debt.amountCents === 0) return even;
  return `${nameOf(names, debt.debtor)} deve ${formatCents(debt.amountCents, currency)} a ${nameOf(names, debt.creditor)}.`;
}

/**
 * The "em disputa" line: what the disputed expenses would add if accepted, e.g.
 * "Se aceitas, Ana deveria 22,75 € a Bruno por elas." They are never part of the balance.
 */
export function describeIfAccepted(debt: Debt, names: Readonly<Record<string, string>>, currency: string): string {
  if (!debt.debtor || !debt.creditor || debt.amountCents === 0) return "Se aceites, anulam-se: ninguém deveria nada por elas.";
  return `Se aceites, ${nameOf(names, debt.debtor)} deveria ${formatCents(debt.amountCents, currency)} a ${nameOf(names, debt.creditor)} por elas.`;
}

/** "1 despesa", "3 despesas". */
export function countExpenses(n: number): string {
  return `${n} ${n === 1 ? "despesa" : "despesas"}`;
}

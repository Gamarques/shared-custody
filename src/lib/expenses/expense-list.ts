import { addMonths, formatMonth, parseMonth } from "@/lib/custody/calendar";
import { CATEGORIES } from "./expense-form";

/**
 * Expense list filters (RF-10, T-15): month, category and payer, read from the query string.
 * Anything malformed falls back to "no filter" for category/payer and to the current month.
 */

/** Value of `mes` that lists every month. */
export const ALL_MONTHS = "todos";

export type ExpenseFilters = {
  /** "YYYY-MM", or null for every month. */
  month: string | null;
  /** One of CATEGORIES, or null for all. */
  category: string | null;
  /** members.id of who paid, or null for anyone. */
  paidBy: string | null;
};

type Raw = string | string[] | undefined;

function first(value: Raw): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Filters from `?mes=2026-10&categoria=saude&pagou=<member id>`; month defaults to `currentMonth`. */
export function parseExpenseFilters(
  params: Record<string, Raw>,
  currentMonth: string,
  memberIds: readonly string[],
): ExpenseFilters {
  const mes = first(params.mes);
  const month = mes === ALL_MONTHS ? null : parseMonth(mes) ? mes! : currentMonth;
  const categoria = first(params.categoria);
  const pagou = first(params.pagou);
  return {
    month,
    category: CATEGORIES.some((c) => c.value === categoria) ? categoria! : null,
    paidBy: pagou && memberIds.includes(pagou) ? pagou : null,
  };
}

/** [from, to) dates of a "YYYY-MM" month, for `spent_on >= from and spent_on < to`. */
export function monthDateRange(month: string): { from: string; to: string } {
  const ym = parseMonth(month);
  if (!ym) throw new Error(`invalid month: ${month}`);
  return { from: `${formatMonth(ym)}-01`, to: `${formatMonth(addMonths(ym, 1))}-01` };
}

/** Sum in integer cents of the listed expenses (the total shown for the filter). */
export function totalCents(rows: readonly { amount_cents: number }[]): number {
  return rows.reduce((sum, r) => sum + r.amount_cents, 0);
}

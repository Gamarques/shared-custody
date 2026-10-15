import { categoryLabel } from "./expense-form";
import { STATUS_LABELS } from "./expense-decision";
import { formatBps, splitExpense } from "./money";

/**
 * CSV export of a month's expenses (RF-15, T-22). Built for Excel with a pt/EU locale: UTF-8
 * with a BOM (so accents survive), ";" as separator, CRLF line ends and decimal commas.
 */

export const CSV_BOM = "﻿";
export const CSV_SEPARATOR = ";";

export type CsvExpense = {
  paid_by: string;
  amount_cents: number;
  spent_on: string;
  description: string;
  category: string;
  payer_share_bps: number;
  status: string;
};

export const CSV_HEADER = [
  "Data",
  "Descrição",
  "Categoria",
  "Pago por",
  "Valor",
  "Quota do pagador (%)",
  "Parte do pagador",
  "Parte do outro",
  "Status",
] as const;

/** Integer cents as "1234,50", with no float involved. */
export function centsToDecimal(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.trunc(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

/**
 * One CSV cell. Quotes when it holds a separator, quote or line break, and neutralises cells
 * that Excel would run as a formula (leading = + - @, tab or CR) with a leading apostrophe.
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[";\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** "2026-10-12" -> "12/10/2026". */
function brDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** Whole file text: BOM, header and one line per expense, in the order given. */
export function expensesToCsv(expenses: readonly CsvExpense[], memberNames: Readonly<Record<string, string>>): string {
  const lines = [CSV_HEADER.join(CSV_SEPARATOR)];
  for (const e of expenses) {
    const { payerCents, otherCents } = splitExpense(e.amount_cents, e.payer_share_bps);
    lines.push(
      [
        brDate(e.spent_on),
        e.description,
        categoryLabel(e.category),
        memberNames[e.paid_by] ?? "?",
        centsToDecimal(e.amount_cents),
        formatBps(e.payer_share_bps),
        centsToDecimal(payerCents),
        centsToDecimal(otherCents),
        STATUS_LABELS[e.status] ?? e.status,
      ]
        .map(csvCell)
        .join(CSV_SEPARATOR),
    );
  }
  return CSV_BOM + lines.join("\r\n") + "\r\n";
}

/** "despesas-2026-10.csv". */
export function csvFilename(month: string): string {
  return `despesas-${month}.csv`;
}

/**
 * Money and shares (RNF-02): amounts are integer cents and shares are basis points
 * (5000 = 50%). Typed text is parsed with string and integer arithmetic only, never through a
 * float, so "0,29" is exactly 29 cents.
 */

export const BPS_TOTAL = 10_000;
/** Largest amount accepted for one expense: 1 000 000,00 (well inside a Postgres integer). */
export const MAX_AMOUNT_CENTS = 100_000_000;

function digitsToCents(units: string, fraction: string): number {
  return Number(units) * 100 + Number(fraction.padEnd(2, "0"));
}

/**
 * Cents of an amount typed by a person, or null when the text is not an amount.
 * Accepts "12", "12,5", "12.50", "1.234,56", "1,234.56", "1 234,56" and a currency symbol
 * around the number. A separator followed by exactly 3 digits groups thousands ("1.234" is
 * 1234), one followed by 1 or 2 digits marks the cents.
 */
export function parseAmountToCents(text: string): number | null {
  const s = text.replace(/[\s  €$R]/g, "");
  let m = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(s);
  if (m) return digitsToCents(m[1], m[2] ?? "");
  m = /^(\d{1,3}(?:\.\d{3})+)(?:,(\d{1,2}))?$/.exec(s);
  if (m) return digitsToCents(m[1].replace(/\./g, ""), m[2] ?? "");
  m = /^(\d{1,3}(?:,\d{3})+)(?:\.(\d{1,2}))?$/.exec(s);
  if (m) return digitsToCents(m[1].replace(/,/g, ""), m[2] ?? "");
  return null;
}

/** "1234,50" style text for an amount field (no currency, no grouping). */
export function centsToInput(cents: number): string {
  return `${Math.trunc(cents / 100)},${String(cents % 100).padStart(2, "0")}`;
}

/** "1234,50 €" in the family currency. */
export function formatCents(cents: number, currency: string): string {
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency }).format(cents / 100);
}

/**
 * Basis points of a percentage typed by a person ("50", "33,33", "12.5", "40%"), or null when
 * the text is not a number between 0 and 100 with at most 2 decimals.
 */
export function parsePercentToBps(text: string): number | null {
  const m = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(text.replace(/[\s%]/g, ""));
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return bps <= BPS_TOTAL ? bps : null;
}

/** 5000 -> "50", 3333 -> "33,33", 1250 -> "12,5". */
export function formatBps(bps: number): string {
  const units = Math.trunc(bps / 100);
  const fraction = String(bps % 100).padStart(2, "0").replace(/0+$/, "");
  return fraction ? `${units},${fraction}` : String(units);
}

/**
 * How an expense splits (business rule 1 of "Despesas"): the payer's share is
 * amount × bps / 10000 rounded to the cent (half up), and the other member takes the rest, so
 * the two always add up to the amount.
 */
export function splitExpense(amountCents: number, payerShareBps: number): { payerCents: number; otherCents: number } {
  const payerCents = Math.floor((amountCents * payerShareBps + BPS_TOTAL / 2) / BPS_TOTAL);
  return { payerCents, otherCents: amountCents - payerCents };
}

import { splitExpense } from "@/lib/expenses/money";

/**
 * Balance between the two members (RF-13, T-19), following the "Despesas" business rules in
 * docs/plano-mvp.md. Everything is integer cents (RNF-02); the per-expense split comes from
 * splitExpense, so each expense's two shares add up exactly to its amount.
 *
 * Rule 3: balance = what A owes B on expenses B paid − what B owes A on expenses A paid
 *                   − settlements from A to B + settlements from B to A.
 * Rule 4: disputed expenses stay out of the main balance and are netted on a separate
 *         "em disputa" line. Logically deleted expenses (deleted_at) count nowhere.
 */

/** The expense columns the balance needs (same names as public.expenses). */
export type BalanceExpense = {
  paid_by: string;
  amount_cents: number;
  payer_share_bps: number;
  status: "pending" | "confirmed" | "disputed" | string;
  spent_on: string;
  deleted_at?: string | null;
};

/** The settlement columns the balance needs (same names as public.settlements). */
export type BalanceSettlement = {
  from_member: string;
  to_member: string;
  amount_cents: number;
  settled_on: string;
};

/** [from, to) dates ("YYYY-MM-DD") of the period; either end may be open. */
export type BalancePeriod = { from?: string | null; to?: string | null };

/** Who owes whom: `amountCents` > 0 with both members set, or 0 with both null (even). */
export type Debt = { debtor: string | null; creditor: string | null; amountCents: number };

export type Balance = Debt & {
  /** What A owes B (negative when B owes A), after settlements. */
  netCents: number;
  /** The "em disputa" line: disputed expenses only, no settlements. */
  disputed: Debt & { netCents: number; count: number };
  /** Number of expenses in the main balance (pending + confirmed). */
  expenseCount: number;
};

function inPeriod(date: string, period: BalancePeriod | undefined): boolean {
  if (!period) return true;
  if (period.from && date < period.from) return false;
  if (period.to && date >= period.to) return false;
  return true;
}

/** Debt from a signed "A owes B" amount. */
export function toDebt(memberA: string, memberB: string, netCents: number): Debt {
  if (netCents > 0) return { debtor: memberA, creditor: memberB, amountCents: netCents };
  if (netCents < 0) return { debtor: memberB, creditor: memberA, amountCents: -netCents };
  return { debtor: null, creditor: null, amountCents: 0 };
}

/**
 * What A owes B because of one expense (negative when B owes A): the non-payer's part, i.e.
 * amount − payer's share (rule 2). Throws when the payer is neither A nor B.
 */
export function expenseNetCents(memberA: string, memberB: string, e: BalanceExpense): number {
  const { otherCents } = splitExpense(e.amount_cents, e.payer_share_bps);
  if (e.paid_by === memberB) return otherCents;
  if (e.paid_by === memberA) return 0 - otherCents; // not -otherCents: no -0
  throw new Error(`expense paid by ${e.paid_by}, who is not one of the two members`);
}

/**
 * Balance of the period between members A and B. Rows outside the period (by spent_on /
 * settled_on) and deleted expenses are ignored, so the caller may pass a wider set.
 */
export function computeBalance(
  memberA: string,
  memberB: string,
  expenses: readonly BalanceExpense[],
  settlements: readonly BalanceSettlement[],
  period?: BalancePeriod,
): Balance {
  if (memberA === memberB) throw new Error("the balance needs two different members");

  let net = 0;
  let disputedNet = 0;
  let disputedCount = 0;
  let expenseCount = 0;

  for (const e of expenses) {
    if (e.deleted_at || !inPeriod(e.spent_on, period)) continue;
    const cents = expenseNetCents(memberA, memberB, e);
    if (e.status === "disputed") {
      disputedNet += cents;
      disputedCount++;
    } else {
      net += cents;
      expenseCount++;
    }
  }

  for (const s of settlements) {
    if (!inPeriod(s.settled_on, period)) continue;
    if (s.from_member === memberA && s.to_member === memberB) net -= s.amount_cents;
    else if (s.from_member === memberB && s.to_member === memberA) net += s.amount_cents;
    else throw new Error(`settlement ${s.from_member} -> ${s.to_member} is not between the two members`);
  }

  return {
    ...toDebt(memberA, memberB, net),
    netCents: net,
    disputed: { ...toDebt(memberA, memberB, disputedNet), netCents: disputedNet, count: disputedCount },
    expenseCount,
  };
}

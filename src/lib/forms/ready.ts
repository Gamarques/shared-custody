/**
 * "Is there something to send?" checks that keep each submit button disabled until the required
 * fields have real content. UX only: the full validation (validate* in each module) still runs on
 * submit, and the database enforces the rules again. These checks are deliberately looser than the
 * validation: a field with text that is not valid (e.g. "12,5x") enables the button, so the person
 * gets the validation message instead of a disabled button with no explanation.
 */
import type { SettlementFormInput } from "@/lib/balance/settlement-form";
import type { OverrideFormInput } from "@/lib/custody/override-form";
import type { RuleFormInput } from "@/lib/custody/rule-form";
import type { ExpenseFormInput } from "@/lib/expenses/expense-form";
import { parseAmountToCents, parsePercentToBps } from "@/lib/expenses/money";
import type { MemberProfileInput, OnboardingInput } from "@/lib/onboarding/validate";

/** Not empty once surrounding whitespace is removed. */
export function hasText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/** Something typed, and not an amount of zero ("0", "0,00"). */
export function amountReady(text: string): boolean {
  return hasText(text) && parseAmountToCents(text) !== 0;
}

export function expenseFormReady(f: ExpenseFormInput): boolean {
  return (
    amountReady(f.amount) &&
    hasText(f.spentOn) &&
    hasText(f.description) &&
    hasText(f.category) &&
    hasText(f.paidBy) &&
    hasText(f.payerPercent)
  );
}

/** The note is optional. */
export function settlementFormReady(f: SettlementFormInput): boolean {
  return amountReady(f.amount) && hasText(f.settledOn) && hasText(f.fromMember);
}

export function overrideFormReady(f: OverrideFormInput): boolean {
  return (
    hasText(f.memberId) &&
    hasText(f.startDate) &&
    hasText(f.startTime) &&
    hasText(f.endDate) &&
    hasText(f.endTime) &&
    hasText(f.reason)
  );
}

/** validFrom is only asked for (non-null) when the rule changes. */
export function ruleFormReady(f: RuleFormInput): boolean {
  return (
    hasText(f.firstMemberId) &&
    hasText(f.startsOn) &&
    hasText(f.handoverTime) &&
    Number.isInteger(f.handoverWeekday) &&
    (f.validFrom === null || hasText(f.validFrom))
  );
}

/** A dispute needs a comment. */
export function disputeCommentReady(comment: string): boolean {
  return hasText(comment);
}

export function memberProfileReady(f: MemberProfileInput): boolean {
  return hasText(f.displayName) && hasText(f.color);
}

export function onboardingReady(f: OnboardingInput): boolean {
  return hasText(f.familyName) && memberProfileReady(f);
}

/** Something typed, and different from the saved default (saving the same value does nothing). */
export function defaultShareReady(percent: string, savedBps: number): boolean {
  return hasText(percent) && parsePercentToBps(percent) !== savedBps;
}

/** E-mail always; the password too in password mode (not trimmed: spaces can be part of it). */
export function loginReady(mode: "link" | "password", email: string, password: string): boolean {
  return hasText(email) && (mode === "link" || password.length > 0);
}

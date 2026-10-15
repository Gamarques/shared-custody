import { formatInstant } from "@/lib/custody/override-form";
import { formatDate } from "@/lib/custody/rule-form";
import { STATUS_LABELS } from "./expense-decision";
import { categoryLabel } from "./expense-form";
import { formatBps, formatCents } from "./money";

/**
 * Expense history (RF-12, T-17): turns expense_audit rows (full row before and after, written
 * by the expenses_audit trigger) into "who changed what and when" for the screen.
 */

export type AuditAction = "insert" | "update" | "delete";

/** An expenses row as stored in expense_audit.old_data / new_data (to_jsonb). */
export type ExpenseSnapshot = Record<string, unknown>;

export type AuditRow = {
  seq: number;
  action: AuditAction;
  /** auth user id; null when changed outside a session (SQL editor, service role). */
  changed_by: string | null;
  changed_at: string;
  old_data: ExpenseSnapshot | null;
  new_data: ExpenseSnapshot;
};

export type HistoryContext = {
  currency: string;
  timeZone: string;
  /** members.id -> display name (for paid_by). */
  memberNames: Readonly<Record<string, string>>;
  /** auth user id -> display name (for changed_by). */
  userNames: Readonly<Record<string, string>>;
};

export type FieldChange = {
  label: string;
  /** Null for the values of a newly created expense. */
  from: string | null;
  to: string;
};

export type HistoryItem = {
  key: string;
  title: string;
  who: string;
  when: string;
  changes: FieldChange[];
};

const NONE = "—";

type Field = {
  key: string;
  label: string;
  format: (value: unknown, ctx: HistoryContext) => string;
  /** Shown for null or "" (default "—"). */
  empty?: string;
};

/** The columns a person edits or decides, in screen order. Bookkeeping columns are not shown. */
const FIELDS: readonly Field[] = [
  { key: "amount_cents", label: "Valor", format: (v, c) => formatCents(Number(v), c.currency) },
  { key: "spent_on", label: "Data", format: (v) => formatDate(String(v)) },
  { key: "description", label: "Descrição", format: (v) => String(v) },
  { key: "category", label: "Categoria", format: (v) => categoryLabel(String(v)) },
  { key: "paid_by", label: "Quem pagou", format: (v, c) => c.memberNames[String(v)] ?? "responsável removido" },
  { key: "payer_share_bps", label: "Parte de quem pagou", format: (v) => `${formatBps(Number(v))}%` },
  { key: "receipt_path", label: "Comprovante", format: () => "anexado", empty: "sem comprovante" },
  { key: "status", label: "Situação", format: (v) => STATUS_LABELS[String(v)] ?? String(v) },
  { key: "dispute_comment", label: "Motivo da contestação", format: (v) => String(v) },
];

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

/**
 * What changed between two versions of an expense, formatted for the screen. Without `before`
 * (creation), the filled-in values of `after`. A replaced receipt shows as "anexado → substituído".
 */
export function fieldChanges(before: ExpenseSnapshot | null, after: ExpenseSnapshot, ctx: HistoryContext): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const f of FIELDS) {
    const to = after[f.key];
    if (!before) {
      if (!isEmpty(to)) changes.push({ label: f.label, from: null, to: f.format(to, ctx) });
      continue;
    }
    const from = before[f.key];
    if (JSON.stringify(from ?? null) === JSON.stringify(to ?? null)) continue;
    if (f.key === "receipt_path" && !isEmpty(from) && !isEmpty(to)) {
      changes.push({ label: f.label, from: "anexado", to: "substituído" });
      continue;
    }
    const show = (v: unknown) => (isEmpty(v) ? (f.empty ?? NONE) : f.format(v, ctx));
    changes.push({ label: f.label, from: show(from), to: show(to) });
  }
  return changes;
}

/** "Criou a despesa", "Confirmou a despesa", "Excluiu a despesa", ... */
export function entryTitle(row: Pick<AuditRow, "action" | "old_data" | "new_data">): string {
  if (row.action === "insert") return "Criou a despesa";
  if (row.action === "delete") return "Excluiu a despesa";
  const before = row.old_data ?? {};
  const after = row.new_data;
  if (!isEmpty(before.deleted_at) && isEmpty(after.deleted_at)) return "Restaurou a despesa";
  if (before.status !== after.status) {
    if (after.status === "confirmed") return "Confirmou a despesa";
    if (after.status === "disputed") return "Contestou a despesa";
  }
  return "Alterou a despesa";
}

/** Display name of whoever made the change. */
export function changedByName(userId: string | null, userNames: Readonly<Record<string, string>>): string {
  if (!userId) return "Sistema";
  return userNames[userId] ?? "Responsável removido";
}

/** Screen entries, in the order of `rows`. */
export function buildHistory(rows: readonly AuditRow[], ctx: HistoryContext): HistoryItem[] {
  return rows.map((r) => ({
    key: String(r.seq),
    title: entryTitle(r),
    who: changedByName(r.changed_by, ctx.userNames),
    when: formatInstant(r.changed_at, ctx.timeZone),
    // deleted_at is not a field: a deletion shows in the title, with no changes of its own.
    changes: fieldChanges(r.old_data, r.new_data, ctx),
  }));
}

/**
 * In-memory database for demo mode. It runs the requests recorded by the fake client
 * (./fake-client.ts) and mirrors what the SQL migrations enforce for them, so the demo
 * behaves like the real app: RLS limits every read and write to the caller's family, the
 * same tables are read-only or insert-only, the expense triggers (pending on insert, back to
 * pending when a decided expense is edited, logical delete, audit rows) and the RPCs
 * (create_family, invites, confirm/dispute, the platform admin functions) follow supabase/migrations.
 *
 * Not a SQL engine: only the checks the forms can trip are reproduced, with the same SQLSTATE
 * codes, so the forms show the same messages.
 */
import { RECEIPT_BUCKET } from "@/lib/receipts/receipts";
import type { DemoError, DemoRequest, DemoResult, Filter, Order, Row, StorageRequest, TableRequest } from "./fake-client";

export type DemoUserRow = { id: string; email: string; created_at?: string; last_sign_in_at?: string | null };
type StoredObject = { contentType: string; base64: string };

type Tables = Record<string, Row[]>;
export type DemoTableName =
  | "families"
  | "members"
  | "invites"
  | "children"
  | "custody_rules"
  | "custody_overrides"
  | "expenses"
  | "settlements"
  | "expense_audit";

const TABLES: DemoTableName[] = [
  "families",
  "members",
  "invites",
  "children",
  "custody_rules",
  "custody_overrides",
  "expenses",
  "settlements",
  "expense_audit",
];

/** Writes each table accepts from a signed-in member (grants + policies in the migrations). */
const ALLOWED: Record<DemoTableName, ReadonlySet<TableRequest["action"]>> = {
  families: new Set(["select", "update"]),
  members: new Set(["select", "update"]),
  invites: new Set(["select", "delete"]),
  children: new Set(["select", "insert", "update", "delete"]),
  custody_rules: new Set(["select", "insert"]),
  custody_overrides: new Set(["select", "insert", "delete"]),
  expenses: new Set(["select", "insert", "update"]),
  settlements: new Set(["select", "insert"]),
  expense_audit: new Set(["select"]),
};

const CATEGORIES = new Set(["saude", "escola", "alimentacao", "vestuario", "lazer", "transporte", "outros"]);
const RECEIPT_SIZE_LIMIT = 512_000;
const DAY_MS = 86_400_000;

export class DemoDbError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

function fail(code: string, message: string, status = 400): never {
  throw new DemoDbError(code, message, status);
}

function toError(e: unknown): DemoError {
  if (e instanceof DemoDbError) return { code: e.code, message: e.message, details: null, hint: null };
  return { code: "XX000", message: e instanceof Error ? e.message : String(e), details: null, hint: null };
}

// ---------------------------------------------------------------------------------------------
// select string ("id, families(timezone, members(id))") parsing and projection

export type SelectNode = { kind: "column"; name: string } | { kind: "embed"; name: string; children: SelectNode[] };

export function parseSelect(select: string): SelectNode[] {
  let i = 0;
  function list(): SelectNode[] {
    const nodes: SelectNode[] = [];
    while (i < select.length) {
      const start = i;
      while (i < select.length && !",()".includes(select[i])) i++;
      const name = select.slice(start, i).trim();
      if (select[i] === "(") {
        i++;
        nodes.push({ kind: "embed", name, children: list() });
        if (select[i] !== ")") throw new Error(`Unbalanced select: ${select}`);
        i++;
        while (i < select.length && select[i] === " ") i++;
      } else if (name) {
        nodes.push({ kind: "column", name });
      }
      if (select[i] === ",") {
        i++;
        continue;
      }
      if (select[i] === ")" || i >= select.length) break;
    }
    return nodes;
  }
  const nodes = list();
  if (i < select.length) throw new Error(`Unbalanced select: ${select}`);
  return nodes;
}

type Relation = { table: DemoTableName; local: string; foreign: string; one: boolean };

/** Foreign keys the selects follow: every table points at its family through family_id. */
function relation(from: string, embed: string): Relation {
  if (embed === "families" && from !== "families") return { table: "families", local: "family_id", foreign: "id", one: true };
  if (from === "families" && (TABLES as string[]).includes(embed)) {
    return { table: embed as DemoTableName, local: "id", foreign: "family_id", one: false };
  }
  return fail("PGRST200", `Could not find a relationship between '${from}' and '${embed}'`);
}

// ---------------------------------------------------------------------------------------------
// filters and ordering

const DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const sa = String(a);
  const sb = String(b);
  if (DATETIME.test(sa) && DATETIME.test(sb)) return Date.parse(sa) - Date.parse(sb);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function matches(row: Row, f: Filter): boolean {
  const v = row[f.column];
  switch (f.op) {
    case "is":
      return f.value === null ? v === null || v === undefined : v === f.value;
    case "in":
      return (f.value as unknown[]).some((x) => String(x) === String(v));
    case "eq":
      return v !== null && v !== undefined && String(v) === String(f.value);
    case "neq":
      return v !== null && v !== undefined && String(v) !== String(f.value);
  }
  if (v === null || v === undefined || f.value === null) return false;
  const c = compare(v, f.value);
  return f.op === "gt" ? c > 0 : f.op === "gte" ? c >= 0 : f.op === "lt" ? c < 0 : c <= 0;
}

function sortRows(rows: Row[], order: Order[]): Row[] {
  return [...rows].sort((x, y) => {
    for (const o of order) {
      const a = x[o.column];
      const b = y[o.column];
      if (a == null && b == null) continue;
      // Postgres: nulls last when ascending, first when descending.
      if (a == null) return o.ascending ? 1 : -1;
      if (b == null) return o.ascending ? -1 : 1;
      const c = compare(a, b);
      if (c !== 0) return o.ascending ? c : -c;
    }
    return 0;
  });
}

// ---------------------------------------------------------------------------------------------

function normalizeTimestamps(row: Row): Row {
  for (const [k, v] of Object.entries(row)) {
    if (k.endsWith("_at") && typeof v === "string") {
      const t = Date.parse(v);
      if (Number.isNaN(t)) fail("22007", `invalid input syntax for type timestamp with time zone: "${v}"`);
      row[k] = new Date(t).toISOString();
    }
  }
  return row;
}

function normalizeTime(value: unknown): string {
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(value));
  if (!m) fail("22007", `invalid input syntax for type time: "${String(value)}"`);
  return `${m[1]}:${m[2]}:${m[3] ?? "00"}`;
}

function checkLength(value: unknown, min: number, max: number, constraint: string) {
  const s = typeof value === "string" ? value.trim() : "";
  if (s.length < min || s.length > max) fail("23514", `new row violates check constraint "${constraint}"`);
}

function dateWeekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** Local date of an instant in a time zone, "YYYY-MM-DD". */
function localDate(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
}

export type DemoStoreOptions = { now?: () => Date; newId?: () => string };

export class DemoStore {
  readonly tables: Tables = Object.fromEntries(TABLES.map((t) => [t, []]));
  readonly users: DemoUserRow[] = [];
  /** shared_custody.app_admins: user ids of the platform admins. */
  readonly admins = new Set<string>();
  /** shared_custody.admin_actions. */
  readonly adminActions: Row[] = [];
  readonly objects = new Map<string, StoredObject>();
  /** Tables whose reads fail (DEMO_VARIANT=error), to see the load-error states. */
  readonly failingTables = new Set<string>();
  private auditSeq = 0;
  now: () => Date;
  private readonly newId: () => string;

  constructor(options: DemoStoreOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? (() => crypto.randomUUID());
  }

  /** Runs a request as `userId`, like PostgREST with that user's token. Never rejects. */
  async execute(request: DemoRequest, userId: string | null): Promise<DemoResult> {
    return this.executeSync(request, userId);
  }

  executeSync(request: DemoRequest, userId: string | null): DemoResult {
    try {
      if (request.kind === "rpc") return { data: this.rpc(request.fn, request.args, userId), error: null, status: 200 };
      if (request.kind === "storage") return this.storage(request, userId);
      return this.table(request, userId);
    } catch (e) {
      return { data: null, error: toError(e), status: e instanceof DemoDbError ? e.status : 500 };
    }
  }

  // --- RLS ------------------------------------------------------------------------------------

  private familiesOf(userId: string | null): Set<string> {
    return new Set(this.tables.members.filter((m) => m.user_id === userId).map((m) => String(m.family_id)));
  }

  private memberOf(userId: string | null, familyId: unknown): Row | undefined {
    return this.tables.members.find((m) => m.user_id === userId && m.family_id === familyId);
  }

  private visible(table: string, userId: string | null): Row[] {
    const mine = this.familiesOf(userId);
    const key = table === "families" ? "id" : "family_id";
    return this.tables[table].filter((r) => mine.has(String(r[key])));
  }

  // --- tables ---------------------------------------------------------------------------------

  private table(request: TableRequest, userId: string | null): DemoResult {
    const name = request.table as DemoTableName;
    if (!TABLES.includes(name)) fail("42P01", `relation "public.${request.table}" does not exist`, 404);
    if (!userId) fail("42501", `permission denied for table ${name}`, 401);
    if (!ALLOWED[name].has(request.action)) fail("42501", `permission denied for table ${name}`, 403);
    if (request.action === "select" && this.failingTables.has(name)) fail("XX000", `simulated failure reading ${name}`, 500);

    const nodes = parseSelect(request.columns ?? "*");
    const topFilters = request.filters.filter((f) => !f.column.includes("."));
    const embedFilters = request.filters.filter((f) => f.column.includes("."));
    const pick = () => this.visible(name, userId).filter((r) => topFilters.every((f) => matches(r, f)));

    let rows: Row[];
    let status = 200;
    switch (request.action) {
      case "select":
        rows = pick();
        break;
      case "insert": {
        const values = Array.isArray(request.values) ? request.values : [request.values ?? {}];
        rows = values.map((v) => this.insertRow(name, { ...v }, userId));
        status = 201;
        break;
      }
      case "update":
        rows = pick().map((r) => this.updateRow(name, r, { ...(request.values as Row) }, userId));
        break;
      case "delete":
        rows = pick().filter((r) => this.canDelete(name, r));
        for (const r of rows) this.tables[name].splice(this.tables[name].indexOf(r), 1);
        break;
    }

    const returning = request.action === "select" || request.columns !== null;
    const count = request.count === "exact" ? rows.length : null;
    if (!returning) return { data: null, error: null, count, status: request.action === "insert" ? 201 : 204 };

    rows = sortRows(rows, request.order);
    if (request.limit !== undefined) rows = rows.slice(0, request.limit);
    const data = rows.map((r) => this.project(name, r, nodes, "", embedFilters, userId));
    if (request.head) return { data: null, error: null, count, status };
    if (request.single) {
      if (data.length > 1 || (data.length === 0 && request.single === "single")) {
        fail("PGRST116", "JSON object requested, multiple (or no) rows returned", 406);
      }
      return { data: data[0] ?? null, error: null, count, status };
    }
    return { data, error: null, count, status };
  }

  private project(table: string, row: Row, nodes: SelectNode[], path: string, embedFilters: Filter[], userId: string | null): Row {
    const out: Row = {};
    for (const node of nodes) {
      if (node.kind === "column") {
        if (node.name === "*") Object.assign(out, structuredClone(row));
        else out[node.name] = structuredClone(row[node.name] ?? null);
        continue;
      }
      const rel = relation(table, node.name);
      const embedPath = path ? `${path}.${node.name}` : node.name;
      const filters = embedFilters
        .filter((f) => f.column.startsWith(`${embedPath}.`) && !f.column.slice(embedPath.length + 1).includes("."))
        .map((f) => ({ ...f, column: f.column.slice(embedPath.length + 1) }));
      const related = this.visible(rel.table, userId).filter(
        (r) => r[rel.foreign] === row[rel.local] && filters.every((f) => matches(r, f)),
      );
      const projected = related.map((r) => this.project(rel.table, r, node.children, embedPath, embedFilters, userId));
      out[node.name] = rel.one ? (projected[0] ?? null) : projected;
    }
    return out;
  }

  private requireFamily(row: Row, userId: string | null, table: string) {
    if (!this.memberOf(userId, row.family_id)) {
      fail("42501", `new row violates row-level security policy for table "${table}"`, 403);
    }
  }

  private requireMember(familyId: unknown, memberId: unknown) {
    if (!this.tables.members.some((m) => m.id === memberId && m.family_id === familyId)) {
      fail("23503", "insert or update violates foreign key constraint: member is not in the family", 409);
    }
  }

  private insertRow(table: DemoTableName, row: Row, userId: string | null): Row {
    const now = this.now().toISOString();
    row = normalizeTimestamps({ id: this.newId(), ...row });
    this.requireFamily(row, userId, table);
    switch (table) {
      case "children":
        checkLength(row.name, 1, 80, "children_name_check");
        row = { birth_date: null, ...row, created_at: now };
        break;
      case "custody_rules": {
        this.requireMember(row.family_id, row.first_member_id);
        row.handover_time = normalizeTime(row.handover_time);
        if (dateWeekday(String(row.starts_on)) !== Number(row.handover_weekday)) {
          fail("23514", 'new row violates check constraint "custody_rules_check"');
        }
        if (row.valid_from == null) {
          const hasRule = this.tables.custody_rules.some((r) => r.family_id === row.family_id);
          const tz = String(this.tables.families.find((f) => f.id === row.family_id)?.timezone ?? "Europe/Lisbon");
          row.valid_from = hasRule ? localDate(this.now().getTime(), tz) : row.starts_on;
        }
        row = { valid_to: null, ...row, created_by: userId, created_at: now };
        if (row.valid_to !== null && String(row.valid_to) <= String(row.valid_from)) {
          fail("23514", 'new row violates check constraint "custody_rules_check1"');
        }
        break;
      }
      case "custody_overrides": {
        this.requireMember(row.family_id, row.member_id);
        checkLength(row.reason, 1, 200, "custody_overrides_reason_check");
        const start = Date.parse(String(row.starts_at));
        const end = Date.parse(String(row.ends_at));
        if (!(end > start)) fail("23514", 'new row violates check constraint "custody_overrides_check"');
        if (end - start > 366 * DAY_MS) fail("23514", 'new row violates check constraint "custody_overrides_max_length"');
        row = { ...row, created_by: userId, created_at: now };
        break;
      }
      case "expenses": {
        this.requireMember(row.family_id, row.paid_by);
        if (row.payer_share_bps == null) {
          row.payer_share_bps = this.tables.families.find((f) => f.id === row.family_id)?.default_payer_share_bps;
        }
        row = {
          category: "outros",
          receipt_path: null,
          ...row,
          status: "pending",
          dispute_comment: null,
          decided_by: null,
          decided_at: null,
          created_by: userId,
          created_at: now,
          updated_at: now,
          deleted_at: null,
        };
        this.checkExpense(row);
        break;
      }
      case "settlements": {
        this.requireMember(row.family_id, row.from_member);
        this.requireMember(row.family_id, row.to_member);
        if (row.from_member === row.to_member) fail("23514", 'new row violates check constraint "settlements_check"');
        const cents = Number(row.amount_cents);
        if (!Number.isInteger(cents) || cents <= 0 || cents > 100_000_000) {
          fail("23514", 'new row violates check constraint "settlements_amount_cents_check"');
        }
        if (typeof row.note === "string" && row.note.length > 200) fail("23514", 'new row violates check constraint "settlements_note_check"');
        row = { note: null, ...row, created_by: userId, created_at: now };
        break;
      }
      default:
        fail("42501", `permission denied for table ${table}`, 403);
    }
    this.tables[table].push(row);
    if (table === "expenses") this.audit("insert", null, row, userId);
    return row;
  }

  private checkExpense(row: Row) {
    const cents = Number(row.amount_cents);
    if (!Number.isInteger(cents) || cents <= 0) fail("23514", 'new row violates check constraint "expenses_amount_cents_check"');
    if (cents > 100_000_000) fail("23514", 'new row violates check constraint "expenses_amount_max"');
    checkLength(row.description, 1, 200, "expenses_description_check");
    if (!CATEGORIES.has(String(row.category))) fail("23514", 'new row violates check constraint "expenses_category_check"');
    const bps = Number(row.payer_share_bps);
    if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) fail("23514", 'new row violates check constraint "expenses_payer_share_bps_check"');
    if (row.receipt_path != null && !String(row.receipt_path).startsWith(`${row.family_id}/`)) {
      fail("23514", 'new row violates check constraint "expenses_receipt_path_in_family"');
    }
  }

  private updateRow(table: DemoTableName, old: Row, changes: Row, userId: string | null, decision = false): Row {
    const next = normalizeTimestamps({ ...old, ...changes });
    if (next.family_id !== old.family_id || next.id !== old.id) fail("42501", `${table} family cannot change`, 403);
    switch (table) {
      case "families": {
        const bps = Number(next.default_payer_share_bps);
        if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
          fail("23514", 'new row violates check constraint "families_default_payer_share_bps_check"');
        }
        checkLength(next.name, 1, 80, "families_name_check");
        break;
      }
      case "members":
        if (old.user_id !== userId) return old; // "member updates self": other rows are not visible to update
        if (next.user_id !== old.user_id || next.role !== old.role) fail("P0001", "family_id, user_id and role are immutable");
        checkLength(next.display_name, 1, 40, "members_display_name_check");
        break;
      case "children":
        checkLength(next.name, 1, 80, "children_name_check");
        break;
      case "expenses":
        return this.updateExpense(old, next, userId, decision);
    }
    Object.assign(old, next);
    return old;
  }

  /** expenses_guard_decision + expenses_audit (20261015000200, 20261015000100). */
  private updateExpense(old: Row, next: Row, userId: string | null, decision: boolean): Row {
    if (old.deleted_at !== null) fail("55000", "expense is deleted");
    const decisionFields = ["status", "dispute_comment", "decided_by", "decided_at"];
    if (!decision && decisionFields.some((k) => next[k] !== old[k])) {
      fail("42501", "expense status can only change through confirm_expense or dispute_expense", 403);
    }
    const now = this.now().toISOString();
    if (next.deleted_at !== null) {
      next.deleted_at = now;
      next.updated_at = now;
    } else {
      this.requireMember(next.family_id, next.paid_by);
      const content = ["paid_by", "amount_cents", "spent_on", "description", "category", "payer_share_bps", "receipt_path"];
      if (!decision && content.some((k) => next[k] !== old[k])) {
        next.updated_at = now;
        if (old.status !== "pending") Object.assign(next, { status: "pending", dispute_comment: null, decided_by: null, decided_at: null });
      }
      this.checkExpense(next);
    }
    const before = { ...old };
    const changed = Object.keys(next).some((k) => k !== "updated_at" && next[k] !== old[k]);
    Object.assign(old, next);
    if (changed) this.audit(before.deleted_at === null && old.deleted_at !== null ? "delete" : "update", before, old, userId);
    return old;
  }

  private canDelete(table: DemoTableName, row: Row): boolean {
    if (table === "invites") return row.accepted_at === null;
    return true;
  }

  private audit(action: "insert" | "update" | "delete", oldData: Row | null, newData: Row, userId: string | null) {
    this.tables.expense_audit.push({
      id: this.newId(),
      seq: ++this.auditSeq,
      expense_id: newData.id,
      family_id: newData.family_id,
      changed_by: userId,
      changed_at: this.now().toISOString(),
      action,
      old_data: oldData ? structuredClone(oldData) : null,
      new_data: structuredClone(newData),
    });
  }

  // --- RPCs -----------------------------------------------------------------------------------

  private rpc(fn: string, args: Row, userId: string | null): unknown {
    if (fn === "keepalive_ping") return this.now().toISOString();
    if (!userId) fail("28000", "not authenticated", 401);
    switch (fn) {
      case "create_family":
        return this.createFamily(String(args.family_name ?? ""), String(args.member_display_name ?? ""), String(args.member_color ?? ""), userId);
      case "create_invite":
        return this.createInvite(args.invite_email as string | null | undefined, userId);
      case "get_invite":
        return this.getInvite(String(args.invite_token ?? ""));
      case "accept_invite":
        return this.acceptInvite(String(args.invite_token ?? ""), String(args.member_display_name ?? ""), String(args.member_color ?? ""), userId);
      case "confirm_expense":
        return this.decideExpense(String(args.eid ?? ""), "confirmed", null, userId);
      case "dispute_expense": {
        const comment = String(args.comment ?? "").trim();
        if (comment === "" || comment.length > 500) fail("22023", "a dispute needs a comment of 1 to 500 characters");
        return this.decideExpense(String(args.eid ?? ""), "disputed", comment, userId);
      }
      case "is_app_admin":
        return this.admins.has(userId);
      case "admin_list_families":
        this.requireAdmin(userId);
        return this.adminListFamilies();
      case "admin_list_users":
        this.requireAdmin(userId);
        return this.adminListUsers();
      case "admin_remove_member":
        this.requireAdmin(userId);
        return this.adminRemoveMember(String(args.p_family_id ?? ""), String(args.p_user_id ?? ""), userId);
      case "admin_delete_family":
        this.requireAdmin(userId);
        return this.adminDeleteFamily(String(args.p_family_id ?? ""), userId);
    }
    return fail("PGRST202", `Could not find the function public.${fn} in the schema cache`, 404);
  }

  private familyMembers(familyId: unknown): Row[] {
    return sortRows(
      this.tables.members.filter((m) => m.family_id === familyId),
      [{ column: "created_at", ascending: true }],
    );
  }

  /** Also used by the seed: create_family as `userId`. */
  createFamily(name: string, displayName: string, color: string, userId: string): string {
    if (this.tables.members.some((m) => m.user_id === userId)) fail("23505", "user already belongs to a family", 409);
    checkLength(name, 1, 80, "families_name_check");
    checkLength(displayName, 1, 40, "members_display_name_check");
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) fail("23514", 'new row violates check constraint "members_color_check"');
    const now = this.now().toISOString();
    const family: Row = {
      id: this.newId(),
      name: name.trim(),
      timezone: "Europe/Lisbon",
      currency: "EUR",
      default_payer_share_bps: 5000,
      created_at: now,
    };
    this.tables.families.push(family);
    this.tables.members.push({
      id: this.newId(),
      family_id: family.id,
      user_id: userId,
      display_name: displayName.trim(),
      color,
      role: "owner",
      created_at: now,
    });
    return String(family.id);
  }

  private createInvite(email: string | null | undefined, userId: string): { token: string; expires_at: string }[] {
    const familyId = this.tables.members.find((m) => m.user_id === userId)?.family_id;
    if (!familyId) fail("IV008", "caller has no family");
    if (this.familyMembers(familyId).length >= 2) fail("IV005", "family already has 2 members");
    const clean = email?.trim().toLowerCase() || null;
    if (clean !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) fail("23514", 'new row violates check constraint "invites_email_check"');
    this.tables.invites = this.tables.invites.filter((i) => !(i.family_id === familyId && i.accepted_at === null));
    const now = this.now();
    const invite: Row = {
      id: this.newId(),
      family_id: familyId,
      email: clean,
      token: (this.newId() + this.newId()).replace(/-/g, ""),
      expires_at: new Date(now.getTime() + 7 * DAY_MS).toISOString(),
      accepted_at: null,
      accepted_by: null,
      created_by: userId,
      created_at: now.toISOString(),
    };
    this.tables.invites.push(invite);
    return [{ token: String(invite.token), expires_at: String(invite.expires_at) }];
  }

  private getInvite(token: string): Row[] {
    const invite = this.tables.invites.find((i) => i.token === token);
    if (!invite) return [];
    const family = this.tables.families.find((f) => f.id === invite.family_id);
    const members = this.familyMembers(invite.family_id);
    const status =
      invite.accepted_at !== null
        ? "accepted"
        : members.length >= 2
          ? "full"
          : Date.parse(String(invite.expires_at)) <= this.now().getTime()
            ? "expired"
            : "valid";
    return [
      {
        family_name: family?.name ?? null,
        inviter_name: members[0]?.display_name ?? null,
        invited_email: invite.email,
        status,
        expires_at: invite.expires_at,
        taken_colors: members.map((m) => m.color),
      },
    ];
  }

  private acceptInvite(token: string, displayName: string, color: string, userId: string): string {
    if (this.tables.members.some((m) => m.user_id === userId)) fail("IV007", "user already belongs to a family");
    const invite = this.tables.invites.find((i) => i.token === token);
    if (!invite) fail("IV001", "invite not found");
    if (invite.accepted_at !== null) fail("IV002", "invite already used");
    if (Date.parse(String(invite.expires_at)) <= this.now().getTime()) fail("IV003", "invite expired");
    const email = this.users.find((u) => u.id === userId)?.email.toLowerCase();
    if (invite.email !== null && invite.email !== email) fail("IV004", "invite is for another e-mail");
    const members = this.familyMembers(invite.family_id);
    if (members.length >= 2) fail("IV005", "family already has 2 members");
    if (members.some((m) => String(m.color).toLowerCase() === color.toLowerCase())) fail("IV006", "color already used");
    checkLength(displayName, 1, 40, "members_display_name_check");
    const now = this.now().toISOString();
    this.tables.members.push({
      id: this.newId(),
      family_id: invite.family_id,
      user_id: userId,
      display_name: displayName.trim(),
      color,
      role: "member",
      created_at: now,
    });
    Object.assign(invite, { accepted_at: now, accepted_by: userId });
    return String(invite.family_id);
  }

  /** decide_expense (20261014000800): only the member who did not pay decides. */
  private decideExpense(id: string, status: "confirmed" | "disputed", comment: string | null, userId: string): Row {
    const expense = this.tables.expenses.find((e) => e.id === id && e.deleted_at === null);
    if (!expense || !this.memberOf(userId, expense.family_id)) fail("P0002", "expense not found", 404);
    const me = this.memberOf(userId, expense.family_id);
    if (me?.id === expense.paid_by) fail("42501", "only the other member can decide this expense", 403);
    if (expense.status !== "pending" && expense.status !== "disputed") fail("55000", `expense is already ${String(expense.status)}`);
    const now = this.now().toISOString();
    const row = this.updateRow(
      "expenses",
      expense,
      { status, dispute_comment: comment, decided_by: userId, decided_at: now, updated_at: now },
      userId,
      true,
    );
    return structuredClone(row);
  }

  // --- platform admin (20261103000100_app_admins.sql) -------------------------------------------

  private requireAdmin(userId: string) {
    if (!this.admins.has(userId)) fail("42501", "admin only", 403);
  }

  private adminListFamilies(): Row[] {
    const stampsOf = (table: string, familyId: unknown, column: string) =>
      this.tables[table].filter((r) => r.family_id === familyId).map((r) => String(r[column]));
    const families = sortRows(this.tables.families, [{ column: "created_at", ascending: false }]);
    return families.map((f) => {
      const expenses = this.tables.expenses.filter((e) => e.family_id === f.id && e.deleted_at === null);
      const stamps = [
        String(f.created_at),
        ...stampsOf("members", f.id, "created_at"),
        ...stampsOf("children", f.id, "created_at"),
        ...stampsOf("custody_rules", f.id, "created_at"),
        ...stampsOf("custody_overrides", f.id, "created_at"),
        ...stampsOf("expense_audit", f.id, "changed_at"),
        ...stampsOf("settlements", f.id, "created_at"),
      ];
      return {
        id: f.id,
        name: f.name,
        currency: f.currency,
        timezone: f.timezone,
        created_at: f.created_at,
        members: this.familyMembers(f.id).map((m) => ({
          member_id: m.id,
          user_id: m.user_id,
          email: this.users.find((u) => u.id === m.user_id)?.email ?? null,
          display_name: m.display_name,
          color: m.color,
          role: m.role,
          joined_at: m.created_at,
        })),
        children_count: this.tables.children.filter((c) => c.family_id === f.id).length,
        expenses_count: expenses.length,
        open_expenses_count: expenses.filter((e) => e.status === "pending" || e.status === "disputed").length,
        last_activity_at: stamps.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a)),
      };
    });
  }

  private adminListUsers(): Row[] {
    const users = sortRows(this.users as Row[], [{ column: "created_at", ascending: false }]);
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      created_at: u.created_at ?? null,
      last_sign_in_at: u.last_sign_in_at ?? null,
      is_admin: this.admins.has(String(u.id)),
      families: this.tables.members
        .filter((m) => m.user_id === u.id)
        .map((m) => this.tables.families.find((f) => f.id === m.family_id))
        .filter((f): f is Row => Boolean(f))
        .map((f) => ({ id: f.id, name: f.name })),
    }));
  }

  private logAdminAction(adminId: string, action: string, target: Row) {
    this.adminActions.push({ id: this.newId(), admin_id: adminId, action, target, at: this.now().toISOString() });
  }

  private adminRemoveMember(familyId: string, userId: string, adminId: string): null {
    const family = this.tables.families.find((f) => f.id === familyId);
    if (!family) fail("P0002", "family not found", 404);
    const member = this.tables.members.find((m) => m.family_id === familyId && m.user_id === userId);
    if (!member) fail("P0002", "member not found", 404);
    const referenced =
      this.tables.expenses.some((e) => e.family_id === familyId && e.paid_by === member.id) ||
      this.tables.settlements.some((s) => s.family_id === familyId && (s.from_member === member.id || s.to_member === member.id));
    if (referenced) fail("AD001", "member has expenses or settlements", 409);
    this.logAdminAction(adminId, "remove_member", {
      family_id: familyId,
      family_name: family.name,
      user_id: userId,
      email: this.users.find((u) => u.id === userId)?.email ?? null,
      display_name: member.display_name,
    });
    this.tables.invites = this.tables.invites.filter(
      (i) => !(i.family_id === familyId && i.created_by === userId && i.accepted_at === null),
    );
    // ON DELETE CASCADE of the composite member foreign keys.
    this.tables.custody_rules = this.tables.custody_rules.filter((r) => r.first_member_id !== member.id);
    this.tables.custody_overrides = this.tables.custody_overrides.filter((o) => o.member_id !== member.id);
    this.tables.members = this.tables.members.filter((m) => m !== member);
    return null;
  }

  private adminDeleteFamily(familyId: string, adminId: string): null {
    const family = this.tables.families.find((f) => f.id === familyId);
    if (!family) fail("P0002", "family not found", 404);
    this.logAdminAction(adminId, "delete_family", {
      family_id: familyId,
      family_name: family.name,
      members: this.familyMembers(familyId).map((m) => ({
        user_id: m.user_id,
        email: this.users.find((u) => u.id === m.user_id)?.email ?? null,
        display_name: m.display_name,
      })),
      expenses: this.tables.expenses.filter((e) => e.family_id === familyId).length,
      settlements: this.tables.settlements.filter((x) => x.family_id === familyId).length,
    });
    for (const table of TABLES) {
      const key = table === "families" ? "id" : "family_id";
      this.tables[table] = this.tables[table].filter((r) => r[key] !== familyId);
    }
    // Receipt files stay until the app removes them through storage (as with real Storage).
    return null;
  }

  // --- storage --------------------------------------------------------------------------------

  private storage(request: StorageRequest, userId: string | null): DemoResult {
    if (request.bucket !== RECEIPT_BUCKET) fail("404", "Bucket not found", 404);
    const allowed = (path: string) => this.familiesOf(userId).has(path.split("/")[0]);
    // "receipts: admins read" / "receipts: admins remove" (20261103000100).
    const isAdmin = userId !== null && this.admins.has(userId);
    switch (request.op) {
      case "upload": {
        if (!allowed(request.path)) fail("403", "new row violates row-level security policy", 403);
        if (this.objects.has(request.path) && !request.upsert) fail("409", "The resource already exists", 409);
        if (request.contentType !== "image/jpeg") fail("415", `mime type ${request.contentType} is not supported`, 415);
        if (Math.floor((request.base64.length * 3) / 4) > RECEIPT_SIZE_LIMIT) fail("413", "The object exceeded the maximum allowed size", 413);
        this.objects.set(request.path, { contentType: request.contentType, base64: request.base64 });
        return { data: { path: request.path, id: request.path, fullPath: `${request.bucket}/${request.path}` }, error: null, status: 200 };
      }
      case "remove": {
        const removed = request.paths.filter((p) => (allowed(p) || isAdmin) && this.objects.delete(p));
        return { data: removed.map((name) => ({ name, bucket_id: request.bucket })), error: null, status: 200 };
      }
      case "list": {
        const prefix = `${request.path.replace(/\/+$/, "")}/`;
        const names = [...this.objects.keys()]
          .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/") && (allowed(p) || isAdmin))
          .map((p) => p.slice(prefix.length))
          .sort()
          .slice(0, request.limit);
        return { data: names.map((name) => ({ name, id: `${prefix}${name}` })), error: null, status: 200 };
      }
      case "createSignedUrl": {
        if (!allowed(request.path) || !this.objects.has(request.path)) fail("404", "Object not found", 404);
        return { data: { signedUrl: `/api/demo/receipt?path=${encodeURIComponent(request.path)}` }, error: null, status: 200 };
      }
    }
  }

  /** A stored receipt the user may read, for /api/demo/receipt. */
  readObject(path: string, userId: string | null): { contentType: string; bytes: Buffer } | null {
    const object = this.objects.get(path);
    if (!object || !this.familiesOf(userId).has(path.split("/")[0])) return null;
    return { contentType: object.contentType, bytes: Buffer.from(object.base64, "base64") };
  }
}

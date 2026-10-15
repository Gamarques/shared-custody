import { describe, expect, it } from "vitest";
import { formatCents } from "./money";
import { buildHistory, changedByName, entryTitle, fieldChanges, type AuditRow, type HistoryContext } from "./expense-history";

const ctx: HistoryContext = {
  currency: "EUR",
  timeZone: "Europe/Lisbon",
  memberNames: { m1: "Ana", m2: "Bruno" },
  userNames: { u1: "Ana", u2: "Bruno" },
};

const eur = (cents: number) => formatCents(cents, "EUR");

const base = {
  id: "e1",
  family_id: "f1",
  paid_by: "m1",
  amount_cents: 10000,
  spent_on: "2026-10-10",
  description: "Material escolar",
  category: "escola",
  payer_share_bps: 5000,
  receipt_path: null,
  status: "pending",
  dispute_comment: null,
  created_by: "u1",
  created_at: "2026-10-10T09:00:00+00:00",
  updated_at: "2026-10-10T09:00:00+00:00",
  deleted_at: null,
};

describe("fieldChanges", () => {
  it("lists the filled-in values of a new expense", () => {
    expect(fieldChanges(null, base, ctx)).toEqual([
      { label: "Valor", from: null, to: eur(10000) },
      { label: "Data", from: null, to: "10/10/2026" },
      { label: "Descrição", from: null, to: "Material escolar" },
      { label: "Categoria", from: null, to: "Escola" },
      { label: "Quem pagou", from: null, to: "Ana" },
      { label: "Parte de quem pagou", from: null, to: "50%" },
      { label: "Situação", from: null, to: "Pendente" },
    ]);
  });

  it("lists only what changed, with before and after", () => {
    const after = { ...base, amount_cents: 12345, payer_share_bps: 3333, paid_by: "m2", updated_at: "2026-10-11T00:00:00Z" };
    expect(fieldChanges(base, after, ctx)).toEqual([
      { label: "Valor", from: eur(10000), to: eur(12345) },
      { label: "Quem pagou", from: "Ana", to: "Bruno" },
      { label: "Parte de quem pagou", from: "50%", to: "33,33%" },
    ]);
  });

  it("describes receipts as attached, replaced or removed, never by path", () => {
    const a = { ...base, receipt_path: "f1/a.jpg" };
    const b = { ...base, receipt_path: "f1/b.jpg" };
    expect(fieldChanges(base, a, ctx)).toEqual([{ label: "Comprovante", from: "sem comprovante", to: "anexado" }]);
    expect(fieldChanges(a, b, ctx)).toEqual([{ label: "Comprovante", from: "anexado", to: "substituído" }]);
    expect(fieldChanges(b, base, ctx)).toEqual([{ label: "Comprovante", from: "anexado", to: "sem comprovante" }]);
  });

  it("shows a dispute with its comment", () => {
    const after = { ...base, status: "disputed", dispute_comment: "valor errado" };
    expect(fieldChanges(base, after, ctx)).toEqual([
      { label: "Situação", from: "Pendente", to: "Contestada" },
      { label: "Motivo da contestação", from: "—", to: "valor errado" },
    ]);
  });

  it("ignores bookkeeping columns", () => {
    const after = { ...base, updated_at: "x", decided_at: "y", decided_by: "u2", deleted_at: "2026-10-12T00:00:00Z" };
    expect(fieldChanges(base, after, ctx)).toEqual([]);
  });

  it("names a payer who left the family", () => {
    expect(fieldChanges(base, { ...base, paid_by: "gone" }, ctx)[0].to).toBe("responsável removido");
  });
});

describe("entryTitle", () => {
  const row = (action: AuditRow["action"], before: object | null, after: object) =>
    entryTitle({ action, old_data: before as AuditRow["old_data"], new_data: after as AuditRow["new_data"] });

  it("names creation, edit, deletion, restoration and decisions", () => {
    expect(row("insert", null, base)).toBe("Criou a despesa");
    expect(row("update", base, { ...base, description: "x" })).toBe("Alterou a despesa");
    expect(row("delete", base, { ...base, deleted_at: "2026-10-12T00:00:00Z" })).toBe("Excluiu a despesa");
    expect(row("update", { ...base, deleted_at: "2026-10-12T00:00:00Z" }, base)).toBe("Restaurou a despesa");
    expect(row("update", base, { ...base, status: "confirmed" })).toBe("Confirmou a despesa");
    expect(row("update", base, { ...base, status: "disputed", dispute_comment: "x" })).toBe("Contestou a despesa");
    // An edit that sends a confirmed expense back to pending (business rule 5) is an edit.
    expect(row("update", { ...base, status: "confirmed" }, { ...base, status: "pending", amount_cents: 1 })).toBe(
      "Alterou a despesa",
    );
  });
});

describe("changedByName", () => {
  it("uses the member name, or says who it was when unknown", () => {
    expect(changedByName("u2", ctx.userNames)).toBe("Bruno");
    expect(changedByName("u9", ctx.userNames)).toBe("Responsável removido");
    expect(changedByName(null, ctx.userNames)).toBe("Sistema");
  });
});

describe("buildHistory", () => {
  it("keeps the given order and formats time in the family zone", () => {
    const rows: AuditRow[] = [
      { seq: 2, action: "update", changed_by: "u2", changed_at: "2026-10-11T17:30:00+00:00", old_data: base, new_data: { ...base, status: "confirmed" } },
      { seq: 1, action: "insert", changed_by: "u1", changed_at: "2026-01-05T09:00:00+00:00", old_data: null, new_data: base },
    ];
    const items = buildHistory(rows, ctx);
    expect(items.map((i) => [i.key, i.title, i.who, i.when])).toEqual([
      ["2", "Confirmou a despesa", "Bruno", "11/10/2026 18:30"], // summer time, UTC+1
      ["1", "Criou a despesa", "Ana", "05/01/2026 09:00"], // winter time, UTC+0
    ]);
    expect(items[0].changes).toEqual([{ label: "Situação", from: "Pendente", to: "Confirmada" }]);
  });

  it("a deletion has no field changes of its own", () => {
    const [item] = buildHistory(
      [{ seq: 3, action: "delete", changed_by: "u1", changed_at: "2026-10-12T10:00:00Z", old_data: base, new_data: { ...base, deleted_at: "2026-10-12T10:00:00Z" } }],
      ctx,
    );
    expect(item.title).toBe("Excluiu a despesa");
    expect(item.changes).toEqual([]);
  });
});

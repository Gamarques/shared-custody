import { describe, expect, it } from "vitest";
import { adminErrorMessage, adminTab, confirmsFamilyName, formatAdminDateTime, plural } from "./admin";

describe("admin helpers", () => {
  it("maps the admin RPC error codes", () => {
    expect(adminErrorMessage("42501")).toMatch(/permissões de administrador/);
    expect(adminErrorMessage("P0002")).toMatch(/Já não existe/);
    expect(adminErrorMessage("AD001")).toMatch(/elimina a família/);
    expect(adminErrorMessage(undefined)).toBe("Não foi possível concluir. Tenta novamente.");
  });

  it("confirms the family name only when typed exactly (case and outer spaces aside)", () => {
    expect(confirmsFamilyName("Família Silva", "Família Silva")).toBe(true);
    expect(confirmsFamilyName("  família silva ", "Família Silva")).toBe(true);
    expect(confirmsFamilyName("Familia Silva", "Família Silva")).toBe(false);
    expect(confirmsFamilyName("", "")).toBe(false);
    expect(confirmsFamilyName("Família", "Família Silva")).toBe(false);
  });

  it("picks the tab from the query string", () => {
    expect(adminTab("utilizadores")).toBe("utilizadores");
    expect(adminTab(undefined)).toBe("familias");
    expect(adminTab(["utilizadores"])).toBe("familias");
  });

  it("formats dates in Lisbon time", () => {
    expect(formatAdminDateTime("2026-07-01T12:05:00Z")).toBe("01/07/2026, 13:05");
    expect(formatAdminDateTime(null)).toBe("—");
    expect(formatAdminDateTime("nope")).toBe("—");
    expect(plural(1, "família", "famílias")).toBe("1 família");
    expect(plural(3, "família", "famílias")).toBe("3 famílias");
  });
});

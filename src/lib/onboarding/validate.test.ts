import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MEMBER_COLORS, validateOnboarding } from "./validate";

const ok = { familyName: "Família Silva", displayName: "Ana", color: MEMBER_COLORS[0] };

describe("validateOnboarding", () => {
  it("accepts valid input", () => {
    expect(validateOnboarding(ok)).toEqual({});
  });
  it("rejects blank and too long names", () => {
    expect(validateOnboarding({ ...ok, familyName: "   " }).familyName).toBeDefined();
    expect(validateOnboarding({ ...ok, displayName: "x".repeat(41) }).displayName).toBeDefined();
    expect(validateOnboarding({ ...ok, familyName: "x".repeat(81) }).familyName).toBeDefined();
  });
  it("rejects invalid colors", () => {
    for (const color of ["red", "#fff", "#gggggg", ""]) {
      expect(validateOnboarding({ ...ok, color }).color).toBeDefined();
    }
  });
  it("all palette colors are valid", () => {
    for (const color of MEMBER_COLORS) expect(validateOnboarding({ ...ok, color })).toEqual({});
  });
});

describe("families/members migration (static checks; no live DB)", () => {
  const sql = readFileSync("supabase/migrations/20261014000100_families_members.sql", "utf8");

  it("enables RLS on both tables", () => {
    expect(sql).toMatch(/alter table shared_custody\.families enable row level security/);
    expect(sql).toMatch(/alter table shared_custody\.members enable row level security/);
  });
  it("has no insert, delete or all policies (writes go through create_family)", () => {
    expect(sql).not.toMatch(/create policy[^;]*for (insert|delete|all)/i);
  });
  it("restricts create_family to authenticated users", () => {
    expect(sql).toMatch(/revoke all on function shared_custody\.create_family[^;]*from public, anon/);
    expect(sql).toMatch(/grant execute on function shared_custody\.create_family[^;]*to authenticated/);
  });
  it("limits families to 2 members and one family per user", () => {
    expect(sql).toMatch(/>= 2/);
    expect(sql).toMatch(/user_id uuid not null unique/);
  });
});

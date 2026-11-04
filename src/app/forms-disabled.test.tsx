import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The forms as first rendered (server HTML, before hydration): the submit button is disabled while
// the required fields are empty, and enabled once they are filled. The rules are in
// src/lib/forms/ready.ts (tested there field by field).

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }) }));

import { RuleForm } from "./guarda/RuleForm";
import { OverrideForm } from "./excecoes/OverrideForm";
import { SettlementForm } from "./saldo/SettlementForm";
import { DecisionButtons } from "./despesas/DecisionButtons";
import { ExpenseForm } from "./despesas/nova/ExpenseForm";
import { OnboardingForm } from "./onboarding/OnboardingForm";
import { AcceptInviteForm } from "./convite/[token]/AcceptInviteForm";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcd1234.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
});
afterEach(() => vi.unstubAllEnvs());

const submit = (html: string) => html.match(/<button type="submit"[^>]*>/)?.[0] ?? "";
const members = [
  { id: "m1", name: "Ana" },
  { id: "m2", name: "Bruno" },
];

describe("submit stays disabled until the required fields have content", () => {
  it("expense: empty amount and description disable it; filled enables it", () => {
    const base = { amount: "", spentOn: "2026-10-15", description: "", category: "outros", paidBy: "m1", payerPercent: "50" };
    const props = { familyId: "f1", currency: "EUR", today: "2026-10-15", members, defaultShareBps: 5000 };
    expect(submit(renderToStaticMarkup(<ExpenseForm {...props} initial={base} />))).toContain('disabled=""');
    const filled = { ...base, amount: "12,50", description: "Dentista" };
    expect(submit(renderToStaticMarkup(<ExpenseForm {...props} initial={filled} />))).not.toContain("disabled");
    const blank = { ...filled, description: "   " };
    expect(submit(renderToStaticMarkup(<ExpenseForm {...props} initial={blank} />))).toContain('disabled=""');
  });

  it("settlement: no amount (or zero) disables it", () => {
    const props = { familyId: "f1", today: "2026-10-15", members: [{ id: "m1", display_name: "Ana" }, { id: "m2", display_name: "Bruno" }] };
    const form = { amount: "", settledOn: "2026-10-15", fromMember: "m1", note: "" };
    expect(submit(renderToStaticMarkup(<SettlementForm {...props} initial={form} />))).toContain('disabled=""');
    expect(submit(renderToStaticMarkup(<SettlementForm {...props} initial={{ ...form, amount: "0,00" }} />))).toContain('disabled=""');
    expect(submit(renderToStaticMarkup(<SettlementForm {...props} initial={{ ...form, amount: "6,00" }} />))).not.toContain("disabled");
  });

  it("override: no reason disables it", () => {
    const form = { memberId: "m2", startDate: "2026-12-24", startTime: "10:00", endDate: "2026-12-26", endTime: "18:00", reason: "" };
    const props = { familyId: "f1", timezone: "Europe/Lisbon", members };
    expect(submit(renderToStaticMarkup(<OverrideForm {...props} initial={form} />))).toContain('disabled=""');
    expect(submit(renderToStaticMarkup(<OverrideForm {...props} initial={{ ...form, reason: "Feriado" }} />))).not.toContain("disabled");
  });

  it("custody rule: a missing time disables it; the prefilled rule is ready", () => {
    const form = { firstMemberId: "m1", startsOn: "2026-10-18", handoverWeekday: 0, handoverTime: "18:00", validFrom: null };
    const props = { familyId: "f1", members, today: "2026-10-15" };
    expect(submit(renderToStaticMarkup(<RuleForm {...props} initial={form} />))).not.toContain("disabled");
    expect(submit(renderToStaticMarkup(<RuleForm {...props} initial={{ ...form, handoverTime: "" }} />))).toContain('disabled=""');
  });

  it("onboarding and invite acceptance start disabled (names are empty)", () => {
    expect(submit(renderToStaticMarkup(<OnboardingForm />))).toContain('disabled=""');
    expect(submit(renderToStaticMarkup(<AcceptInviteForm token="t" takenColors={[]} />))).toContain('disabled=""');
  });

  it("decision: Confirmar needs no field; the dispute form is opened by Contestar", () => {
    const html = renderToStaticMarkup(<DecisionButtons expenseId="e1" />);
    expect(html).toMatch(/<button type="button" class="btn btn-primary btn-sm">Confirmar<\/button>/);
    expect(html).toContain(">Contestar</button>");
  });
});

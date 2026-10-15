import { describe, expect, it } from "vitest";
import { splitExpense } from "@/lib/expenses/money";
import { computeBalance, expenseNetCents, toDebt, type BalanceExpense, type BalanceSettlement } from "./balance";

// T-19 / RF-13, RNF-09: balance between the two members, in integer cents.

const ANA = "ana";
const BRUNO = "bruno";

function expense(patch: Partial<BalanceExpense>): BalanceExpense {
  return { paid_by: ANA, amount_cents: 1000, payer_share_bps: 5000, status: "pending", spent_on: "2026-10-10", ...patch };
}

function settlement(patch: Partial<BalanceSettlement>): BalanceSettlement {
  return { from_member: ANA, to_member: BRUNO, amount_cents: 100, settled_on: "2026-10-20", ...patch };
}

/** The "Exemplo de saldo" table of docs/plano-mvp.md. */
const EXAMPLE = [
  expense({ paid_by: ANA, amount_cents: 100_00, payer_share_bps: 5000 }), // Material escolar: Bruno owes 50,00
  expense({ paid_by: BRUNO, amount_cents: 80_00, payer_share_bps: 3000 }), // Dentista: Ana owes 56,00
];

describe("computeBalance: the example of the business rules", () => {
  it("Material escolar 100,00 (Ana, 50%) and Dentista 80,00 (Bruno, 30%): Ana owes Bruno 6,00", () => {
    const b = computeBalance(ANA, BRUNO, EXAMPLE, []);
    expect(b).toEqual({
      debtor: ANA,
      creditor: BRUNO,
      amountCents: 6_00,
      netCents: 6_00,
      disputed: { debtor: null, creditor: null, amountCents: 0, netCents: 0, count: 0 },
      expenseCount: 2,
    });
  });

  it("matches each 'valor devido' line of the table", () => {
    expect(expenseNetCents(ANA, BRUNO, EXAMPLE[0])).toBe(-50_00); // Bruno owes Ana 50,00
    expect(expenseNetCents(ANA, BRUNO, EXAMPLE[1])).toBe(56_00); // Ana owes Bruno 56,00
  });

  it("gives the same debt whichever member is A", () => {
    const b = computeBalance(BRUNO, ANA, EXAMPLE, []);
    expect(b).toMatchObject({ debtor: ANA, creditor: BRUNO, amountCents: 6_00, netCents: -6_00 });
  });

  it("a 6,00 settlement from Ana to Bruno closes it exactly", () => {
    const b = computeBalance(ANA, BRUNO, EXAMPLE, [settlement({ amount_cents: 6_00 })]);
    expect(b).toMatchObject({ debtor: null, creditor: null, amountCents: 0, netCents: 0 });
  });
});

describe("computeBalance: closes to the cent", () => {
  it("rounds each expense once, half up, and the other member takes the rest", () => {
    // 0,01 at 50%: payer 0,01 (half up), other 0,00.
    expect(expenseNetCents(ANA, BRUNO, expense({ amount_cents: 1, payer_share_bps: 5000 }))).toBe(0);
    // 0,03 at 50%: payer 0,02, other 0,01.
    expect(expenseNetCents(ANA, BRUNO, expense({ amount_cents: 3, payer_share_bps: 5000 }))).toBe(-1);
    // 100,00 at 33,33%: payer 33,33, other 66,67.
    expect(expenseNetCents(ANA, BRUNO, expense({ amount_cents: 100_00, payer_share_bps: 3333 }))).toBe(-66_67);
    // 10,01 at 12,5%: payer 1,25125 -> 1,25, other 8,76.
    expect(expenseNetCents(ANA, BRUNO, expense({ amount_cents: 10_01, payer_share_bps: 1250 }))).toBe(-8_76);
  });

  it("three 10,00 expenses at 33,33% each round per expense, never on the sum", () => {
    const rows = [1, 2, 3].map(() => expense({ paid_by: BRUNO, amount_cents: 10_00, payer_share_bps: 3333 }));
    // Each: payer 3,33, Ana 6,67; total 20,01 (not 30,00 × 66,67% = 20,001 rounded to 20,00).
    expect(computeBalance(ANA, BRUNO, rows, [])).toMatchObject({ debtor: ANA, amountCents: 20_01 });
  });

  it("0% and 100% payer shares", () => {
    expect(expenseNetCents(ANA, BRUNO, expense({ amount_cents: 12_34, payer_share_bps: 0 }))).toBe(-12_34);
    expect(expenseNetCents(ANA, BRUNO, expense({ amount_cents: 12_34, payer_share_bps: 10000 }))).toBe(0);
  });

  it("random families: the two burdens add up to the total spent and the balance matches them", () => {
    let seed = 19;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    for (let round = 0; round < 300; round++) {
      const rows = Array.from({ length: 1 + rand(40) }, () =>
        expense({ paid_by: rand(2) ? ANA : BRUNO, amount_cents: 1 + rand(100_000_00), payer_share_bps: rand(10001) }),
      );
      let total = 0;
      let anaPaid = 0;
      let anaBurden = 0;
      let brunoBurden = 0;
      for (const r of rows) {
        const { payerCents, otherCents } = splitExpense(r.amount_cents, r.payer_share_bps);
        expect(Number.isInteger(payerCents) && Number.isInteger(otherCents)).toBe(true);
        expect(payerCents + otherCents).toBe(r.amount_cents);
        total += r.amount_cents;
        if (r.paid_by === ANA) {
          anaPaid += r.amount_cents;
          anaBurden += payerCents;
          brunoBurden += otherCents;
        } else {
          anaBurden += otherCents;
          brunoBurden += payerCents;
        }
      }
      const b = computeBalance(ANA, BRUNO, rows, []);
      expect(anaBurden + brunoBurden).toBe(total);
      // What Ana owes is her burden minus what she already paid.
      expect(b.netCents).toBe(anaBurden - anaPaid);
      expect(Number.isInteger(b.netCents)).toBe(true);
    }
  });
});

describe("computeBalance: statuses, deletion and settlements", () => {
  it("pending and confirmed expenses count; disputed ones go to the 'em disputa' line", () => {
    const rows = [
      expense({ paid_by: ANA, amount_cents: 20_00, status: "confirmed" }), // Bruno owes 10,00
      expense({ paid_by: ANA, amount_cents: 6_00, status: "pending" }), // Bruno owes 3,00
      expense({ paid_by: BRUNO, amount_cents: 50_00, payer_share_bps: 2000, status: "disputed" }), // Ana owes 40,00
      expense({ paid_by: ANA, amount_cents: 10_00, status: "disputed" }), // Bruno owes 5,00
    ];
    const b = computeBalance(ANA, BRUNO, rows, []);
    expect(b).toMatchObject({ debtor: BRUNO, creditor: ANA, amountCents: 13_00, expenseCount: 2 });
    expect(b.disputed).toEqual({ debtor: ANA, creditor: BRUNO, amountCents: 35_00, netCents: 35_00, count: 2 });
  });

  it("ignores logically deleted expenses, whatever their status", () => {
    const rows = [
      ...EXAMPLE,
      expense({ paid_by: ANA, amount_cents: 999_00, deleted_at: "2026-10-11T10:00:00Z" }),
      expense({ paid_by: BRUNO, amount_cents: 999_00, status: "disputed", deleted_at: "2026-10-11T10:00:00Z" }),
    ];
    const b = computeBalance(ANA, BRUNO, rows, []);
    expect(b).toMatchObject({ debtor: ANA, amountCents: 6_00, expenseCount: 2 });
    expect(b.disputed.count).toBe(0);
  });

  it("settlements from A to B lower what A owes; from B to A raise it; they can flip the debt", () => {
    expect(computeBalance(ANA, BRUNO, EXAMPLE, [settlement({ amount_cents: 2_50 })])).toMatchObject({
      debtor: ANA,
      amountCents: 3_50,
    });
    expect(
      computeBalance(ANA, BRUNO, EXAMPLE, [settlement({ from_member: BRUNO, to_member: ANA, amount_cents: 4_00 })]),
    ).toMatchObject({ debtor: ANA, amountCents: 10_00 });
    expect(computeBalance(ANA, BRUNO, EXAMPLE, [settlement({ amount_cents: 10_00 })])).toMatchObject({
      debtor: BRUNO,
      creditor: ANA,
      amountCents: 4_00,
      netCents: -4_00,
    });
  });

  it("settlements never touch the 'em disputa' line", () => {
    const rows = [expense({ paid_by: BRUNO, amount_cents: 10_00, status: "disputed" })];
    const b = computeBalance(ANA, BRUNO, rows, [settlement({ amount_cents: 5_00 })]);
    expect(b.disputed).toMatchObject({ debtor: ANA, amountCents: 5_00 });
    expect(b).toMatchObject({ debtor: BRUNO, amountCents: 5_00 });
  });

  it("no rows: even", () => {
    expect(computeBalance(ANA, BRUNO, [], [])).toMatchObject({ debtor: null, creditor: null, amountCents: 0 });
  });
});

describe("computeBalance: period", () => {
  const rows = [
    expense({ paid_by: ANA, amount_cents: 10_00, spent_on: "2026-09-30" }), // before
    expense({ paid_by: ANA, amount_cents: 20_00, spent_on: "2026-10-01" }), // first day: in
    expense({ paid_by: ANA, amount_cents: 40_00, spent_on: "2026-10-31" }), // last day: in
    expense({ paid_by: ANA, amount_cents: 80_00, spent_on: "2026-11-01" }), // end is exclusive
  ];
  const settlements = [
    settlement({ from_member: BRUNO, to_member: ANA, amount_cents: 1_00, settled_on: "2026-10-15" }),
    settlement({ from_member: BRUNO, to_member: ANA, amount_cents: 2_00, settled_on: "2026-11-01" }),
  ];

  it("[from, to) on spent_on and settled_on", () => {
    const b = computeBalance(ANA, BRUNO, rows, settlements, { from: "2026-10-01", to: "2026-11-01" });
    // Bruno owes half of 20,00 + 40,00, minus the 1,00 he paid in October.
    expect(b).toMatchObject({ debtor: BRUNO, amountCents: 29_00, expenseCount: 2 });
  });

  it("open ends", () => {
    expect(computeBalance(ANA, BRUNO, rows, [], { to: "2026-10-01" })).toMatchObject({ amountCents: 5_00 });
    expect(computeBalance(ANA, BRUNO, rows, [], { from: "2026-11-01" })).toMatchObject({ amountCents: 40_00 });
    expect(computeBalance(ANA, BRUNO, rows, settlements)).toMatchObject({ amountCents: 72_00, expenseCount: 4 });
  });
});

describe("computeBalance: invalid input", () => {
  it("rejects the same member twice", () => {
    expect(() => computeBalance(ANA, ANA, [], [])).toThrow();
  });

  it("rejects an expense or settlement involving a third member", () => {
    expect(() => computeBalance(ANA, BRUNO, [expense({ paid_by: "carla" })], [])).toThrow(/carla/);
    expect(() => computeBalance(ANA, BRUNO, [], [settlement({ to_member: "carla" })])).toThrow(/carla/);
  });
});

describe("toDebt", () => {
  it("sign decides the debtor", () => {
    expect(toDebt(ANA, BRUNO, 1)).toEqual({ debtor: ANA, creditor: BRUNO, amountCents: 1 });
    expect(toDebt(ANA, BRUNO, -1)).toEqual({ debtor: BRUNO, creditor: ANA, amountCents: 1 });
    expect(toDebt(ANA, BRUNO, 0)).toEqual({ debtor: null, creditor: null, amountCents: 0 });
  });
});

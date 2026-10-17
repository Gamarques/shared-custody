/**
 * Seed data for demo mode, built through the store's own RPCs and writes (as Ana or Bruno,
 * with the clock moved to when each thing happened), so audit rows, statuses and defaults
 * come out exactly as the app would produce them.
 *
 * Dates are relative to "now" in the family's zone, so the demo always has a current month
 * with the plan's balance example ("Regras de negócio > Exemplo de saldo"):
 *   Material escolar 100,00 € paid by Ana, 50%  -> Bruno owes 50,00 €
 *   Dentista          80,00 € paid by Bruno, 30% -> Ana owes 56,00 €
 *   => Ana owes Bruno 6,00 €
 * plus a disputed expense (outside the balance), a deleted one (only in the audit), and last
 * month a pediatrician visit that a settlement paid off, so "Todo o período" is also 6,00 €.
 */
import { dayNumber, localDayTimeToInstant, parseTime, toWallClock } from "@/lib/custody/timezone";
import type { DemoRequest, Row } from "./fake-client";
import { DemoStore } from "./store";
import { DEMO_ANA, DEMO_BRUNO } from "./users";

export const DEMO_TIMEZONE = "Europe/Lisbon";

const DAY_MS = 86_400_000;

function isoDate(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Alternative data sets for visual QA (DEMO_VARIANT, see scripts/demo.mjs); "default" is the demo.
 *   no-family  Ana belongs to no family (/onboarding); Bruno owns one with a pending invite at DEMO_INVITE_TOKEN
 *   solo       Ana owns a family with no second member and no invite (/convidar offers a new link)
 *   empty      Ana and Bruno share a family with no children, rule, expenses, exceptions or settlements
 *   error      the default data, but reading `expenses` fails (load-error states)
 */
export type DemoVariant = "default" | "no-family" | "solo" | "empty" | "error";

/** Token of the pending invite in the "no-family" variant (64 hex chars, like a real one). */
export const DEMO_INVITE_TOKEN = "d3adbeef".repeat(8);

export function demoVariantFromEnv(value: string | undefined = process.env.DEMO_VARIANT): DemoVariant {
  return value === "no-family" || value === "solo" || value === "empty" || value === "error" ? value : "default";
}

export function createDemoStore(now: Date = new Date(), variant: DemoVariant = "default"): DemoStore {
  if (variant === "no-family" || variant === "solo" || variant === "empty") return createMinimalStore(now, variant);
  const store = createFullStore(now);
  if (variant === "error") store.failingTables.add("expenses");
  return store;
}

function createMinimalStore(now: Date, variant: "no-family" | "solo" | "empty"): DemoStore {
  const store = new DemoStore({ now: () => now });
  store.users.push({ ...DEMO_ANA }, { ...DEMO_BRUNO });
  if (variant === "no-family") {
    store.createFamily("Família Bruno", "Bruno", "#c2410c", DEMO_BRUNO.id);
    const [invite] = runRpc(store, "create_invite", { invite_email: null }, DEMO_BRUNO.id) as { token: string }[];
    store.tables.invites.find((i) => i.token === invite.token)!.token = DEMO_INVITE_TOKEN;
  } else if (variant === "solo") {
    store.createFamily("Família Silva Costa", "Ana", "#2f6f5e", DEMO_ANA.id);
  } else {
    store.createFamily("Família Silva Costa", "Ana", "#2f6f5e", DEMO_ANA.id);
    const [invite] = runRpc(store, "create_invite", { invite_email: DEMO_BRUNO.email }, DEMO_ANA.id) as { token: string }[];
    runRpc(store, "accept_invite", { invite_token: invite.token, member_display_name: "Bruno", member_color: "#c2410c" }, DEMO_BRUNO.id);
  }
  store.now = () => new Date();
  return store;
}

function createFullStore(now: Date): DemoStore {
  const realNow = now.getTime();
  let clock = realNow;
  const store = new DemoStore({ now: () => new Date(clock) });
  store.users.push({ ...DEMO_ANA }, { ...DEMO_BRUNO });

  const today = dayNumber(toWallClock(realNow, DEMO_TIMEZONE));
  const todayWall = toWallClock(realNow, DEMO_TIMEZONE);
  const monthStart = today - (todayWall.day - 1);
  const prevMonthStart = dayNumber({ year: todayWall.month === 1 ? todayWall.year - 1 : todayWall.year, month: todayWall.month === 1 ? 12 : todayWall.month - 1, day: 1 });
  /** Day `n` of the current month, never after today. */
  const thisMonth = (n: number) => Math.min(monthStart + n - 1, today);
  // Seed events never happen in the future; when several are clamped they keep their order.
  let last = 0;
  const at = (day: number, time: string) => {
    const wanted = localDayTimeToInstant(day, parseTime(time), DEMO_TIMEZONE);
    clock = Math.max(last + 60_000, Math.min(wanted, realNow - 3_600_000));
    last = clock;
  };

  const write = (userId: string, request: DemoRequest): Row => runSync(store, request, userId);

  // Family, members (Bruno joins through an invite) and child.
  const startWeek = today - new Date(today * DAY_MS).getUTCDay() - 8 * 7; // a Sunday 8+ weeks ago
  at(startWeek - 14, "21:00");
  const familyId = store.createFamily("Família Silva Costa", "Ana", "#2f6f5e", DEMO_ANA.id);
  const ana = store.tables.members.find((m) => m.user_id === DEMO_ANA.id)!;
  at(startWeek - 14, "21:05");
  const [invite] = runRpc(store, "create_invite", { invite_email: DEMO_BRUNO.email }, DEMO_ANA.id) as { token: string }[];
  at(startWeek - 13, "08:30");
  runRpc(store, "accept_invite", { invite_token: invite.token, member_display_name: "Bruno", member_color: "#c2410c" }, DEMO_BRUNO.id);
  const bruno = store.tables.members.find((m) => m.user_id === DEMO_BRUNO.id)!;
  at(startWeek - 13, "08:40");
  write(DEMO_ANA.id, insert("children", { family_id: familyId, name: "Leonor", birth_date: "2018-05-14" }));

  // Weekly rule: handover on Sundays at 18:00, Ana's week first.
  at(startWeek - 12, "22:00");
  write(DEMO_ANA.id, insert("custody_rules", { family_id: familyId, starts_on: isoDate(startWeek), first_member_id: ana.id, handover_weekday: 0, handover_time: "18:00" }));

  // Last month: pediatrician paid by Bruno, confirmed by Ana, then settled by Ana.
  const pediatra = write(DEMO_BRUNO.id, insertAt(at, prevMonthStart + 11, "19:00", "expenses", {
    family_id: familyId, paid_by: bruno.id, amount_cents: 6000, spent_on: isoDate(prevMonthStart + 11),
    description: "Consulta de pediatria", category: "saude", payer_share_bps: 5000,
  }));
  at(prevMonthStart + 12, "09:00");
  runRpc(store, "confirm_expense", { eid: pediatra.id }, DEMO_ANA.id);
  at(prevMonthStart + 19, "20:00");
  write(DEMO_ANA.id, insert("settlements", {
    family_id: familyId, from_member: ana.id, to_member: bruno.id, amount_cents: 3000,
    settled_on: isoDate(prevMonthStart + 19), note: "Metade da consulta de pediatria (MB Way)",
  }));

  // This month: the plan's example.
  const material = write(DEMO_ANA.id, insertAt(at, thisMonth(2), "18:30", "expenses", {
    family_id: familyId, paid_by: ana.id, amount_cents: 9500, spent_on: isoDate(thisMonth(2)),
    description: "Material escolar", category: "escola", payer_share_bps: 5000,
  }));
  at(thisMonth(2), "18:45"); // Ana fixes the amount: the history shows the edit
  write(DEMO_ANA.id, update("expenses", { amount_cents: 10000 }, material.id));
  at(thisMonth(3), "08:15");
  runRpc(store, "confirm_expense", { eid: material.id }, DEMO_BRUNO.id);

  write(DEMO_BRUNO.id, insertAt(at, thisMonth(5), "17:00", "expenses", {
    family_id: familyId, paid_by: bruno.id, amount_cents: 8000, spent_on: isoDate(thisMonth(5)),
    description: "Dentista", category: "saude", payer_share_bps: 3000,
  })); // pending: Ana can confirm or dispute it

  const tenis = write(DEMO_BRUNO.id, insertAt(at, thisMonth(7), "12:00", "expenses", {
    family_id: familyId, paid_by: bruno.id, amount_cents: 4500, spent_on: isoDate(thisMonth(7)),
    description: "Ténis de futebol", category: "vestuario", payer_share_bps: 5000,
  }));
  at(thisMonth(7), "21:00");
  runRpc(store, "dispute_expense", { eid: tenis.id, comment: "Já comprámos ténis no mês passado; não combinámos outros." }, DEMO_ANA.id);

  const cinema = write(DEMO_ANA.id, insertAt(at, thisMonth(8), "16:00", "expenses", {
    family_id: familyId, paid_by: ana.id, amount_cents: 1200, spent_on: isoDate(thisMonth(8)),
    description: "Cinema", category: "lazer", payer_share_bps: 5000,
  }));
  at(thisMonth(8), "16:10"); // registered by mistake: deleted, kept in the audit
  write(DEMO_ANA.id, update("expenses", { deleted_at: new Date(clock).toISOString() }, cinema.id));

  // Exception: Bruno takes Leonor tomorrow 10:00 until the day after at 20:00.
  at(today - 1, "20:00");
  write(DEMO_BRUNO.id, insert("custody_overrides", {
    family_id: familyId, member_id: bruno.id, reason: "Feriado com os avós",
    starts_at: new Date(localDayTimeToInstant(today + 1, parseTime("10:00"), DEMO_TIMEZONE)).toISOString(),
    ends_at: new Date(localDayTimeToInstant(today + 2, parseTime("20:00"), DEMO_TIMEZONE)).toISOString(),
  }));

  // From now on the store runs on the real clock.
  store.now = () => new Date();
  return store;
}

function insert(table: string, values: Row): DemoRequest {
  return { kind: "table", table, action: "insert", values, columns: "*", filters: [], order: [], single: "single" };
}

function update(table: string, values: Row, id: unknown): DemoRequest {
  return { kind: "table", table, action: "update", values, columns: "*", filters: [{ column: "id", op: "eq", value: id }], order: [], single: "single" };
}

function insertAt(at: (day: number, time: string) => void, day: number, time: string, table: string, values: Row): DemoRequest {
  at(day, time);
  return insert(table, values);
}

/** Runs a request synchronously (the store has no real I/O) and fails loudly on errors. */
function runSync(store: DemoStore, request: DemoRequest, userId: string): Row {
  const result = store.executeSync(request, userId);
  if (result.error) throw new Error(`Demo seed failed: ${result.error.message}`);
  return result.data as Row;
}

function runRpc(store: DemoStore, fn: string, args: Row, userId: string): unknown {
  return runSync(store, { kind: "rpc", fn, args }, userId);
}

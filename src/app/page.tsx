import Link from "next/link";
import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/env";
import { computeBalance, type Balance } from "@/lib/balance/balance";
import { countExpenses } from "@/lib/balance/balance-view";
import {
  addMonths,
  buildMonthCalendar,
  currentMonth,
  dayBackground,
  describeDay,
  formatMonth,
  MONTHS,
  WEEKDAY_HEADERS,
  type CalendarDay,
} from "@/lib/custody/calendar";
import { WEEKDAYS } from "@/lib/custody/rule-form";
import { toWallClock } from "@/lib/custody/timezone";
import { textColorOn, type HomeMember, type HomePerson, type TodayView } from "@/lib/custody/today";
import { monthDateRange, totalCents } from "@/lib/expenses/expense-list";
import { formatCents } from "@/lib/expenses/money";
import { HandoverCountdown } from "./HandoverCountdown";
import { loadFamilySnapshot, type FamilyRow } from "./_components/family-snapshot";
import { todayFromSnapshot } from "./_components/HolderChip";
import { Icon } from "./_components/Icon";
import { PageHeader, StatCard } from "./_components/ui";

// Per-user data that changes with the clock: never prerender.
export const dynamic = "force-dynamic";

function MemberBadge({ person, testId }: { person: HomePerson; testId: string }) {
  const style = person.color ? { background: person.color, color: textColorOn(person.color) } : undefined;
  return (
    <span className="member-badge" style={style} data-testid={testId} data-color={person.color ?? ""}>
      {person.name}
    </span>
  );
}

function capitalize(text: string): string {
  return text[0].toUpperCase() + text.slice(1);
}

type HomeData = {
  view: TodayView | null;
  nowMs: number;
  family: FamilyRow | null;
  meId: string | null;
};

async function loadHome(): Promise<HomeData> {
  const snap = await loadFamilySnapshot();
  if (!snap.user) redirect("/login");
  if (!snap.error && !snap.found) redirect("/onboarding");
  return { view: todayFromSnapshot(snap), nowMs: snap.nowMs, family: snap.family, meId: snap.me?.id ?? null };
}

/** "Quarta-feira, 14 de outubro" in the family zone. */
function describeToday(nowMs: number, timezone: string): string {
  const w = toWallClock(nowMs, timezone);
  const weekday = WEEKDAYS[new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay()];
  return `${weekday}, ${w.day} de ${MONTHS[w.month - 1].toLowerCase()}`;
}

type MonthStats = {
  monthName: string;
  expenseCount: number;
  expenseCents: number;
  balance: Balance | null;
  members: HomeMember[];
};

/** This month's expenses and balance (RF-13 arithmetic), from the rows the snapshot read. */
function monthStats(family: FamilyRow, nowMs: number): MonthStats {
  const ym = currentMonth(nowMs, family.timezone);
  const { from, to } = monthDateRange(formatMonth(ym));
  const inMonth = (date: string) => date >= from && date < to;
  const expenses = (family.expenses ?? []).filter((e) => inMonth(e.spent_on));
  const settlements = (family.settlements ?? []).filter((s) => inMonth(s.settled_on));
  const members = family.members ?? [];
  let balance: Balance | null = null;
  if (members.length >= 2) {
    try {
      balance = computeBalance(members[0].id, members[1].id, expenses, settlements, { from, to });
    } catch {
      balance = null; // a row that does not involve the two members: show no number rather than a wrong one
    }
  }
  return {
    monthName: MONTHS[ym.month - 1].toLowerCase(),
    expenseCount: expenses.length,
    expenseCents: totalCents(expenses),
    balance,
    members,
  };
}

/** Today and the next six days, from the month calendars (they may span two months). */
function upcomingWeek(family: FamilyRow, nowMs: number): CalendarDay[] {
  const input = {
    now: new Date(nowMs),
    timezone: family.timezone,
    members: family.members ?? [],
    rules: family.custody_rules ?? [],
    overrides: family.custody_overrides ?? [],
  };
  const ym = currentMonth(nowMs, family.timezone);
  const seen = new Set<string>();
  const days = [ym, addMonths(ym, 1)]
    .flatMap((month) => buildMonthCalendar({ ...input, month }).weeks.flat())
    .filter((d) => !seen.has(d.date) && seen.add(d.date));
  const today = days.findIndex((d) => d.isToday);
  return today < 0 ? [] : days.slice(today, today + 7);
}

function initialOf(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

function HeroCard({ view }: { view: TodayView }) {
  if (view.kind === "no-rule") {
    return (
      <section data-testid="today" className="card dash-hero dash-span-full">
        <div className="empty-state empty-state-inline">
          <span className="empty-state-icon">
            <Icon name="rule" size={22} />
          </span>
          <div>
            <p className="empty-state-title">A regra de guarda ainda não foi definida.</p>
            <p className="empty-state-text">
              Escolhe quem começa e o dia e a hora da troca semanal.
            </p>
          </div>
          <div className="empty-state-action">
            <Link href="/guarda" className="btn btn-primary">
              Definir a regra de guarda
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const current = view.current;
  const avatarStyle = current?.color ? { background: current.color, color: textColorOn(current.color) } : undefined;
  return (
    <section data-testid="today" className="card dash-hero">
      <h2 className="eyebrow">Hoje</h2>
      <div className="dash-hero-body">
        <span className="dash-hero-avatar" style={avatarStyle} aria-hidden="true">
          {current ? initialOf(current.name) : <Icon name="child" size={28} />}
        </span>
        {current ? (
          <p className="holder">
            {view.childName} está com <MemberBadge person={current} testId="current-holder" />
          </p>
        ) : (
          <p className="holder">A guarda ainda não começou.</p>
        )}
      </div>
      {current?.reason && (
        <p data-testid="override-reason" className="dash-hero-reason">
          <Icon name="exception" size={16} />
          Exceção: {current.reason}
        </p>
      )}
    </section>
  );
}

function NextHandoverCard({ view, nowMs }: { view: Extract<TodayView, { kind: "schedule" }>; nowMs: number }) {
  return (
    <section data-testid="next-handover" className="card dash-next">
      <h2 className="eyebrow">Próxima troca</h2>
      {view.next ? (
        <>
          <p className="countdown">
            <HandoverCountdown atMs={view.next.atMs} nowMs={nowMs} />
          </p>
          <p className="dash-next-when">
            {capitalize(view.next.when)}
            {view.next.to ? (
              <>
                , com <MemberBadge person={view.next.to} testId="next-holder" />
              </>
            ) : (
              ": a regra de guarda termina"
            )}
            .
          </p>
        </>
      ) : (
        <p className="dash-next-when">Nenhuma troca prevista.</p>
      )}
    </section>
  );
}

function StatRow({ view, stats, meId, currency, timezone }: {
  view: TodayView;
  stats: MonthStats;
  meId: string | null;
  currency: string;
  timezone: string;
}) {
  const next = view.kind === "schedule" ? view.next : null;
  let nextValue = "—";
  let nextHint = view.kind === "no-rule" ? "Sem regra de guarda" : "Nenhuma troca prevista.";
  if (next) {
    const w = toWallClock(next.atMs, timezone);
    const weekday = (new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay() + 6) % 7;
    nextValue = `${WEEKDAY_HEADERS[weekday]}, ${String(w.day).padStart(2, "0")}/${String(w.month).padStart(2, "0")}`;
    const time = `${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`;
    nextHint = next.to ? `às ${time} · para ${next.to.name}` : `às ${time} · a regra termina`;
  }

  const names = Object.fromEntries(stats.members.map((m) => [m.id, m.display_name]));
  const { balance } = stats;
  let balanceValue = "—";
  let balanceHint = stats.members.length < 2 ? "À espera do outro responsável" : "Não foi possível calcular o saldo.";
  let tone: "up" | "down" | undefined;
  if (balance) {
    balanceValue = formatCents(balance.amountCents, currency);
    if (!balance.debtor || !balance.creditor || balance.amountCents === 0) {
      balanceHint = "Ninguém deve nada neste período.";
    } else if (balance.debtor === meId) {
      balanceHint = `Deves a ${names[balance.creditor] ?? "o outro responsável"}`;
      tone = "down";
    } else if (balance.creditor === meId) {
      balanceHint = `${names[balance.debtor] ?? "O outro responsável"} deve-te`;
      tone = "up";
    } else {
      balanceHint = `${names[balance.debtor]} deve a ${names[balance.creditor]}`;
    }
  }

  return (
    <div className="dash-stats dash-span-full">
      <StatCard label="Próxima troca" value={nextValue} hint={nextHint} icon="swap" href="/calendario" />
      <StatCard
        label={`Despesas de ${stats.monthName}`}
        value={formatCents(stats.expenseCents, currency)}
        hint={countExpenses(stats.expenseCount)}
        icon="receipt"
        href="/despesas"
      />
      <StatCard label={`Saldo de ${stats.monthName}`} value={balanceValue} hint={balanceHint} tone={tone} icon="scale" href="/saldo" />
    </div>
  );
}

function WeekStrip({ days, members }: { days: CalendarDay[]; members: HomeMember[] }) {
  return (
    <section className="card dash-week" aria-labelledby="semana">
      <div className="card-header">
        <h2 className="card-title" id="semana">
          Próximos 7 dias
        </h2>
        <Link href="/calendario" className="btn btn-ghost btn-sm">
          Calendário
          <Icon name="chevronRight" size={16} />
        </Link>
      </div>
      <ol className="week-strip">
        {days.map((d) => {
          const weekday = (new Date(`${d.date}T00:00:00Z`).getUTCDay() + 6) % 7;
          const handover = d.handovers[0];
          const holder = d.segments[d.segments.length - 1].person;
          return (
            <li key={d.date} className="week-day" data-today={d.isToday ? "true" : undefined}>
              <span className="visually-hidden">{describeDay(d)}</span>
              <span className="week-day-name" aria-hidden="true">
                {d.isToday ? "Hoje" : WEEKDAY_HEADERS[weekday]}
              </span>
              <span className="week-day-num" aria-hidden="true">
                {d.day}
              </span>
              <span className="week-day-bar" style={{ background: dayBackground(d.segments) }} aria-hidden="true" />
              <span className="week-day-meta" aria-hidden="true">
                {handover ? (
                  <>
                    <Icon name="swap" size={12} />
                    {handover.time}
                  </>
                ) : (
                  (holder?.name ?? "—")
                )}
              </span>
            </li>
          );
        })}
      </ol>
      {members.length > 0 && (
        <ul className="week-legend">
          {members.map((m) => (
            <li key={m.id}>
              <span className="week-legend-dot" style={{ background: m.color }} aria-hidden="true" />
              {m.display_name}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function QuickActions({ alone, wide }: { alone: boolean; wide: boolean }) {
  const actions = [
    { href: "/despesas/nova", label: "Nova despesa", icon: "plus" as const },
    { href: "/excecoes", label: "Registar exceção", icon: "exception" as const },
    { href: "/saldo", label: "Registar acerto", icon: "wallet" as const },
    alone
      ? { href: "/convidar", label: "Convidar o outro responsável", icon: "invite" as const }
      : { href: "/guarda", label: "Regra de guarda", icon: "rule" as const },
  ];
  return (
    <section className={wide ? "card dash-actions dash-span-full" : "card dash-actions"} aria-labelledby="atalhos">
      <div className="card-header">
        <h2 className="card-title" id="atalhos">
          Ações rápidas
        </h2>
      </div>
      <ul className="quick-actions">
        {actions.map((a) => (
          <li key={a.href}>
            <Link href={a.href} className="quick-action">
              <span className="quick-action-icon">
                <Icon name={a.icon} size={18} />
              </span>
              <span className="quick-action-label">{a.label}</span>
              <Icon name="chevronRight" size={16} className="quick-action-chevron" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Home (RF-05): who has the child now, in their color, the countdown to the next handover and the month at a glance. */
export default async function Home() {
  if (!isSupabaseConfigured()) {
    return (
      <main>
        <h1>Guarda Partilhada</h1>
        <p>Com quem a criança está hoje, a próxima troca e as despesas divididas entre os dois responsáveis.</p>
        <p className="status" data-testid="supabase-status">
          Supabase ainda não configurado (ver .env.example).
        </p>
      </main>
    );
  }

  const { view, nowMs, family, meId } = await loadHome();

  if (!view || !family) {
    return (
      <main className="page-wide">
        <PageHeader title="Início" />
        <p role="alert">Não foi possível carregar a família.</p>
      </main>
    );
  }

  const currency = family.currency || "EUR";
  const stats = monthStats(family, nowMs);
  const week = view.kind === "schedule" ? upcomingWeek(family, nowMs) : [];

  return (
    <main className="page-wide">
      <PageHeader
        title="Início"
        subtitle={describeToday(nowMs, family.timezone)}
        actions={
          <Link href="/despesas/nova" className="btn btn-primary">
            <Icon name="plus" size={18} />
            Nova despesa
          </Link>
        }
      />
      <div className="dash-grid">
        <HeroCard view={view} />
        {view.kind === "schedule" && <NextHandoverCard view={view} nowMs={nowMs} />}
        <StatRow view={view} stats={stats} meId={meId} currency={currency} timezone={family.timezone} />
        {week.length > 0 ? <WeekStrip days={week} members={stats.members} /> : null}
        <QuickActions alone={stats.members.length < 2} wide={week.length === 0} />
      </div>
    </main>
  );
}

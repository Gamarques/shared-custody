import Link from "next/link";
import { isSupabaseConfigured } from "@/lib/env";
import {
  buildMonthCalendar,
  calendarRange,
  currentMonth,
  dayBackground,
  describeDay,
  NO_HOLDER_COLOR,
  parseMonth,
  WEEKDAY_HEADERS,
  type MonthCalendar,
} from "@/lib/custody/calendar";
import type { CustodyOverride, CustodyRule } from "@/lib/custody/holder";
import { textColorOn, type HomeMember } from "@/lib/custody/today";
import { createClient } from "@/lib/supabase/server";

// Per-user data that depends on the clock: never prerender.
export const dynamic = "force-dynamic";

type FamilyRow = {
  timezone: string;
  members: HomeMember[] | null;
  custody_rules: CustodyRule[] | null;
  custody_overrides: CustodyOverride[] | null;
};

/** The caller's family with its members, rule versions and overrides; RLS limits it to that family. */
const CALENDAR_SELECT =
  "family_id, families(timezone, members(id, display_name, color), " +
  "custody_rules(id, starts_on, first_member_id, handover_weekday, handover_time, valid_from, valid_to, created_at), " +
  "custody_overrides(id, starts_at, ends_at, member_id, reason, created_at))";

type Loaded = { calendar: MonthCalendar; members: HomeMember[]; hasRule: boolean };

async function loadCalendar(now: Date, monthParam: string | undefined): Promise<Loaded | null> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id ?? "";

  // The zone decides which days the month covers, so read it before the month's overrides.
  const { data: me } = await supabase.from("members").select("families(timezone)").eq("user_id", userId).maybeSingle();
  const timezone = (me as { families: { timezone: string } | null } | null)?.families?.timezone;
  if (!timezone) return null;

  const month = parseMonth(monthParam) ?? currentMonth(now.getTime(), timezone);
  const range = calendarRange(month, timezone);
  const { data } = await supabase
    .from("members")
    .select(CALENDAR_SELECT)
    .eq("user_id", userId)
    // Only overrides that overlap the days shown.
    .gt("families.custody_overrides.ends_at", new Date(range.startMs).toISOString())
    .lt("families.custody_overrides.starts_at", new Date(range.endMs).toISOString())
    .maybeSingle();
  const family = (data as { families: FamilyRow | null } | null)?.families ?? null;
  if (!family) return null;

  const members = family.members ?? [];
  const rules = family.custody_rules ?? [];
  return {
    calendar: buildMonthCalendar({
      month,
      now,
      timezone: family.timezone,
      members,
      rules,
      overrides: family.custody_overrides ?? [],
    }),
    members,
    hasRule: rules.length > 0,
  };
}

function Calendar({ calendar }: { calendar: MonthCalendar }) {
  return (
    <table className="calendar" data-testid="calendar">
      <caption>{calendar.title}</caption>
      <thead>
        <tr>
          {WEEKDAY_HEADERS.map((d) => (
            <th key={d} scope="col">
              {d}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {calendar.weeks.map((week) => (
          <tr key={week[0].date}>
            {week.map((day) => {
              const first = day.segments[0].person;
              const classes = ["day", day.inMonth ? "" : "outside", day.isToday ? "today" : ""].filter(Boolean);
              return (
                <td
                  key={day.date}
                  className={classes.join(" ")}
                  style={{ background: dayBackground(day.segments) }}
                  data-date={day.date}
                  data-holders={day.segments.map((s) => s.person?.memberId ?? "").join(",")}
                  aria-label={describeDay(day)}
                  aria-current={day.isToday ? "date" : undefined}
                  title={describeDay(day)}
                >
                  <span className="day-number" style={{ color: textColorOn(first?.color ?? NO_HOLDER_COLOR) }}>
                    {day.day}
                  </span>
                  {day.handovers.map((h) => (
                    <span key={h.atMs} className="handover" data-testid="handover">
                      ⇄ {h.time}
                    </span>
                  ))}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Monthly calendar (RF-06): each day in the color of who has the child, handovers marked. */
export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  if (!isSupabaseConfigured()) {
    return (
      <main>
        <h1>Calendário</h1>
        <p>Supabase ainda não configurado (ver .env.example).</p>
      </main>
    );
  }

  const { mes } = await searchParams;
  const loaded = await loadCalendar(new Date(), mes);
  if (!loaded) {
    return (
      <main>
        <h1>Calendário</h1>
        <p>Não foi possível carregar a família.</p>
      </main>
    );
  }
  const { calendar, members, hasRule } = loaded;

  return (
    <main>
      <h1>Calendário</h1>
      <nav className="month-nav">
        <Link href={`/calendario?mes=${calendar.prevMonth}`} aria-label="Mês anterior">
          ‹ Anterior
        </Link>
        <strong data-testid="month-title">{calendar.title}</strong>
        <Link href={`/calendario?mes=${calendar.nextMonth}`} aria-label="Próximo mês">
          Próximo ›
        </Link>
      </nav>

      {!hasRule && (
        <p>
          A regra de guarda ainda não foi definida. <Link href="/guarda">Definir a regra de guarda</Link>
        </p>
      )}

      <Calendar calendar={calendar} />

      <ul className="legend" data-testid="legend">
        {members.map((m) => (
          <li key={m.id}>
            <span className="swatch" style={{ background: m.color }} /> {m.display_name}
          </li>
        ))}
        <li>
          <span className="handover">⇄</span> hora da troca de guarda (a cor do dia se divide)
        </li>
      </ul>

      <p>
        <Link href="/">Voltar</Link>
      </p>
    </main>
  );
}

import Link from "next/link";
import { isSupabaseConfigured } from "@/lib/env";
import type { CustodyOverride, CustodyRule } from "@/lib/custody/holder";
import { buildTodayView, textColorOn, type HomeMember, type HomePerson, type TodayView } from "@/lib/custody/today";
import { createClient } from "@/lib/supabase/server";
import { HandoverCountdown } from "./HandoverCountdown";

// Per-user data that changes with the clock: never prerender.
export const dynamic = "force-dynamic";

type FamilyRow = {
  timezone: string;
  children: { name: string; created_at: string }[] | null;
  members: HomeMember[] | null;
  custody_rules: CustodyRule[] | null;
  custody_overrides: CustodyOverride[] | null;
};

/**
 * Everything the home needs in one request (RNF-07): the caller's family with its members,
 * child, rule versions and the overrides that have not ended yet. RLS limits every embedded
 * table to the caller's own family.
 */
const HOME_SELECT =
  "family_id, families(timezone, children(name, created_at), members(id, display_name, color), " +
  "custody_rules(id, starts_on, first_member_id, handover_weekday, handover_time, valid_from, valid_to, created_at), " +
  "custody_overrides(id, starts_at, ends_at, member_id, reason, created_at))";

function MemberBadge({ person, testId }: { person: HomePerson; testId: string }) {
  const style = person.color ? { background: person.color, color: textColorOn(person.color) } : undefined;
  return (
    <span className="member-badge" style={style} data-testid={testId} data-color={person.color ?? ""}>
      {person.name}
    </span>
  );
}

async function loadToday(now: Date): Promise<TodayView | null> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const { data } = await supabase
    .from("members")
    .select(HOME_SELECT)
    .eq("user_id", userData.user?.id ?? "")
    .gt("families.custody_overrides.ends_at", now.toISOString())
    .maybeSingle();
  const family = (data as { families: FamilyRow | null } | null)?.families ?? null;
  if (!family) return null;

  const child = [...(family.children ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  return buildTodayView({
    now,
    timezone: family.timezone,
    members: family.members ?? [],
    rules: family.custody_rules ?? [],
    overrides: family.custody_overrides ?? [],
    childName: child?.name ?? null,
  });
}

function CustodyToday({ view, nowMs }: { view: TodayView | null; nowMs: number }) {
  if (!view) return <p>Não foi possível carregar a família.</p>;

  if (view.kind === "no-rule") {
    return (
      <section data-testid="today">
        <p>A regra de guarda ainda não foi definida.</p>
        <p>
          <Link href="/guarda">Definir a regra de guarda</Link>
        </p>
      </section>
    );
  }

  return (
    <>
      <section data-testid="today">
        <h2>Hoje</h2>
        {view.current ? (
          <p className="holder">
            {view.childName} está com <MemberBadge person={view.current} testId="current-holder" />
          </p>
        ) : (
          <p className="holder">A guarda ainda não começou.</p>
        )}
        {view.current?.reason && <p data-testid="override-reason">Exceção: {view.current.reason}</p>}
      </section>
      <section data-testid="next-handover">
        <h2>Próxima troca</h2>
        {view.next ? (
          <>
            <p>
              {view.next.when[0].toUpperCase() + view.next.when.slice(1)}
              {view.next.to ? (
                <>
                  , com <MemberBadge person={view.next.to} testId="next-holder" />
                </>
              ) : (
                ": a regra de guarda termina"
              )}
              .
            </p>
            <p className="countdown">
              <HandoverCountdown atMs={view.next.atMs} nowMs={nowMs} />
            </p>
          </>
        ) : (
          <p>Nenhuma troca prevista.</p>
        )}
      </section>
    </>
  );
}

/** Home (RF-05): who has the child now, in their color, and the countdown to the next handover. */
export default async function Home() {
  const configured = isSupabaseConfigured();
  const now = new Date();
  const view = configured ? await loadToday(now) : null;

  return (
    <main>
      <h1>Guarda Compartilhada</h1>
      {configured ? (
        <>
          <CustodyToday view={view} nowMs={now.getTime()} />
          <p>
            <Link href="/calendario">Calendário do mês</Link>
          </p>
          <p>
            <Link href="/guarda">Regra de guarda</Link>
          </p>
          <p>
            <Link href="/excecoes">Exceções (troca de dias, férias, feriados)</Link>
          </p>
          <p>
            <Link href="/despesas">Despesas</Link>
          </p>
          <p>
            <Link href="/despesas/nova">Nova despesa</Link>
          </p>
          <p>
            <Link href="/saldo">Saldo</Link>
          </p>
          <p>
            <Link href="/convidar">Convidar o outro responsável</Link>
          </p>
        </>
      ) : (
        <>
          <p>Com quem a criança está hoje, a próxima troca e as despesas divididas entre os dois responsáveis.</p>
          <p className="status" data-testid="supabase-status">
            Supabase ainda não configurado (ver .env.example).
          </p>
        </>
      )}
    </main>
  );
}

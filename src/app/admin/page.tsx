import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  adminTab,
  formatAdminDateTime,
  plural,
  type AdminFamily,
  type AdminUser,
} from "@/lib/admin/admin";
import { isAppAdmin } from "@/lib/auth/admin";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/session-user";
import { Badge, Card, EmptyState, PageHeader } from "../_components/ui";
import { DeleteFamilyButton, RemoveMemberButton } from "./AdminActions";
import styles from "./admin.module.css";

// Per-user data: never prerender.
export const dynamic = "force-dynamic";

/**
 * Platform administration: every family and every user. Anonymous callers go to /login; a
 * signed-in user who is not an admin gets a 404, so the page does not reveal that it exists.
 */
export default async function AdminPage({ searchParams }: { searchParams: Promise<{ vista?: string | string[]; aviso?: string; familia?: string }> }) {
  if (!isSupabaseConfigured()) {
    return (
      <main>
        <PageHeader title="Administração" />
        <p>Supabase ainda não configurado (ver .env.example).</p>
      </main>
    );
  }

  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) redirect("/login?next=/admin");
  if (!(await isAppAdmin())) notFound();

  const params = await searchParams;
  const tab = adminTab(params.vista);
  const [familiesRes, usersRes] = await Promise.all([
    supabase.rpc("admin_list_families"),
    supabase.rpc("admin_list_users"),
  ]);
  const families = (familiesRes.data ?? []) as AdminFamily[];
  const users = (usersRes.data ?? []) as AdminUser[];
  const failed = Boolean(familiesRes.error || usersRes.error);

  return (
    <main>
      <PageHeader
        title="Administração"
        subtitle={`${plural(families.length, "família", "famílias")} · ${plural(users.length, "utilizador", "utilizadores")}`}
      />

      <nav className={styles.tabs} aria-label="Vistas de administração">
        <Link href="/admin" className={styles.tab} aria-current={tab === "familias" ? "page" : undefined}>
          Famílias <span className={styles.tabCount}>{families.length}</span>
        </Link>
        <Link href="/admin?vista=utilizadores" className={styles.tab} aria-current={tab === "utilizadores" ? "page" : undefined}>
          Utilizadores <span className={styles.tabCount}>{users.length}</span>
        </Link>
      </nav>

      {params.aviso === "recibos" && (
        <p role="status" className={styles.alert}>
          A família foi eliminada, mas algumas fotografias de recibos ficaram no Storage. Remove a pasta{" "}
          <code>{typeof params.familia === "string" ? params.familia : "da família"}</code> no bucket <code>receipts</code> do
          Supabase.
        </p>
      )}

      {failed && (
        <p role="alert" className={styles.alert}>
          Não foi possível carregar todos os dados. Atualiza a página.
        </p>
      )}

      {tab === "familias" ? <FamiliesSection families={families} /> : <UsersSection users={users} />}
    </main>
  );
}

function FamiliesSection({ families }: { families: AdminFamily[] }) {
  if (families.length === 0) {
    return (
      <Card>
        <EmptyState title="Ainda não há famílias.">Quando alguém concluir o registo, a família aparece aqui.</EmptyState>
      </Card>
    );
  }
  return (
    <section aria-label="Famílias" className={styles.grid} data-testid="admin-families">
      {families.map((f) => (
        <article key={f.id} className={`card ${styles.family}`} data-testid="admin-family">
          <header className={styles.familyHeader}>
            <div className={styles.familyTitle}>
              <h2>{f.name}</h2>
              <p className={styles.meta}>
                Criada a {formatAdminDateTime(f.created_at)} · {f.currency} · {f.timezone}
              </p>
            </div>
            {f.open_expenses_count > 0 && <Badge tone="warning">{plural(f.open_expenses_count, "despesa em aberto", "despesas em aberto")}</Badge>}
          </header>

          <dl className={styles.stats}>
            <div>
              <dt>Crianças</dt>
              <dd>{f.children_count}</dd>
            </div>
            <div>
              <dt>Despesas</dt>
              <dd>{f.expenses_count}</dd>
            </div>
            <div>
              <dt>Em aberto</dt>
              <dd>{f.open_expenses_count}</dd>
            </div>
            <div>
              <dt>Última atividade</dt>
              <dd>{formatAdminDateTime(f.last_activity_at)}</dd>
            </div>
          </dl>

          <h3 className={styles.subheading}>Membros</h3>
          {f.members.length === 0 ? (
            <p className={styles.meta}>Sem membros.</p>
          ) : (
            <ul className={styles.members}>
              {f.members.map((m) => (
                <li key={m.member_id} className={styles.member}>
                  <span className={styles.swatch} style={{ background: m.color }} aria-hidden="true" />
                  <span className={styles.memberText}>
                    <span>
                      <strong>{m.display_name}</strong>
                      {m.role === "owner" && <span className={styles.role}> · criou a família</span>}
                    </span>
                    <span className={styles.email}>{m.email ?? "sem e-mail"}</span>
                  </span>
                  <RemoveMemberButton familyId={f.id} familyName={f.name} userId={m.user_id} memberName={m.display_name} />
                </li>
              ))}
            </ul>
          )}

          <footer className={styles.familyFooter}>
            <DeleteFamilyButton familyId={f.id} familyName={f.name} />
          </footer>
        </article>
      ))}
    </section>
  );
}

function UsersSection({ users }: { users: AdminUser[] }) {
  if (users.length === 0) {
    return (
      <Card>
        <EmptyState title="Ainda não há utilizadores." />
      </Card>
    );
  }
  return (
    <section aria-label="Utilizadores" data-testid="admin-users">
      <div className={`table-wrap ${styles.usersWrap}`}>
        <table className={`table ${styles.users}`}>
          <thead>
            <tr>
              <th scope="col">E-mail</th>
              <th scope="col">Família</th>
              <th scope="col">Registo</th>
              <th scope="col">Último acesso</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td data-label="E-mail" className={styles.userEmail}>
                  <span className={styles.userEmailValue}>
                    <span>{u.email ?? "sem e-mail"}</span>
                    {u.is_admin && <Badge tone="accent">Admin</Badge>}
                  </span>
                </td>
                <td data-label="Família">{u.families.length ? u.families.map((f) => f.name).join(", ") : <span className={styles.meta}>Sem família</span>}</td>
                <td data-label="Registo">{formatAdminDateTime(u.created_at)}</td>
                <td data-label="Último acesso">{formatAdminDateTime(u.last_sign_in_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * Platform admin (/admin): row types of the admin RPCs (supabase/migrations/20261103000100_app_admins.sql),
 * the messages for their error codes and small formatting helpers. No I/O here.
 */

export type AdminFamilyMember = {
  member_id: string;
  user_id: string;
  email: string | null;
  display_name: string;
  color: string;
  role: "owner" | "member";
  joined_at: string;
};

export type AdminFamily = {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  created_at: string;
  members: AdminFamilyMember[];
  children_count: number;
  expenses_count: number;
  open_expenses_count: number;
  last_activity_at: string | null;
};

export type AdminUser = {
  id: string;
  email: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
  is_admin: boolean;
  families: { id: string; name: string }[];
};

export type AdminTab = "familias" | "utilizadores";

export function adminTab(value: string | string[] | undefined): AdminTab {
  return value === "utilizadores" ? "utilizadores" : "familias";
}

/** Result of an admin server action. */
export type AdminActionResult = { ok: true } | { ok: false; error: string };

/**
 * SQLSTATE of an admin RPC -> what the admin reads. 42501 not an admin; P0002 the family or the
 * member no longer exists; AD001 the member is referenced by expenses or settlements.
 */
export function adminErrorMessage(code: string | null | undefined): string {
  switch (code) {
    case "42501":
      return "Não tens permissões de administrador para isto.";
    case "P0002":
      return "Já não existe. Atualiza a página.";
    case "AD001":
      return "Este membro tem despesas ou acertos registados, que nunca são apagados um a um. Para os apagar, elimina a família.";
    default:
      return "Não foi possível concluir. Tenta novamente.";
  }
}

/** The typed confirmation must equal the family name (spaces around it and letter case ignored). */
export function confirmsFamilyName(typed: string, familyName: string): boolean {
  return typed.trim().toLocaleLowerCase("pt-PT") === familyName.trim().toLocaleLowerCase("pt-PT") && typed.trim() !== "";
}

const DATE_TIME = new Intl.DateTimeFormat("pt-PT", {
  timeZone: "Europe/Lisbon",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** "03/11/2026, 14:05" in Lisbon time, or "—" when missing. */
export function formatAdminDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? "—" : DATE_TIME.format(ms);
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

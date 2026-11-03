import { Suspense } from "react";
import Link from "next/link";
import { isAppAdmin } from "@/lib/auth/admin";
import { isSupabaseConfigured } from "@/lib/env";
import { loadFamilySnapshot } from "./_components/family-snapshot";
import { Icon } from "./_components/Icon";
import { UserMenu } from "./_components/UserMenu";

/** Header avatar menu with the signed-in user and "Sair"; nothing without a session. */
export async function SessionBar() {
  if (!isSupabaseConfigured()) return null;
  // Rendered on every page: the token is verified locally (RNF-07) and the family rows come from
  // the request-cached snapshot the home also reads, so this adds no query to the home.
  const { user, me } = await loadFamilySnapshot().catch(() => ({ user: null, me: null }));
  if (!user) return null;
  return (
    <UserMenu
      name={me?.display_name ?? null}
      email={user.email}
      color={me?.color || null}
      // The admin check is one more request, so it streams in behind Suspense and never delays
      // the page; the menu panel is closed while it loads anyway.
      extra={
        <Suspense fallback={null}>
          <AdminMenuLink />
        </Suspense>
      }
    />
  );
}

/** "Admin" entry of the account menu, only for platform admins (is_app_admin()). */
export async function AdminMenuLink() {
  if (!(await isAppAdmin())) return null;
  return (
    <Link href="/admin" className="user-menu-item user-menu-link" data-testid="admin-link">
      <Icon name="shield" size={18} />
      Admin
    </Link>
  );
}

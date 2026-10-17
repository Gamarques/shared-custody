import { isSupabaseConfigured } from "@/lib/env";
import { loadFamilySnapshot } from "./_components/family-snapshot";
import { UserMenu } from "./_components/UserMenu";

/** Header avatar menu with the signed-in user and "Sair"; nothing without a session. */
export async function SessionBar() {
  if (!isSupabaseConfigured()) return null;
  // Rendered on every page: the token is verified locally (RNF-07) and the family rows come from
  // the request-cached snapshot the home also reads, so this adds no query to the home.
  const { user, me } = await loadFamilySnapshot().catch(() => ({ user: null, me: null }));
  if (!user) return null;
  return <UserMenu name={me?.display_name ?? null} email={user.email} color={me?.color || null} />;
}

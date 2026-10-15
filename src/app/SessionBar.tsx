import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/session-user";

export async function SessionBar() {
  if (!isSupabaseConfigured()) return null;
  // Rendered on every page: verify the token locally instead of asking Supabase Auth (RNF-07).
  const user = await getSessionUser(await createClient());
  if (!user) return null;
  return (
    <form action="/auth/signout" method="post" data-testid="session-bar">
      <span>{user.email}</span> <button type="submit">Sair</button>
    </form>
  );
}

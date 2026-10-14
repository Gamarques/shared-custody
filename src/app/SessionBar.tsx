import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export async function SessionBar() {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  return (
    <form action="/auth/signout" method="post" data-testid="session-bar">
      <span>{data.user.email}</span> <button type="submit">Sair</button>
    </form>
  );
}

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/**
 * Whether the signed-in caller is a platform admin (shared_custody.is_app_admin(), checked by the
 * database for the caller's token). Cached per request, so the /admin page and the "Admin" link
 * in the account menu share one call. False without a session or on any error.
 */
export const isAppAdmin = cache(async (): Promise<boolean> => {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("is_app_admin");
    return !error && data === true;
  } catch {
    return false;
  }
});

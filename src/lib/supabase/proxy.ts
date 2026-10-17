import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isPublicPath } from "@/lib/auth/paths";
import { isDemoMode } from "@/lib/demo/mode";
import { createDemoServerClient } from "@/lib/demo/server";
import { getPublicEnv, isSupabaseConfigured } from "@/lib/env";
import { DB_SCHEMA } from "./schema";
import { getSessionUser } from "./session-user";

/**
 * Refreshes the Supabase session cookie on every request (so the session
 * persists across reopening the app) and sends anonymous users to /login.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  if (!isSupabaseConfigured()) return response;

  const supabase = isDemoMode()
    ? // Demo mode: no session cookie; the fake client is always signed in as Ana.
      (createDemoServerClient() as unknown as ReturnType<typeof createServerClient>)
    : createServerClient(getPublicEnv().supabaseUrl, getPublicEnv().supabaseAnonKey, {
        db: { schema: DB_SCHEMA },
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
            response = NextResponse.next({ request });
            for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
          },
        },
      });

  // Verified locally when the project uses asymmetric signing keys: no Auth request (RNF-07).
  const user = await getSessionUser(supabase);
  const { pathname, search } = request.nextUrl;

  if (!user && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (pathname !== "/") url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }

  // Signed-in users without a family go through onboarding (RF-02/RF-03),
  // except on an invite link, where they join an existing family instead. The home is skipped:
  // its single query already finds the membership and redirects to /onboarding itself, which
  // saves one request on the most opened page (RNF-07).
  if (
    user &&
    pathname !== "/" &&
    !pathname.startsWith("/auth") &&
    !pathname.startsWith("/api") &&
    !pathname.startsWith("/convite/")
  ) {
    const { data: membership } = await supabase.from("members").select("id").eq("user_id", user.id).limit(1);
    const hasFamily = (membership?.length ?? 0) > 0;
    let target: string | null = null;
    if (!hasFamily && pathname !== "/onboarding") target = "/onboarding";
    else if (hasFamily && pathname === "/onboarding") target = "/";
    if (target) {
      const url = request.nextUrl.clone();
      url.pathname = target;
      url.search = "";
      return NextResponse.redirect(url);
    }
  }
  return response;
}

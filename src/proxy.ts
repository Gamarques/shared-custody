import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

// The proxy (session refresh + redirect of anonymous users) runs on every path except Next.js
// assets and the files in public/ that must load without a session. Exclusions are exact file
// names or the public/icons folder, never "any path ending in .png": a page route such as
// /convite/<token> must not skip the proxy because its last segment looks like a file name.
export const config = {
  matcher: [
    "/((?!_next/static/|_next/image(?:/|$)|icons/|(?:favicon\\.ico|manifest\\.webmanifest|sw\\.js|offline\\.html)$).*)",
  ],
};

import { isDemoMode } from "@/lib/demo/mode";

/**
 * Public Supabase settings. Both values are safe to ship to the browser:
 * the anon key only grants what RLS policies allow.
 *
 * `process.env.NEXT_PUBLIC_*` must be referenced literally so Next.js can
 * inline the values into the client bundle at build time.
 */
export type PublicEnv = {
  supabaseUrl: string;
  supabaseAnonKey: string;
};

type RawEnv = {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
};

export class MissingEnvError extends Error {
  constructor(public readonly missing: string[]) {
    super(
      `Missing environment variables: ${missing.join(", ")}. ` +
        "Copy .env.example to .env.local and fill in the Supabase project values.",
    );
    this.name = "MissingEnvError";
  }
}

export function parsePublicEnv(raw: RawEnv): PublicEnv {
  const url = raw.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = raw.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  const missing: string[] = [];
  if (!url) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!anonKey) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (missing.length > 0) throw new MissingEnvError(missing);

  let parsed: URL;
  try {
    parsed = new URL(url!);
  } catch {
    throw new Error(`NEXT_PUBLIC_SUPABASE_URL is not a valid URL: "${url}"`);
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must use https (http is only allowed for localhost)");
  }

  return { supabaseUrl: url!.replace(/\/+$/, ""), supabaseAnonKey: anonKey! };
}

export function getPublicEnv(): PublicEnv {
  return parsePublicEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}

/**
 * True when the Supabase variables are present and valid, or in demo mode (DEMO_MODE=1),
 * where the fake in-memory client stands in for Supabase; never throws.
 */
export function isSupabaseConfigured(): boolean {
  if (isDemoMode()) return true;
  try {
    getPublicEnv();
    return true;
  } catch {
    return false;
  }
}

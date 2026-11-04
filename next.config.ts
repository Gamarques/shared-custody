import type { NextConfig } from "next";

const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "1" || process.env.DEMO_MODE === "1";

// Demo mode serves fake data to everyone, signed in as an admin, and opens /api/demo. It must
// never reach the production deployment: fail the build there (runtime checks in
// src/lib/supabase/demo-guard.ts cover a deploy that skips this build).
if (demoMode && process.env.VERCEL_ENV === "production") {
  throw new Error("DEMO_MODE / NEXT_PUBLIC_DEMO_MODE must not be set for the production deployment.");
}

type HeaderEnv = { supabaseUrl?: string; dev: boolean };

/** Origin of the Supabase project (https://<ref>.supabase.co), or null when unset or invalid. */
function supabaseOrigin(url: string | undefined): string | null {
  try {
    const parsed = new URL(url ?? "");
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

/**
 * Content-Security-Policy for every response. What the app needs:
 * - scripts and styles from this origin; 'unsafe-inline' because Next.js inlines its hydration
 *   data (no nonce, which would force every page to render per request and break the cached
 *   offline pages of the service worker); React's dev overlay also needs 'unsafe-eval' in dev;
 * - fetch/WebSocket to the Supabase project only (REST, Auth, Storage, Realtime);
 * - images from this origin plus data:/blob: (receipt preview and compression in the browser)
 *   and the Supabase project (signed receipt URLs);
 * - no plugins, no frames in or out, forms only to this origin, <base> locked.
 */
export function contentSecurityPolicy({ supabaseUrl, dev }: HeaderEnv): string {
  const supabase = supabaseOrigin(supabaseUrl);
  const supabaseWs = supabase ? supabase.replace(/^http/, "ws") : null;
  const directives: [string, ...(string | null | false)[]][] = [
    ["default-src", "'self'"],
    ["script-src", "'self'", "'unsafe-inline'", dev && "'unsafe-eval'"],
    ["style-src", "'self'", "'unsafe-inline'"],
    ["img-src", "'self'", "data:", "blob:", supabase],
    ["font-src", "'self'", "data:"],
    ["connect-src", "'self'", supabase, supabaseWs, dev && "ws:"],
    ["worker-src", "'self'"],
    ["manifest-src", "'self'"],
    ["frame-src", "'none'"],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    ["frame-ancestors", "'none'"],
  ];
  return directives.map(([name, ...values]) => [name, ...values.filter(Boolean)].join(" ")).join("; ");
}

export function securityHeaders(env: HeaderEnv): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(env) },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    // The receipt picker is a plain <input type="file"> (no `capture`, no getUserMedia), so the
    // page itself needs no camera; the phone's file picker still offers the camera app.
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
    },
  ];
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  // tools/perf-home.mjs builds into its own directory so the normal .next build is untouched.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Client Components read NEXT_PUBLIC_DEMO_MODE (inlined at build time): DEMO_MODE=1 alone is
  // enough to turn demo mode on everywhere (src/lib/demo/mode.ts).
  env: {
    NEXT_PUBLIC_DEMO_MODE: demoMode ? "1" : "",
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders({
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
          dev: process.env.NODE_ENV === "development",
        }),
      },
    ];
  },
};

export default nextConfig;

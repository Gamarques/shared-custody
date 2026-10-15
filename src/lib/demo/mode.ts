/**
 * Demo mode: the whole app runs on fake in-memory data, without a Supabase project.
 *
 * DEMO_MODE=1 turns it on for server code (pages, route handlers, the proxy). Client
 * Components only see NEXT_PUBLIC_* variables, inlined at build time, so they read
 * NEXT_PUBLIC_DEMO_MODE; next.config.ts derives it from DEMO_MODE, so setting either one
 * is enough. `npm run demo` sets both.
 */
export function isDemoMode(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE === "1" || process.env.DEMO_MODE === "1";
}

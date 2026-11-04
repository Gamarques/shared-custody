import { isDemoMode } from "@/lib/demo/mode";

/**
 * Demo mode replaces Supabase with a fake client that is always signed in (as an admin) and
 * lets anyone read and write the in-memory data through /api/demo. It must never run on the
 * production deployment. next.config.ts already fails a production build with DEMO_MODE set;
 * these checks cover the runtime too (an env var changed without a rebuild, a prebuilt deploy).
 *
 * VERCEL_ENV is set by Vercel on its deployments ("production" | "preview" | "development") and
 * is unset locally, so `npm run demo` and the visual QA keep working.
 */
export function isProductionDeployment(): boolean {
  return process.env.VERCEL_ENV === "production";
}

export class DemoModeInProductionError extends Error {
  constructor() {
    super("DEMO_MODE is set on the production deployment. Remove DEMO_MODE and NEXT_PUBLIC_DEMO_MODE and redeploy.");
    this.name = "DemoModeInProductionError";
  }
}

/** True when the demo stand-ins may serve this request: demo mode on, and not in production. */
export function isDemoAllowed(): boolean {
  return isDemoMode() && !isProductionDeployment();
}

/**
 * For the Supabase client factories: whether to hand out the fake client. Fails closed (throws)
 * when demo mode is on in production, so the app errors instead of serving fake signed-in data.
 */
export function shouldUseDemoClient(): boolean {
  if (!isDemoMode()) return false;
  if (isProductionDeployment()) throw new DemoModeInProductionError();
  return true;
}

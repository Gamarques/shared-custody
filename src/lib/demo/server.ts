import { createDemoClient } from "./fake-client";
import { createDemoStore } from "./seed";
import { DEMO_USER } from "./users";
import type { DemoStore } from "./store";

const globalForDemo = globalThis as typeof globalThis & { __guardaDemoStore?: DemoStore };

/**
 * The one in-memory store of the process. Kept on globalThis so pages, route handlers and the
 * proxy (separate module graphs in `next dev`) and hot reloads all share it. Restarting the
 * server brings the seed data back.
 */
export function getDemoStore(): DemoStore {
  globalForDemo.__guardaDemoStore ??= createDemoStore();
  return globalForDemo.__guardaDemoStore;
}

/** Throws the current data away and seeds again (tests). */
export function resetDemoStore(now?: Date): DemoStore {
  globalForDemo.__guardaDemoStore = createDemoStore(now);
  return globalForDemo.__guardaDemoStore;
}

/** Fake Supabase client for server code, signed in as the demo user. */
export function createDemoServerClient() {
  return createDemoClient((request) => getDemoStore().execute(request, DEMO_USER.id), DEMO_USER);
}

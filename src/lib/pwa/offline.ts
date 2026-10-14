/**
 * Offline copies of pages already seen (RF-16). The service worker (public/sw.js) stores every
 * page loaded by a full navigation; pages reached by client-side navigation ask for a copy
 * through this message.
 */

/** Must match CACHE_PAGES_MESSAGE in public/sw.js. */
export const CACHE_PAGES_MESSAGE = "cache-pages";

export type CachePagesMessage = { type: typeof CACHE_PAGES_MESSAGE; pages: string[]; assets: string[] };

/** Path plus query of a same-origin URL, or null for another origin or an invalid URL. */
function samePath(url: string, origin: string): string | null {
  try {
    const u = new URL(url, origin);
    return u.origin === origin ? u.pathname + u.search : null;
  } catch {
    return null;
  }
}

/**
 * The pages to store for the current view: the URL as shown and its canonical form, so the
 * month opens offline both from "/calendario" and from "/calendario?mes=YYYY-MM".
 */
export function pagesToCache(currentHref: string, canonicalPath: string, origin: string): string[] {
  const paths = [samePath(currentHref, origin), samePath(canonicalPath, origin)];
  return [...new Set(paths.filter((p): p is string => p !== null))];
}

/** The build's scripts and styles among the URLs the page loaded. */
export function staticAssets(urls: readonly string[], origin: string): string[] {
  const paths = urls
    .map((u) => samePath(u, origin))
    .filter((p): p is string => p !== null && p.startsWith("/_next/static/"));
  return [...new Set(paths)];
}

export function cachePagesMessage(pages: string[], assets: string[]): CachePagesMessage {
  return { type: CACHE_PAGES_MESSAGE, pages, assets };
}

type WorkerContainer = { ready: Promise<{ active: { postMessage(message: unknown): void } | null }> };

/** Sends the message once a service worker is active; a no-op where there is none. */
export async function requestOfflineCopy(container: WorkerContainer | undefined, message: CachePagesMessage) {
  if (!container) return;
  const registration = await container.ready;
  registration.active?.postMessage(message);
}

/** "dd/mm/aaaa hh:mm" for when a page was generated, in the family's zone. */
export function formatSavedAt(wall: { year: number; month: number; day: number; hour: number; minute: number }) {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(wall.day)}/${two(wall.month)}/${wall.year} ${two(wall.hour)}:${two(wall.minute)}`;
}

// Service worker: installable shell (T-06) and offline reading of pages already seen (T-12).
const VERSION = "v2";
const SHELL_CACHE = `shell-${VERSION}`;
const PAGE_CACHE = `pages-${VERSION}`;
const SHELL_URLS = ["/offline.html", "/icons/icon-192.png", "/icons/icon-512.png"];
// Each calendar month seen is one entry; keep the most recent ones only.
const MAX_PAGES = 40;
// Must match CACHE_PAGES_MESSAGE in src/lib/pwa/offline.ts.
const CACHE_PAGES_MESSAGE = "cache-pages";

/** Same-origin URL that may hold personal data and must never be stored. */
function isPrivateEndpoint(url) {
  return url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/");
}

function isStaticAsset(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/");
}

/** Stores a page; drops the oldest ones past MAX_PAGES. Redirects (e.g. to /login) are not stored. */
async function putPage(key, res) {
  if (!res.ok || res.redirected) return;
  const cache = await caches.open(PAGE_CACHE);
  // Re-adding moves the entry to the end, so keys() runs from least to most recently stored.
  await cache.delete(key);
  await cache.put(key, res);
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_PAGES)).map((k) => cache.delete(k)));
}

async function putAsset(key) {
  const cache = await caches.open(SHELL_CACHE);
  if (await cache.match(key)) return;
  const res = await fetch(key);
  if (res.ok) await cache.put(key, res);
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL_URLS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => ![SHELL_CACHE, PAGE_CACHE].includes(k)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Signing out drops every stored page: they hold the family's data. The request itself
  // goes to the network untouched.
  if (request.method === "POST" && url.pathname === "/auth/signout") {
    event.waitUntil(caches.delete(PAGE_CACHE));
    return;
  }

  if (request.method !== "GET") return;
  // Never cache API or auth responses.
  if (isPrivateEndpoint(url)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          event.waitUntil(putPage(request.url, res.clone()));
          return res;
        })
        .catch(
          async () =>
            (await caches.match(request.url, { cacheName: PAGE_CACHE, ignoreVary: true })) ||
            caches.match("/offline.html", { cacheName: SHELL_CACHE }),
        ),
    );
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.put(request, copy)));
            }
            return res;
          }),
      ),
    );
  }
});

// A page reached by client-side navigation never passes through the "navigate" branch above,
// so the page asks for an offline copy of itself (and of the scripts and styles it loaded,
// which the first visit fetched before this worker was in control).
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== CACHE_PAGES_MESSAGE) return;
  const sameOrigin = (list) =>
    (Array.isArray(list) ? list : [])
      .map((u) => {
        try {
          return new URL(u, self.location.origin);
        } catch {
          return null;
        }
      })
      .filter((u) => u && u.origin === self.location.origin && !isPrivateEndpoint(u));

  const pages = sameOrigin(data.pages).filter((u) => !isStaticAsset(u));
  const assets = sameOrigin(data.assets).filter(isStaticAsset);
  event.waitUntil(
    Promise.all([
      ...pages.map((u) =>
        fetch(u.href, { credentials: "same-origin" })
          .then((res) => putPage(u.href, res))
          .catch(() => {}),
      ),
      ...assets.map((u) => putAsset(u.href).catch(() => {})),
    ]),
  );
});

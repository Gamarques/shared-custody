import { readFileSync } from "node:fs";
import vm from "node:vm";
import { beforeEach, describe, expect, it } from "vitest";
import { CACHE_PAGES_MESSAGE } from "./offline";

// Runs public/sw.js in a sandbox with an in-memory Cache Storage and a fake network that can be
// switched off ("airplane mode").
const ORIGIN = "https://guarda.example";
const SOURCE = readFileSync("public/sw.js", "utf8");

type Req = { url: string; method: string; mode: string };
type Listener = (event: unknown) => void;

const abs = (k: string | Req) => new URL(typeof k === "string" ? k : k.url, ORIGIN).href;

class MemoryCache {
  entries = new Map<string, Response>();
  async match(k: string | Req) {
    return this.entries.get(abs(k))?.clone();
  }
  async put(k: string | Req, res: Response) {
    this.entries.set(abs(k), res);
  }
  async delete(k: string | Req) {
    return this.entries.delete(abs(k));
  }
  async keys() {
    return [...this.entries.keys()].map((url) => ({ url, method: "GET", mode: "cors" }));
  }
  async addAll(urls: string[]) {
    for (const u of urls) await this.put(u, await net(u));
  }
}

let stores: Map<string, MemoryCache>;
let listeners: Map<string, Listener>;
let online: boolean;
let pages: Map<string, string>; // path -> HTML served by the network
let fetched: string[];

const caches = {
  async open(name: string) {
    if (!stores.has(name)) stores.set(name, new MemoryCache());
    return stores.get(name)!;
  },
  async keys() {
    return [...stores.keys()];
  },
  async delete(name: string) {
    return stores.delete(name);
  },
  async match(k: string | Req, opts: { cacheName?: string } = {}) {
    const names = opts.cacheName ? [opts.cacheName] : [...stores.keys()];
    for (const n of names) {
      const hit = await stores.get(n)?.match(k);
      if (hit) return hit;
    }
    return undefined;
  },
};

/** Response whose clones keep `redirected`, as in browsers. */
function withRedirected(res: Response): Response {
  Object.defineProperty(res, "redirected", { value: true });
  const clone = res.clone.bind(res);
  res.clone = () => withRedirected(clone());
  return res;
}

async function net(input: string | Req): Promise<Response> {
  const url = new URL(abs(input));
  fetched.push(url.pathname + url.search);
  if (!online) throw new TypeError("Failed to fetch");
  const path = url.pathname + url.search;
  if (path.startsWith("/redirect-to-login")) return withRedirected(new Response("<h1>Entrar</h1>"));
  const body = pages.get(path) ?? (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname === "/offline.html" ? `asset ${path}` : undefined);
  return body === undefined ? new Response("not found", { status: 404 }) : new Response(body, { headers: { "content-type": "text/html" } });
}

function boot() {
  stores = new Map();
  listeners = new Map();
  fetched = [];
  online = true;
  pages = new Map();
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
  };
  vm.runInNewContext(SOURCE, { self, caches, fetch: net, URL, Response, console });
}

type Ev = { waits: Promise<unknown>[]; response?: Promise<Response> };
function dispatch(type: string, fields: Record<string, unknown>): Ev {
  const ev: Ev & Record<string, unknown> = {
    ...fields,
    waits: [],
    waitUntil(p: Promise<unknown>) {
      ev.waits.push(p);
    },
    respondWith(p: Promise<Response>) {
      ev.response = p;
    },
  };
  listeners.get(type)!(ev);
  return ev;
}
async function settle(ev: Ev) {
  const res = await ev.response;
  // waitUntil may be called while the response resolves.
  for (let i = 0; i < ev.waits.length; i++) await ev.waits[i];
  return res;
}

const navigate = (path: string) =>
  settle(dispatch("fetch", { request: { url: ORIGIN + path, method: "GET", mode: "navigate" } }));
const pageCache = () => [...(stores.get("pages-v2")?.entries.keys() ?? [])];

beforeEach(async () => {
  boot();
  await settle(dispatch("install", {}));
  await settle(dispatch("activate", {}));
});

describe("service worker: offline calendar (RF-16)", () => {
  it("opens a month already seen in airplane mode", async () => {
    pages.set("/calendario?mes=2026-10", "<h1>Outubro de 2026</h1>");
    expect(await (await navigate("/calendario?mes=2026-10"))!.text()).toBe("<h1>Outubro de 2026</h1>");

    online = false;
    const res = await navigate("/calendario?mes=2026-10");
    expect(await res!.text()).toBe("<h1>Outubro de 2026</h1>");
  });

  it("serves the latest copy, not the first one", async () => {
    pages.set("/calendario", "v1");
    await navigate("/calendario");
    pages.set("/calendario", "v2");
    await navigate("/calendario");
    online = false;
    expect(await (await navigate("/calendario"))!.text()).toBe("v2");
  });

  it("shows the offline page for a month never seen", async () => {
    pages.set("/calendario?mes=2026-10", "outubro");
    await navigate("/calendario?mes=2026-10");
    online = false;
    expect(await (await navigate("/calendario?mes=2026-12"))!.text()).toBe("asset /offline.html");
  });

  it("does not store a redirect (e.g. to /login after the session expired)", async () => {
    await navigate("/redirect-to-login");
    expect(pageCache()).toEqual([]);
  });

  it("stores the months reached by client-side navigation when the page asks", async () => {
    pages.set("/calendario?mes=2026-11", "novembro");
    pages.set("/calendario", "outubro");
    pages.set("/calendario?mes=2026-10", "outubro");
    await settle(
      dispatch("message", {
        data: {
          type: CACHE_PAGES_MESSAGE,
          pages: ["/calendario?mes=2026-11", "/calendario", "/calendario?mes=2026-10"],
          assets: ["/_next/static/chunks/app.js", "/_next/static/css/app.css"],
        },
      }),
    );
    expect(pageCache()).toEqual([
      `${ORIGIN}/calendario?mes=2026-11`,
      `${ORIGIN}/calendario`,
      `${ORIGIN}/calendario?mes=2026-10`,
    ]);

    online = false;
    expect(await (await navigate("/calendario?mes=2026-11"))!.text()).toBe("novembro");
    expect(await (await navigate("/calendario?mes=2026-10"))!.text()).toBe("outubro");
    // Scripts and styles of the page load offline too.
    const js = await settle(
      dispatch("fetch", { request: { url: `${ORIGIN}/_next/static/chunks/app.js`, method: "GET", mode: "no-cors" } }),
    );
    expect(await js!.text()).toBe("asset /_next/static/chunks/app.js");
  });

  it("ignores other origins, API/auth routes and unknown messages", async () => {
    pages.set("/api/health", "{}");
    await settle(
      dispatch("message", {
        data: {
          type: CACHE_PAGES_MESSAGE,
          pages: ["https://evil.example/x", "/api/health", "/auth/callback"],
          assets: ["https://evil.example/_next/static/x.js", "/calendario"],
        },
      }),
    );
    await settle(dispatch("message", { data: { type: "other", pages: ["/calendario"] } }));
    await settle(dispatch("message", { data: null }));
    expect(fetched).toEqual(["/offline.html", "/icons/icon-192.png", "/icons/icon-512.png"]);
    expect(pageCache()).toEqual([]);
  });

  it("keeps a failed copy request silent when offline", async () => {
    online = false;
    const ev = dispatch("message", { data: { type: CACHE_PAGES_MESSAGE, pages: ["/calendario"], assets: [] } });
    await expect(settle(ev)).resolves.toBeUndefined();
  });

  it("does not fetch an asset already stored", async () => {
    const msg = { type: CACHE_PAGES_MESSAGE, pages: [], assets: ["/_next/static/chunks/app.js"] };
    await settle(dispatch("message", { data: msg }));
    await settle(dispatch("message", { data: msg }));
    expect(fetched.filter((p) => p === "/_next/static/chunks/app.js")).toHaveLength(1);
  });

  it("keeps the 40 most recent pages", async () => {
    for (let i = 0; i < 42; i++) {
      pages.set(`/calendario?mes=p${i}`, `p${i}`);
      await navigate(`/calendario?mes=p${i}`);
    }
    // p0 and p1 were evicted.
    const keys = pageCache();
    expect(keys).toHaveLength(40);
    expect(keys[0]).toBe(`${ORIGIN}/calendario?mes=p2`);
    expect(keys.at(-1)).toBe(`${ORIGIN}/calendario?mes=p41`);
  });

  it("drops every stored page on sign-out and lets the request through", async () => {
    pages.set("/calendario", "outubro");
    await navigate("/calendario");
    const ev = dispatch("fetch", { request: { url: `${ORIGIN}/auth/signout`, method: "POST", mode: "navigate" } });
    expect(ev.response).toBeUndefined();
    await settle(ev);
    expect(stores.has("pages-v2")).toBe(false);
    expect(stores.has("shell-v2")).toBe(true);

    online = false;
    expect(await (await navigate("/calendario"))!.text()).toBe("asset /offline.html");
  });

  it("leaves API and auth requests to the network", () => {
    for (const path of ["/api/health", "/auth/callback?code=x"]) {
      const ev = dispatch("fetch", { request: { url: ORIGIN + path, method: "GET", mode: "navigate" } });
      expect(ev.response).toBeUndefined();
    }
  });

  it("drops caches of older versions on activate", async () => {
    stores.set("pages-v1", new MemoryCache());
    await settle(dispatch("activate", {}));
    expect([...stores.keys()].sort()).toEqual(["shell-v2"]);
  });
});

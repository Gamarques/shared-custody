// Lab measurement of the home (RNF-07: "home carrega em menos de 2 s em 4G") in a real Chrome,
// with mobile emulation and throttled 4G, against a production build of the app and a local
// stand-in for Supabase (Auth JWKS + PostgREST) that answers after a configurable latency.
// It also counts the requests the server makes to Supabase while rendering the home.
// No dependencies: Chrome DevTools Protocol over Node's built-in WebSocket.
//
// Usage:
//   node tools/perf-home.mjs [--skip-build] [--runs 5] [--supabase-latency 20] [--budget 2000] [--waterfall]
//
// Needs Chrome or Edge (or CHROME_PATH). Builds into .next-perf (NEXT_DIST_DIR) so the normal
// .next build is untouched. This is a lab number on this machine, not a field measurement on a
// phone: see docs/qa-e2e.md for what it does and does not prove.
import { spawn, spawnSync } from "node:child_process";
import { generateKeyPairSync, sign, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const RUNS = Number(opt("runs", "5"));
const SUPABASE_LATENCY_MS = Number(opt("supabase-latency", "20"));
const BUDGET_MS = Number(opt("budget", "2000"));
const SKIP_BUILD = args.includes("--skip-build");
const WATERFALL = args.includes("--waterfall");

const MOCK_PORT = 5399;
const APP_PORT = 3199;
const CDP_PORT = 9339;
const SUPABASE_URL = `http://127.0.0.1:${MOCK_PORT}`;
const APP_URL = `http://127.0.0.1:${APP_PORT}/`;
const DIST_DIR = ".next-perf";

// Network profiles applied by Chrome to every request of the page.
// "slow-4g" is what Chrome DevTools and Lighthouse apply for their mobile "Slow 4G" preset
// (562.5 ms per request, 1.4 Mbit/s down, 675 kbit/s up) with Lighthouse's 4x CPU slowdown;
// "4g" is a typical 4G link (60 ms, 9 Mbit/s down, 1.5 Mbit/s up) with the same CPU slowdown.
// The budget (exit code) applies to "4g" on the load event; "slow-4g" is reported as a stress run.
const PROFILES = {
  "slow-4g": { latency: 562.5, downKbps: 1474.56, upKbps: 675, cpu: 4 },
  "4g": { latency: 60, downKbps: 9000, upKbps: 1500, cpu: 4 },
};
// The app loads nothing from other hosts. Antivirus or proxy software on the measuring machine
// can inject its own scripts into every page (Kaspersky does on the machine this was written
// on), which delays rendering and the load event; such hosts are blocked and reported.
const BLOCKED_URLS = ["*kaspersky-labs.com*", "*.scr.kaspersky*"];
const GATED_PROFILE = "4g";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64url = (buf) => Buffer.from(buf).toString("base64url");

// --- Signed session for a fake user, verified by getClaims() through the mock JWKS ---------

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const KID = "perf-key";
const jwk = { ...publicKey.export({ format: "jwk" }), kid: KID, alg: "ES256", use: "sig" };
const USER_ID = randomUUID();
const EMAIL = "ana@example.com";

function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "ES256", kid: KID, typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({ sub: USER_ID, email: EMAIL, role: "authenticated", aud: "authenticated", iat: now, exp: now + 3600, session_id: randomUUID() }),
  );
  const sig = sign("sha256", Buffer.from(`${header}.${payload}`), { key: privateKey, dsaEncoding: "ieee-p1363" });
  return `${header}.${payload}.${b64url(sig)}`;
}

function sessionCookie() {
  const token = accessToken();
  const session = {
    access_token: token,
    refresh_token: "perf-refresh",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: USER_ID, email: EMAIL, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} },
  };
  // @supabase/ssr storage key and encoding: sb-<first label of the host>-auth-token, "base64-" + base64url(JSON).
  return { name: `sb-${new URL(SUPABASE_URL).hostname.split(".")[0]}-auth-token`, value: `base64-${b64url(JSON.stringify(session))}` };
}

// --- Supabase stand-in ------------------------------------------------------------------

const MEMBER_A = randomUUID();
const MEMBER_B = randomUUID();
const homeRow = {
  family_id: randomUUID(),
  families: {
    timezone: "Europe/Lisbon",
    children: [{ name: "Lia", created_at: "2026-01-01T10:00:00+00:00" }],
    members: [
      { id: MEMBER_A, display_name: "Ana", color: "#2f6f5e" },
      { id: MEMBER_B, display_name: "Bruno", color: "#fde047" },
    ],
    custody_rules: [
      { id: randomUUID(), starts_on: "2026-01-04", first_member_id: MEMBER_A, handover_weekday: 0, handover_time: "18:00:00", valid_from: "2026-01-04", valid_to: null, created_at: "2026-01-01T10:00:00+00:00" },
    ],
    custody_overrides: [],
  },
};

const supabaseLog = [];
const mock = createServer(async (req, res) => {
  const path = req.url.split("?")[0];
  supabaseLog.push({ at: Date.now(), method: req.method, path });
  await sleep(SUPABASE_LATENCY_MS);
  const json = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (path === "/auth/v1/.well-known/jwks.json") return json(200, { keys: [jwk] });
  if (path === "/auth/v1/user") return json(200, { id: USER_ID, email: EMAIL, aud: "authenticated", role: "authenticated" });
  if (path === "/rest/v1/members") {
    const single = String(req.headers.accept ?? "").includes("vnd.pgrst.object");
    const row = { ...homeRow, id: MEMBER_A };
    return json(200, single ? row : [row]);
  }
  if (path.startsWith("/rest/v1/")) return json(200, []);
  json(404, { message: "not mocked" });
});

// --- Chrome DevTools Protocol -----------------------------------------------------------

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Set();
    ws.addEventListener("message", (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(`${msg.error.message}`)) : resolve(msg.result);
      } else for (const l of this.listeners) l(msg);
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.nextId;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  waitFor(method, sessionId, timeoutMs = 60_000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(l);
        reject(new Error(`timeout waiting for ${method}`));
      }, timeoutMs);
      const l = (msg) => {
        if (msg.method === method && msg.sessionId === sessionId) {
          clearTimeout(timer);
          this.listeners.delete(l);
          resolve(msg.params);
        }
      };
      this.listeners.add(l);
    });
  }
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ];
  const found = candidates.find((p) => p && existsSync(p));
  if (!found) throw new Error("Chrome not found; set CHROME_PATH");
  return found;
}

async function waitForHttp(url, timeoutMs = 60_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const r = await fetch(url, { redirect: "manual" });
      return r;
    } catch {
      await sleep(250);
    }
  }
  throw new Error(`${url} did not answer`);
}

// Largest Contentful Paint, collected in the page.
const LCP_SCRIPT = `
  window.__lcp = 0;
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) window.__lcp = Math.max(window.__lcp, e.startTime);
  }).observe({ type: "largest-contentful-paint", buffered: true });
`;

async function measure(cdp, profileName, warm) {
  const p = PROFILES[profileName];
  const { browserContextId } = await cdp.send("Target.createBrowserContext");
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const s = (m, params) => cdp.send(m, params, sessionId);

  const errors = [];
  const onMsg = (msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") errors.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
    if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") errors.push(`${msg.params.entry.text} ${msg.params.entry.url ?? ""}`);
  };
  cdp.listeners.add(onMsg);
  let documentAt = 0;
  const onDoc = (msg) => {
    if (msg.sessionId === sessionId && msg.method === "Network.responseReceived" && msg.params.type === "Document") documentAt = Date.now();
  };
  cdp.listeners.add(onDoc);

  await s("Page.enable");
  await s("Network.enable");
  await s("Runtime.enable");
  await s("Log.enable");
  await s("Page.addScriptToEvaluateOnNewDocument", { source: LCP_SCRIPT });
  await s("Network.setBlockedURLs", { urls: BLOCKED_URLS });
  // Chrome does not throttle the service worker's own fetches, so with the worker in the way a
  // repeat visit would get its HTML unthrottled. Bypass it: "repeat" = HTTP cache warm only.
  await s("Network.setBypassServiceWorker", { bypass: true });
  await s("Emulation.setDeviceMetricsOverride", { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true });
  await s("Emulation.setTouchEmulationEnabled", { enabled: true });
  await s("Network.setUserAgentOverride", { userAgent: ANDROID_UA });
  const cookie = sessionCookie();
  await s("Network.setCookie", { ...cookie, url: APP_URL, path: "/" });

  const navigate = async () => {
    const loaded = cdp.waitFor("Page.loadEventFired", sessionId);
    await s("Page.navigate", { url: APP_URL });
    await loaded;
  };
  if (warm) {
    // First visit unthrottled fills the HTTP cache (static chunks are immutable).
    await navigate();
    await sleep(1500);
  }
  await s("Network.emulateNetworkConditions", {
    offline: false,
    latency: p.latency,
    downloadThroughput: (p.downKbps * 1024) / 8,
    uploadThroughput: (p.upKbps * 1024) / 8,
  });
  await s("Emulation.setCPUThrottlingRate", { rate: p.cpu });

  const before = supabaseLog.length;
  const startedAt = Date.now();
  await navigate();
  await sleep(300);
  const { result } = await s("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const n = performance.getEntriesByType("navigation")[0];
      return { html: n.responseEnd, dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd, lcp: window.__lcp,
               bytes: performance.getEntriesByType("resource").reduce((t, r) => t + (r.transferSize || 0), n.transferSize || 0),
               foreign: performance.getEntriesByType("resource").map((r) => new URL(r.name).host).filter((h) => h !== location.host),
               waterfall: [n, ...performance.getEntriesByType("resource")].map((r) =>
                 [Math.round(r.startTime), Math.round(r.responseStart), Math.round(r.responseEnd), r.transferSize, r.name.replace(location.origin, "")]),
               text: document.querySelector('[data-testid="today"]')?.textContent ?? "" };
    })()`,
  });
  const duringRender = supabaseLog.slice(before).filter((r) => r.at >= startedAt && r.at <= documentAt);

  cdp.listeners.delete(onMsg);
  cdp.listeners.delete(onDoc);
  await cdp.send("Target.disposeBrowserContext", { browserContextId });
  return { ...result.value, supabase: duringRender, errors };
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const ms = (x) => `${Math.round(x)} ms`;

async function main() {
  await new Promise((r) => mock.listen(MOCK_PORT, "127.0.0.1", r));
  const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: "perf-anon-key", NEXT_DIST_DIR: DIST_DIR };
  const nextBin = join("node_modules", "next", "dist", "bin", "next");
  if (!SKIP_BUILD) {
    console.log(`Building into ${DIST_DIR} with NEXT_PUBLIC_SUPABASE_URL=${SUPABASE_URL} ...`);
    // next build adds "<distDir>/types/**/*.ts" to tsconfig.json; keep the file as committed.
    const tsconfig = readFileSync("tsconfig.json", "utf8");
    const b = spawnSync(process.execPath, [nextBin, "build"], { env, stdio: "inherit" });
    writeFileSync("tsconfig.json", tsconfig);
    if (b.status !== 0) throw new Error("next build failed");
  }
  const app = spawn(process.execPath, [nextBin, "start", "-p", String(APP_PORT), "-H", "127.0.0.1"], { env, stdio: "ignore" });
  const profileDir = mkdtempSync(join(tmpdir(), "perf-home-"));
  const chrome = spawn(findChrome(), [
    "--headless=new", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profileDir}`,
    "--no-first-run", "--no-default-browser-check", "--disable-extensions", "about:blank",
  ], { stdio: "ignore" });

  let exitCode = 0;
  try {
    await waitForHttp(APP_URL);
    const { webSocketDebuggerUrl } = await (await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/version`)).json();
    const ws = new WebSocket(webSocketDebuggerUrl);
    await new Promise((r, j) => {
      ws.addEventListener("open", r);
      ws.addEventListener("error", j);
    });
    const cdp = new Cdp(ws);

    // Warm the server (first render compiles nothing in production, but primes JWKS and caches).
    await fetch(APP_URL, { headers: { cookie: `${sessionCookie().name}=${sessionCookie().value}` } });

    console.log(`\nSupabase stand-in latency: ${SUPABASE_LATENCY_MS} ms per request; ${RUNS} runs each; budget ${BUDGET_MS} ms.`);
    for (const profile of Object.keys(PROFILES)) {
      for (const warm of [false, true]) {
        const runs = [];
        for (let i = 0; i < RUNS; i++) runs.push(await measure(cdp, profile, warm));
        const load = median(runs.map((r) => r.load));
        const lcp = median(runs.map((r) => r.lcp));
        const rendered = runs.every((r) => r.text.includes("está com"));
        const calls = runs.map((r) => r.supabase.length);
        const errors = [...new Set(runs.flatMap((r) => r.errors))];
        const ok = load < BUDGET_MS && rendered && errors.length === 0;
        // The budget applies to "4g"; "slow-4g" (DevTools' preset, the former "Fast 3G") is a stress
        // run reported for information. Errors or a missing home fail any profile.
        if ((profile === GATED_PROFILE && !ok) || !rendered || errors.length) exitCode = 1;
        console.log(
          `${profile.padEnd(8)} ${warm ? "repeat" : "first "}  HTML ${ms(median(runs.map((r) => r.html))).padStart(7)}  ` +
            `LCP ${ms(lcp).padStart(7)}  load ${ms(load).padStart(7)}  ` +
            `${Math.round(median(runs.map((r) => r.bytes)) / 1024)} KB  Supabase requests during render: ${[...new Set(calls)].join("/")}  ` +
            `${rendered ? "home rendered" : "HOME NOT RENDERED"}  ${errors.length ? `ERRORS: ${errors.join(" | ")}` : "no console errors"}  ${ok ? "OK" : profile === GATED_PROFILE ? "OVER BUDGET/FAILED" : "over budget (stress run)"}`,
        );
        const foreign = [...new Set(runs.flatMap((r) => r.foreign))];
        if (foreign.length) console.log(`         blocked requests injected by this machine (not the app): ${foreign.join(", ")}`);
        if (WATERFALL) {
          console.log("         start  firstByte  end  bytes  url (first run)");
          for (const [a, b, c, size, name] of runs[0].waterfall) console.log(`         ${a} ${b} ${c} ${size} ${name}`);
        }
        if (profile === "slow-4g" && !warm) {
          const paths = runs[0].supabase.map((r) => `${r.method} ${r.path}`);
          console.log(`         requests to Supabase for one render: ${paths.join(", ") || "(none)"}`);
        }
      }
    }
    ws.close();
  } finally {
    chrome.kill();
    app.kill();
    mock.close();
    await sleep(500);
    try {
      rmSync(profileDir, { recursive: true, force: true });
    } catch {
      // Chrome may still hold files on Windows; the temp dir is harmless.
    }
  }
  process.exit(exitCode);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

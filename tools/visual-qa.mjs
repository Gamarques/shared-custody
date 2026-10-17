// Visual/layout QA of every screen in a real Chrome, at phone, tablet and desktop widths.
// Re-run it after any UI change (new feature, redesign) instead of checking pages by hand.
// No dependencies: Chrome DevTools Protocol over Node's built-in WebSocket.
//
// Usage:
//   node tools/visual-qa.mjs                 # starts `npm run demo` on its own port, checks, stops it
//   node tools/visual-qa.mjs --url http://localhost:3000   # use a server that is already running
//   node tools/visual-qa.mjs --only /saldo,/despesas        # subset of routes (prefix match)
//   node tools/visual-qa.mjs --widths 390,1280              # subset of widths
//
// Needs Chrome or Edge (or CHROME_PATH). The app must be in DEMO mode (fake data, no login), which
// is what `npm run demo` gives. Screenshots go to .next-perf/visual-qa/ (gitignored): LOOK at them,
// the automatic checks only catch what is mechanical. See docs/qa-visual.md for the checklist.
//
// Automatic checks per route x width (a failure makes the exit code 1):
//   overflow      page is not wider than the viewport, and no element sticks out on the right
//   shell         >= 1024px: a sidebar is visible; < 1024px: a bottom tab bar is visible and the
//                 content can scroll clear of it (nothing hidden behind the bar)
//   h1            exactly one <h1> on the page
//   console       no console errors, no uncaught exceptions, no failed same-origin requests
//   touch         (phone only, warning) visible buttons/links/inputs smaller than 40px in height
//   empty         page rendered something (not a blank body or the Next error overlay)
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const EXTERNAL_URL = opt("url", "");
const ONLY = opt("only", "")
  .split(",")
  .filter(Boolean);
const WIDTHS = opt("widths", "390,768,1280")
  .split(",")
  .map(Number);
const APP_PORT = 3190;
const CDP_PORT = 9340;
const BASE = EXTERNAL_URL || `http://127.0.0.1:${APP_PORT}`;
const OUT = ".next-perf/visual-qa";
const HEIGHTS = { 390: 844, 768: 1024, 1280: 800 };

// Static routes. Dynamic ones (an expense's edit/history pages) are discovered from /despesas.
const ROUTES = [
  "/",
  "/calendario",
  "/guarda",
  "/excecoes",
  "/despesas",
  "/despesas/nova",
  "/saldo",
  "/convidar",
  "/login",
  "/convite/abcdefghijklmnopqrstuvwxyz123456",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error("Chrome/Edge not found. Set CHROME_PATH.");
  return found;
}

async function waitFor(url, ms = 90000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {}
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/F", "/T"]);
  else child.kill("SIGTERM");
}

// --- Minimal CDP client ----------------------------------------------------------------------

async function connect() {
  const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    } else if (msg.method) listeners.forEach((l) => l(msg));
  };
  return {
    send: (method, params = {}) =>
      new Promise((res, rej) => {
        const i = ++id;
        pending.set(i, { res, rej });
        ws.send(JSON.stringify({ id: i, method, params }));
      }),
    on: (fn) => listeners.push(fn),
    clearListeners: () => (listeners.length = 0),
    close: () => ws.close(),
  };
}

// Runs inside the page. Returns the mechanical findings for the current viewport.
const PAGE_CHECKS = `(() => {
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) !== 0;
  };
  const label = (el) => {
    const id = el.id ? "#" + el.id : "";
    const cls = typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\\s+/)[0] : "";
    return el.tagName.toLowerCase() + id + cls + (el.textContent ? ' "' + el.textContent.trim().slice(0, 30) + '"' : "");
  };
  const out = {};
  out.scrollWidth = document.documentElement.scrollWidth;
  out.viewport = vw;
  // Elements that stick out on the right and are not inside a horizontally scrollable ancestor.
  const insideScroller = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if ((ox === "auto" || ox === "scroll" || ox === "hidden") && p.scrollWidth > p.clientWidth) return true;
    }
    return false;
  };
  out.overflowing = [...document.querySelectorAll("body *")]
    .filter((el) => visible(el) && getComputedStyle(el).position !== "fixed")
    .filter((el) => el.getBoundingClientRect().right > vw + 1 && !insideScroller(el))
    .slice(0, 6)
    .map(label);
  out.h1 = document.querySelectorAll("h1").length;
  out.bodyText = document.body.innerText.trim().length;
  // The dev overlay is a shadow-DOM dialog; the always-present "N" badge is not an error.
  out.errorOverlay = !!document.querySelector("nextjs-portal")?.shadowRoot?.querySelector("[data-nextjs-dialog], [role=dialog]");
  // Shell: fixed/sticky bars pinned to the left edge (sidebar) or bottom edge (tab bar).
  const pinned = [...document.querySelectorAll("body *")].filter((el) => {
    const p = getComputedStyle(el).position;
    return (p === "fixed" || p === "sticky") && visible(el);
  });
  out.sidebar = pinned.some((el) => {
    const r = el.getBoundingClientRect();
    return r.left <= 1 && r.width >= 160 && r.width <= 420 && r.height >= vh * 0.6;
  });
  const bar = pinned.find((el) => {
    const r = el.getBoundingClientRect();
    return r.bottom >= vh - 1 && r.width >= vw * 0.9 && r.height >= 40 && r.height <= 140;
  });
  out.bottomBar = bar ? Math.round(bar.getBoundingClientRect().height) : 0;
  // Can the last piece of content scroll clear of the bottom bar?
  window.scrollTo(0, document.documentElement.scrollHeight);
  const main = document.querySelector("main") || document.body;
  const kids = [...main.querySelectorAll("*")].filter((el) => visible(el) && getComputedStyle(el).position !== "fixed");
  const lowest = kids.reduce((m, el) => Math.max(m, el.getBoundingClientRect().bottom), 0);
  out.contentBottomGap = bar ? Math.round(bar.getBoundingClientRect().top - lowest) : null;
  window.scrollTo(0, 0);
  // Touch targets.
  out.smallTargets = [...document.querySelectorAll("a[href], button, input:not([type=hidden]), select, textarea, summary")]
    .filter(visible)
    .filter((el) => el.getBoundingClientRect().height < 40 && !el.closest("[hidden]") && !el.matches(".skip-link"))
    .slice(0, 8)
    .map((el) => label(el) + " " + Math.round(el.getBoundingClientRect().height) + "px");
  out.links = [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href"));
  return out;
})()`;

const slug = (route) => (route === "/" ? "home" : route.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-").slice(0, 40));

async function main() {
  mkdirSync(OUT, { recursive: true });
  let server;
  let chrome;
  const profile = mkdtempSync(join(tmpdir(), "visual-qa-"));
  const cleanup = () => {
    killTree(chrome);
    killTree(server);
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {}
  };
  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });

  try {
    if (!EXTERNAL_URL) {
      // A separate dist dir so a dev server the user already runs on :3000 does not clash.
      server = spawn(process.execPath, ["scripts/demo.mjs", "-p", String(APP_PORT)], {
        env: { ...process.env, NEXT_DIST_DIR: ".next-perf/visual-qa-dev" },
        stdio: "ignore",
      });
    }
    await waitFor(`${BASE}/api/health`);

    chrome = spawn(
      findChrome(),
      [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${profile}`,
        "--no-first-run",
        "about:blank",
      ],
      { stdio: "ignore" },
    );
    await waitFor(`http://127.0.0.1:${CDP_PORT}/json/version`, 20000);
    const cdp = await connect();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");

    let consoleProblems = [];
    cdp.on((m) => {
      if (m.method === "Runtime.exceptionThrown") consoleProblems.push("exception: " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split("\n")[0]);
      if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error")
        consoleProblems.push("console.error: " + m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 160));
      if (m.method === "Network.responseReceived" && m.params.response.status >= 400 && m.params.response.url.startsWith(BASE))
        consoleProblems.push(`HTTP ${m.params.response.status} ${m.params.response.url.replace(BASE, "")}`);
    });

    const goto = async (path) => {
      await cdp.send("Page.navigate", { url: BASE + path });
      await sleep(400);
      for (let i = 0; i < 40; i++) {
        const r = await cdp.send("Runtime.evaluate", { expression: "document.readyState" });
        if (r.result.value === "complete") break;
        await sleep(250);
      }
      await sleep(700); // hydration and entrance animations
    };

    // Discover the dynamic expense pages from the list.
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await goto("/despesas");
    const links = (await cdp.send("Runtime.evaluate", { expression: PAGE_CHECKS, returnByValue: true })).result.value.links;
    const dyn = ["editar", "historico"]
      .map((k) => links.find((l) => new RegExp(`^/despesas/[^/]+/${k}$`).test(l)))
      .filter(Boolean);
    const routes = [...ROUTES, ...dyn].filter((r) => !ONLY.length || ONLY.some((o) => r.startsWith(o)));

    const results = [];
    for (const width of WIDTHS) {
      const height = HEIGHTS[width] || 900;
      const mobile = width < 700;
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
      for (const route of routes) {
        consoleProblems = [];
        await goto(route);
        const r = (await cdp.send("Runtime.evaluate", { expression: PAGE_CHECKS, returnByValue: true })).result.value;
        const failures = [];
        const warnings = [];
        if (r.scrollWidth > r.viewport + 1) failures.push(`overflow: page is ${r.scrollWidth}px wide in a ${r.viewport}px viewport`);
        if (r.overflowing.length) failures.push("overflow: sticks out on the right: " + r.overflowing.join(" | "));
        if (r.bodyText < 20 || r.errorOverlay) failures.push("empty: blank page or error overlay");
        if (r.h1 !== 1) failures.push(`h1: found ${r.h1}, expected 1`);
        if (consoleProblems.length) failures.push("console: " + [...new Set(consoleProblems)].slice(0, 4).join(" | "));
        // Pages outside the shell (login, invite) have neither sidebar nor bar.
        const noShell = /^\/(login|convite|onboarding)/.test(route);
        if (!noShell) {
          if (width >= 1024 && !r.sidebar) failures.push("shell: no sidebar at desktop width");
          if (width < 1024 && !r.bottomBar) failures.push("shell: no bottom tab bar below 1024px");
          if (width < 1024 && r.bottomBar && r.contentBottomGap !== null && r.contentBottomGap < 8)
            failures.push(`shell: last content is ${-r.contentBottomGap}px behind the bottom bar`);
        }
        if (mobile && r.smallTargets.length) warnings.push("touch: " + r.smallTargets.join(" | "));
        const shot = join(OUT, `${slug(route)}-${width}.png`);
        const img = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
        writeFileSync(shot, Buffer.from(img.data, "base64"));
        results.push({ route, width, failures, warnings, shot });
      }
    }

    let bad = 0;
    for (const r of results) {
      const status = r.failures.length ? "FAIL" : r.warnings.length ? "warn" : "ok  ";
      console.log(`${status} ${String(r.width).padStart(4)}px ${r.route}`);
      for (const f of r.failures) console.log("       - " + f);
      for (const w of r.warnings) console.log("       ~ " + w);
      if (r.failures.length) bad++;
    }
    console.log(`\n${results.length} checks, ${bad} failing. Screenshots: ${OUT}/ (look at them).`);
    cdp.close();
    cleanup();
    process.exit(bad ? 1 : 0);
  } catch (e) {
    console.error(e);
    cleanup();
    process.exit(2);
  }
}

main();

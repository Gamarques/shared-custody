// Shared by tools/visual-qa.mjs and tools/qa-states.mjs: Chrome lookup, a minimal CDP client and the in-page checks.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function findChrome() {
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

export async function waitFor(url, ms = 90000) {
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

export function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/F", "/T"]);
  else child.kill("SIGTERM");
}

// --- Minimal CDP client ----------------------------------------------------------------------

export async function connect(CDP_PORT) {
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
export const PAGE_CHECKS = `(() => {
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
    .filter((el) => el.getBoundingClientRect().height < 44 &&!el.closest("[hidden]") && !el.matches(".skip-link"))
    .slice(0, 8)
    .map((el) => label(el) + " " + Math.round(el.getBoundingClientRect().height) + "px");
  out.links = [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href"));
  return out;
})()`;

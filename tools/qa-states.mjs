// Screenshots of the screens and states that tools/visual-qa.mjs cannot reach with the default demo data:
// onboarding, the invite flow, empty states, load errors, hover, keyboard focus and delete confirmations.
// Same approach as visual-qa: Chrome over CDP, no dependencies. Needs Chrome or Edge (or CHROME_PATH).
//
// Usage:
//   node tools/qa-states.mjs                        # every scenario at 390 and 1280
//   node tools/qa-states.mjs --only empty,error     # subset of demo variants
//   node tools/qa-states.mjs --widths 390
//
// One demo server per data set (DEMO_VARIANT, see src/lib/demo/seed.ts), started and stopped here:
//   default    the regular demo: full invite, delete confirmations, hover, keyboard focus
//   solo       Ana alone in her family: /convidar before and after generating the link
//   no-family  Ana without a family: /onboarding, /convite/<valid token>
//   empty      a family with no data: every list/summary screen in its empty state
//   error      reading `expenses` fails: the "could not load" states
// Screenshots go to .next-perf/visual-qa/states/ (gitignored): LOOK at them. The log lists, per capture,
// the mechanical findings (overflow, blank page, touch targets under 44px on the phone width).
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, findChrome, killTree, PAGE_CHECKS, sleep, waitFor } from "./qa-common.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const ONLY = opt("only", "").split(",").filter(Boolean);
const WIDTHS = opt("widths", "390,1280").split(",").map(Number);
const CDP_PORT = 9341;
const OUT = ".next-perf/visual-qa/states";
const HEIGHTS = { 390: 844, 1280: 800 };
const INVITE_TOKEN = "d3adbeef".repeat(8); // DEMO_INVITE_TOKEN in src/lib/demo/seed.ts

const log = [];
let bad = 0;

async function main() {
  mkdirSync(OUT, { recursive: true });
  let server;
  let chrome;
  const profile = mkdtempSync(join(tmpdir(), "qa-states-"));
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
    chrome = spawn(
      findChrome(),
      ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "about:blank"],
      { stdio: "ignore" },
    );
    await waitFor(`http://127.0.0.1:${CDP_PORT}/json/version`, 20000);
    const cdp = await connect(CDP_PORT);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");

    let base = "";
    let problems = [];
    let dialogs = [];
    cdp.on((m) => {
      if (m.method === "Runtime.exceptionThrown") problems.push("exception: " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split("\n")[0]);
      if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error")
        problems.push("console.error: " + m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 160));
      if (m.method === "Network.responseReceived" && m.params.response.status >= 400 && m.params.response.url.startsWith(base))
        problems.push(`HTTP ${m.params.response.status} ${m.params.response.url.replace(base, "")}`);
      if (m.method === "Page.javascriptDialogOpening") {
        dialogs.push(`${m.params.type}: ${m.params.message}`);
        cdp.send("Page.handleJavaScriptDialog", { accept: false }).catch(() => {});
      }
    });

    const evaluate = async (expression) => {
      const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    };
    const settle = async (ms = 700) => {
      await sleep(400);
      for (let i = 0; i < 40; i++) {
        if ((await evaluate("document.readyState")) === "complete") break;
        await sleep(250);
      }
      await sleep(ms); // hydration and entrance animations
    };
    const goto = async (path) => {
      await cdp.send("Page.navigate", { url: base + path });
      await settle();
    };
    const click = async (selector, text) => {
      const ok = await evaluate(`(() => {
        const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
        const el = ${text ? `els.find((e) => e.textContent.includes(${JSON.stringify(text)}))` : "els[0]"};
        if (!el) return false;
        el.click();
        return true;
      })()`);
      await sleep(600);
      return ok;
    };
    const exists = (selector, text) =>
      evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].some((e) => ${text ? `e.textContent.includes(${JSON.stringify(text)})` : "true"})`);
    const centerOf = (selector) =>
      evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        el.scrollIntoView({ block: "center" });
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()`);
    const press = async (key, code, keyCode) => {
      const ev = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
      await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...ev });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...ev });
      await sleep(150);
    };
    const describeFocus = () =>
      evaluate(`(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          what: el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + ' "' + (el.getAttribute("aria-label") || el.textContent || el.value || "").trim().slice(0, 30) + '"',
          focusVisible: el.matches(":focus-visible"),
          outline: s.outlineStyle + " " + s.outlineWidth + " " + s.outlineColor,
          boxShadow: s.boxShadow,
          size: Math.round(r.width) + "x" + Math.round(r.height),
        };
      })()`);

    // Takes the screenshot and runs the mechanical checks. `viewportOnly` keeps hover/focus visible.
    const shot = async (variant, width, name, { viewportOnly = false, shell = true, note = "" } = {}) => {
      const r = await evaluate(PAGE_CHECKS);
      const failures = [];
      const warnings = [];
      if (r.scrollWidth > r.viewport + 1) failures.push(`overflow: page is ${r.scrollWidth}px wide in a ${r.viewport}px viewport`);
      if (r.overflowing.length) failures.push("overflow: sticks out on the right: " + r.overflowing.join(" | "));
      if (r.bodyText < 20 || r.errorOverlay) failures.push("empty: blank page or error overlay");
      if (r.h1 !== 1) warnings.push(`h1: found ${r.h1}, expected 1`);
      if (shell && width < 1024 && !r.bottomBar) warnings.push("shell: no bottom tab bar");
      if (shell && width >= 1024 && !r.sidebar) warnings.push("shell: no sidebar");
      if (width < 700 && r.smallTargets.length) warnings.push("touch: " + r.smallTargets.join(" | "));
      const found = [...new Set(problems)];
      if (found.length) warnings.push("console: " + found.slice(0, 4).join(" | "));
      const file = join(OUT, `${name}-${width}.png`);
      const img = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: !viewportOnly });
      writeFileSync(file, Buffer.from(img.data, "base64"));
      log.push({ variant, width, name, file, failures, warnings, note });
      if (failures.length) bad++;
    };

    // --- scenarios ----------------------------------------------------------------------------
    const scenarios = {
      default: [
        async (w) => {
          await goto("/convidar");
          await shot("default", w, "convidar-family-full");
        },
        async (w) => {
          await goto("/despesas");
          const opened = await click('button[aria-label="Eliminar"]');
          const shown = await exists('[data-testid="delete-confirm"]');
          await shot("default", w, "despesas-delete-confirm", { note: opened && shown ? "inline confirmation open (not window.confirm)" : "delete confirmation did not open" });
        },
        async (w) => {
          await goto("/excecoes");
          await shot("default", w, "excecoes-before-confirm", { note: "state just before the window.confirm" });
          dialogs = [];
          const clicked = await click("button.btn-danger", "Remover");
          await sleep(400);
          log[log.length - 1].note += clicked
            ? dialogs.length
              ? `; window.confirm opened with ${JSON.stringify(dialogs[0])} and was dismissed (headless cannot screenshot a native dialog)`
              : "; clicked Remover but no dialog opened"
            : "; no Remover button on the page";
        },
        async (w) => {
          // Hover: only meaningful with a mouse (>= 1024px), still captured at the phone width for the record.
          await goto("/despesas");
          for (const [name, selector] of [
            ["hover-primary-button", ".btn-primary"],
            ["hover-delete-icon", 'button[aria-label="Eliminar"]'],
            ["hover-nav-link", "nav a:not([aria-current])"],
          ]) {
            const c = await centerOf(selector);
            if (!c) {
              log.push({ variant: "default", width: w, name, file: "-", failures: [], warnings: [`not reachable: no ${selector}`], note: "" });
              continue;
            }
            await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: c.x, y: c.y });
            await sleep(400);
            await shot("default", w, name, { viewportOnly: true, note: w < 700 ? "phone width: a touch device has no hover, kept for completeness" : "" });
          }
          await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 });
        },
        async (w) => {
          // Keyboard focus: real Tab key events so :focus-visible applies.
          await goto("/despesas");
          for (const stops of [1, 5]) {
            await evaluate("document.activeElement?.blur(); window.scrollTo(0, 0)");
            for (let i = 0; i < stops; i++) await press("Tab", "Tab", 9);
            const f = await describeFocus();
            await shot("default", w, `focus-tab-${stops}`, { viewportOnly: true, note: "focus: " + JSON.stringify(f) });
          }
          await goto("/despesas/nova");
          let f = null;
          for (let i = 0; i < 40; i++) {
            await press("Tab", "Tab", 9);
            f = await describeFocus();
            if (f && /^(input|select|textarea)/.test(f.what)) break;
          }
          await shot("default", w, "focus-field", { viewportOnly: true, note: "focus: " + JSON.stringify(f) });
        },
      ],
      solo: [
        async (w) => {
          await goto("/convidar");
          if (await exists("button", "Cancelar convite")) {
            await click("button", "Cancelar convite");
            await goto("/convidar");
          }
          await shot("solo", w, "convidar-form");
          await click('main button[type="submit"]');
          await sleep(400);
          const generated = await exists("[aria-label='Ligação do convite']");
          await shot("solo", w, "convidar-link-generated", { note: generated ? "link field visible" : "link NOT generated" });
        },
      ],
      "no-family": [
        async (w) => {
          await goto("/onboarding");
          await shot("no-family", w, "onboarding", { shell: false });
          await click('main button[type="submit"]');
          await sleep(300);
          await shot("no-family", w, "onboarding-validation-errors", { shell: false, note: (await exists("[role=alert]")) ? "alerts shown" : "no alert shown" });
        },
        async (w) => {
          await goto("/convite/" + INVITE_TOKEN);
          await shot("no-family", w, "convite-accept-form", { shell: false });
          await click('main button[type="submit"]');
          await sleep(300);
          await shot("no-family", w, "convite-accept-validation", { shell: false, note: (await exists("[role=alert]")) ? "alerts shown" : "no alert shown after submitting empty" });
        },
        async (w) => {
          await goto("/");
          const at = await evaluate("location.pathname");
          await shot("no-family", w, "home-without-family", { shell: false, note: "lands on " + at });
        },
      ],
      empty: ["/", "/calendario", "/guarda", "/excecoes", "/despesas", "/despesas/nova", "/saldo"].map((route) => async (w) => {
        await goto(route);
        await shot("empty", w, "empty" + (route === "/" ? "-home" : route.replace(/\//g, "-")));
      }),
      error: ["/", "/despesas", "/saldo"].map((route) => async (w) => {
        await goto(route);
        await shot("error", w, "error" + (route === "/" ? "-home" : route.replace(/\//g, "-")));
      }),
    };

    // --- run ------------------------------------------------------------------------------------
    let n = 0;
    for (const [variant, steps] of Object.entries(scenarios)) {
      if (ONLY.length && !ONLY.includes(variant)) continue;
      const port = 3191 + n++;
      // A leftover server on this port would be mistaken for the one started below (wrong data set).
      if (await fetch(`http://localhost:${port}/api/health`).then(() => true, () => false)) throw new Error(`port ${port} is already in use: stop the stale dev server`);
      server = spawn(process.execPath, ["scripts/demo.mjs", "-p", String(port)], {
        env: { ...process.env, DEMO_VARIANT: variant, NEXT_DIST_DIR: `.next-perf/qa-states-dev-${variant}` },
        stdio: "ignore",
      });
      // "localhost", not 127.0.0.1: `next dev` blocks its client chunks for other origins, so nothing would hydrate.
      base = `http://localhost:${port}`;
      await waitFor(`${base}/api/health`);
      for (const width of WIDTHS) {
        const mobile = width < 700;
        await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: HEIGHTS[width] || 900, deviceScaleFactor: mobile ? 2 : 1, mobile });
        for (const step of steps) {
          problems = [];
          try {
            await step(width);
          } catch (e) {
            bad++;
            log.push({ variant, width, name: "(step crashed)", file: "-", failures: [String(e.message || e).split("\n")[0]], warnings: [], note: "" });
          }
        }
      }
      killTree(server);
      server = undefined;
    }

    for (const r of log) {
      const status = r.failures.length ? "FAIL" : r.warnings.length ? "warn" : "ok  ";
      console.log(`${status} ${String(r.width).padStart(4)}px ${r.variant}/${r.name}  ${r.file}`);
      if (r.note) console.log("       . " + r.note);
      for (const f of r.failures) console.log("       - " + f);
      for (const w of r.warnings) console.log("       ~ " + w);
    }
    console.log(`\n${log.length} captures, ${bad} failing. Screenshots: ${OUT}/ (look at them).`);
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

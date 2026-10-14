import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  CACHE_PAGES_MESSAGE,
  cachePagesMessage,
  formatSavedAt,
  pagesToCache,
  requestOfflineCopy,
  staticAssets,
} from "./offline";

const ORIGIN = "https://guarda.example";

describe("pagesToCache", () => {
  it("stores the URL shown and its canonical month URL", () => {
    expect(pagesToCache(`${ORIGIN}/calendario`, "/calendario?mes=2026-10", ORIGIN)).toEqual([
      "/calendario",
      "/calendario?mes=2026-10",
    ]);
  });
  it("does not repeat the canonical URL", () => {
    expect(pagesToCache(`${ORIGIN}/calendario?mes=2026-11`, "/calendario?mes=2026-11", ORIGIN)).toEqual([
      "/calendario?mes=2026-11",
    ]);
  });
  it("drops the hash and other origins", () => {
    expect(pagesToCache(`${ORIGIN}/calendario?mes=2026-11#x`, "https://evil.example/x", ORIGIN)).toEqual([
      "/calendario?mes=2026-11",
    ]);
  });
});

describe("staticAssets", () => {
  it("keeps only the build's same-origin static files, once each", () => {
    expect(
      staticAssets(
        [
          `${ORIGIN}/_next/static/chunks/app.js`,
          `${ORIGIN}/_next/static/chunks/app.js`,
          `${ORIGIN}/_next/static/css/app.css`,
          `${ORIGIN}/api/health`,
          `${ORIGIN}/calendario?_rsc=abc`,
          "https://abcd1234.supabase.co/rest/v1/members",
          "https://cdn.example/_next/static/x.js",
          "not a url ::",
        ],
        ORIGIN,
      ),
    ).toEqual(["/_next/static/chunks/app.js", "/_next/static/css/app.css"]);
  });
});

describe("requestOfflineCopy", () => {
  it("posts the message to the active worker", async () => {
    const postMessage = vi.fn();
    const msg = cachePagesMessage(["/calendario"], []);
    await requestOfflineCopy({ ready: Promise.resolve({ active: { postMessage } }) }, msg);
    expect(postMessage).toHaveBeenCalledWith({ type: CACHE_PAGES_MESSAGE, pages: ["/calendario"], assets: [] });
  });
  it("does nothing without service worker support or an active worker", async () => {
    await expect(requestOfflineCopy(undefined, cachePagesMessage([], []))).resolves.toBeUndefined();
    await expect(
      requestOfflineCopy({ ready: Promise.resolve({ active: null }) }, cachePagesMessage([], [])),
    ).resolves.toBeUndefined();
  });
});

describe("formatSavedAt", () => {
  it("pads day, month, hour and minute", () => {
    expect(formatSavedAt({ year: 2026, month: 3, day: 5, hour: 7, minute: 4 })).toBe("05/03/2026 07:04");
  });
});

it("message type matches the service worker", () => {
  expect(readFileSync("public/sw.js", "utf8")).toContain(`const CACHE_PAGES_MESSAGE = "${CACHE_PAGES_MESSAGE}";`);
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildManifest } from "./manifest";
import { config } from "@/proxy";

const read = (p: string) => readFileSync(p);

describe("manifest", () => {
  const m = buildManifest();
  it("is installable (name, start_url, standalone, 192+512 icons)", () => {
    expect(m.name).toBeTruthy();
    expect(m.start_url).toBe("/");
    expect(m.display).toBe("standalone");
    const sizes = (m.icons ?? []).map((i) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect((m.icons ?? []).some((i) => i.purpose === "maskable")).toBe(true);
  });
  it("icon files exist with declared dimensions", () => {
    for (const icon of m.icons ?? []) {
      const buf = read(`public${icon.src}`);
      expect(buf.subarray(1, 4).toString()).toBe("PNG");
      const [w, h] = String(icon.sizes).split("x").map(Number);
      expect(buf.readUInt32BE(16)).toBe(w);
      expect(buf.readUInt32BE(20)).toBe(h);
    }
  });
  it("has 180x180 apple-touch-icon", () => {
    const buf = read("public/icons/apple-touch-icon.png");
    expect(buf.readUInt32BE(16)).toBe(180);
    expect(buf.readUInt32BE(20)).toBe(180);
  });
});

describe("service worker", () => {
  const sw = read("public/sw.js").toString();
  it("handles install/activate/fetch and offline fallback", () => {
    for (const ev of ["install", "activate", "fetch"]) expect(sw).toContain(`addEventListener("${ev}"`);
    expect(sw).toContain("/offline.html");
  });
  it("never caches API or auth routes", () => {
    expect(sw).toContain('"/api/"');
    expect(sw).toContain('"/auth/"');
  });
  it("offline page exists", () => {
    expect(read("public/offline.html").toString()).toContain("Sem conexão");
  });
});

describe("proxy matcher", () => {
  const re = new RegExp("^" + config.matcher[0] + "$");
  it("lets PWA assets bypass auth redirect", () => {
    for (const p of ["/manifest.webmanifest", "/sw.js", "/offline.html", "/icons/icon-192.png"]) {
      expect(re.test(p)).toBe(false);
    }
    expect(re.test("/convidar")).toBe(true);
  });
});

import { unstable_doesMiddlewareMatch, unstable_getResponseFromNextConfig } from "next/experimental/testing/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import nextConfig, { contentSecurityPolicy } from "../../next.config";
import { config as proxyConfig } from "../proxy";

// Security review 2026-11-04 (docs/security-review.md): proxy coverage and response headers.

const runsProxy = (url: string) => unstable_doesMiddlewareMatch({ config: proxyConfig, nextConfig, url });

describe("proxy matcher", () => {
  it("runs on every page and route handler, including paths that look like files", () => {
    for (const url of [
      "/",
      "/admin",
      "/despesas",
      "/despesas/exportar?mes=2026-11",
      "/convite/abc.png",
      "/convite/abc.jpg",
      "/convite/abc.svg",
      "/convite/sw.js",
      "/despesas/x.png/historico",
      "/admin.png",
      "/sw.jsx",
      "/offline.html/x",
      "/manifest.webmanifestx",
      "/favicon.icox",
      "/_next/staticx",
      "/iconsx/a.png",
      "/api/demo",
      "/api/health",
    ]) {
      expect(runsProxy(url), url).toBe(true);
    }
  });

  it("skips only Next.js assets and the public files needed without a session", () => {
    for (const url of [
      "/_next/static/chunks/app.js",
      "/_next/image?url=%2Ficons%2Ficon-192.png&w=64&q=75",
      "/favicon.ico",
      "/manifest.webmanifest",
      "/sw.js",
      "/offline.html",
      "/icons/icon-192.png",
      "/icons/apple-touch-icon.png",
    ]) {
      expect(runsProxy(url), url).toBe(false);
    }
  });
});

describe("security headers (next.config.ts)", () => {
  afterEach(() => vi.unstubAllEnvs());

  async function headersFor(url: string) {
    return (await unstable_getResponseFromNextConfig({ url, nextConfig })).headers;
  }

  it("sends the hardening headers on pages, API routes and static files", async () => {
    for (const path of ["/", "/despesas/nova", "/api/health", "/api/cron/keepalive", "/icons/icon-192.png", "/sw.js"]) {
      const h = await headersFor(`https://shared-custody.vercel.app${path}`);
      expect(h.get("strict-transport-security"), path).toBe("max-age=63072000; includeSubDomains");
      expect(h.get("x-content-type-options"), path).toBe("nosniff");
      expect(h.get("referrer-policy"), path).toBe("strict-origin-when-cross-origin");
      expect(h.get("x-frame-options"), path).toBe("DENY");
      expect(h.get("permissions-policy"), path).toContain("camera=()");
      expect(h.get("content-security-policy"), path).toContain("frame-ancestors 'none'");
    }
  });

  it("does not advertise the framework or ship browser source maps", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
    expect(nextConfig.productionBrowserSourceMaps).toBe(false);
  });
});

describe("content security policy", () => {
  const prod = contentSecurityPolicy({ supabaseUrl: "https://lmqamwidjbwquefpjxlr.supabase.co/", dev: false });
  const directive = (csp: string, name: string) =>
    csp
      .split("; ")
      .find((d) => d.startsWith(`${name} `))
      ?.split(" ")
      .slice(1);

  it("lets the browser talk only to this origin and the Supabase project (https + wss)", () => {
    expect(directive(prod, "connect-src")).toEqual([
      "'self'",
      "https://lmqamwidjbwquefpjxlr.supabase.co",
      "wss://lmqamwidjbwquefpjxlr.supabase.co",
    ]);
    expect(directive(prod, "img-src")).toEqual(["'self'", "data:", "blob:", "https://lmqamwidjbwquefpjxlr.supabase.co"]);
    expect(directive(prod, "default-src")).toEqual(["'self'"]);
  });

  it("blocks plugins, framing, foreign forms and <base> hijacking; no eval in production", () => {
    expect(directive(prod, "object-src")).toEqual(["'none'"]);
    expect(directive(prod, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(prod, "frame-src")).toEqual(["'none'"]);
    expect(directive(prod, "form-action")).toEqual(["'self'"]);
    expect(directive(prod, "base-uri")).toEqual(["'self'"]);
    expect(directive(prod, "script-src")).not.toContain("'unsafe-eval'");
    expect(prod).not.toContain("*");
  });

  it("adds only what next dev needs in development, and nothing foreign without a Supabase URL", () => {
    const dev = contentSecurityPolicy({ supabaseUrl: undefined, dev: true });
    expect(directive(dev, "script-src")).toEqual(["'self'", "'unsafe-inline'", "'unsafe-eval'"]);
    expect(directive(dev, "connect-src")).toEqual(["'self'", "ws:"]);
    expect(contentSecurityPolicy({ supabaseUrl: "not a url", dev: false })).not.toContain("not");
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import Home from "./page";
import { GET } from "./api/health/route";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("home page", () => {
  it("renders without Supabase configured", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const html = renderToStaticMarkup(<Home />);
    expect(html).toContain("<h1>Guarda Compartilhada</h1>");
    expect(html).toContain("Supabase ainda não configurado");
  });

  it("reports Supabase as configured when env vars are set", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcd1234.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    expect(renderToStaticMarkup(<Home />)).toContain("Supabase configurado.");
  });
});

describe("GET /api/health", () => {
  it("returns ok and the Supabase status", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const res = GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, supabaseConfigured: false });
  });
});

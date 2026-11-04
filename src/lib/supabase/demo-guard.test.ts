import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DemoModeInProductionError, isDemoAllowed, shouldUseDemoClient } from "./demo-guard";
import { updateSession } from "./proxy";
import { createClient } from "./server";

afterEach(() => vi.unstubAllEnvs());

function demoOn() {
  vi.stubEnv("DEMO_MODE", "1");
  vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "1");
}

describe("demo mode never runs on the production deployment", () => {
  it("is off without DEMO_MODE, whatever VERCEL_ENV says", () => {
    vi.stubEnv("DEMO_MODE", "");
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "");
    for (const env of ["", "preview", "production"]) {
      vi.stubEnv("VERCEL_ENV", env);
      expect(isDemoAllowed()).toBe(false);
      expect(shouldUseDemoClient()).toBe(false);
    }
  });

  it("is allowed locally and on preview deployments", () => {
    demoOn();
    for (const env of ["", "development", "preview"]) {
      vi.stubEnv("VERCEL_ENV", env);
      expect(isDemoAllowed()).toBe(true);
      expect(shouldUseDemoClient()).toBe(true);
    }
  });

  it("fails closed in production: no fake client from any server factory", async () => {
    demoOn();
    vi.stubEnv("VERCEL_ENV", "production");
    expect(isDemoAllowed()).toBe(false);
    expect(() => shouldUseDemoClient()).toThrow(DemoModeInProductionError);
    await expect(createClient()).rejects.toThrow(DemoModeInProductionError);
    // The proxy runs on every page: it errors instead of letting the fake signed-in admin through.
    await expect(updateSession(new NextRequest("https://shared-custody.vercel.app/admin"))).rejects.toThrow(
      DemoModeInProductionError,
    );
  });
});

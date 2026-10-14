import { afterEach, describe, expect, it, vi } from "vitest";
import { getPublicEnv, isSupabaseConfigured, MissingEnvError, parsePublicEnv } from "./env";

const valid = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abcd1234.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
};

describe("parsePublicEnv", () => {
  it("returns the Supabase settings when both are present", () => {
    expect(parsePublicEnv(valid)).toEqual({
      supabaseUrl: "https://abcd1234.supabase.co",
      supabaseAnonKey: "anon-key",
    });
  });

  it("trims whitespace and trailing slashes", () => {
    expect(
      parsePublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: "  https://abcd1234.supabase.co/  ",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: " anon-key\n",
      }),
    ).toEqual({ supabaseUrl: "https://abcd1234.supabase.co", supabaseAnonKey: "anon-key" });
  });

  it("lists every missing variable", () => {
    try {
      parsePublicEnv({ NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "   " });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(MissingEnvError);
      expect((err as MissingEnvError).missing).toEqual([
        "NEXT_PUBLIC_SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      ]);
    }
  });

  it("rejects an invalid URL", () => {
    expect(() => parsePublicEnv({ ...valid, NEXT_PUBLIC_SUPABASE_URL: "not a url" })).toThrow(/not a valid URL/);
  });

  it("rejects plain http outside localhost", () => {
    expect(() => parsePublicEnv({ ...valid, NEXT_PUBLIC_SUPABASE_URL: "http://abcd1234.supabase.co" })).toThrow(
      /must use https/,
    );
  });

  it("allows http for a local Supabase stack", () => {
    expect(parsePublicEnv({ ...valid, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" }).supabaseUrl).toBe(
      "http://127.0.0.1:54321",
    );
  });
});

describe("getPublicEnv / isSupabaseConfigured", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads from process.env", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", valid.NEXT_PUBLIC_SUPABASE_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", valid.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    expect(getPublicEnv().supabaseUrl).toBe(valid.NEXT_PUBLIC_SUPABASE_URL);
    expect(isSupabaseConfigured()).toBe(true);
  });

  it("reports not configured instead of throwing", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    expect(isSupabaseConfigured()).toBe(false);
  });
});

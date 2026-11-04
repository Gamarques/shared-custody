import { describe, expect, it } from "vitest";
import { isPublicPath, isValidEmail, safeNextPath } from "./paths";

describe("safeNextPath", () => {
  it("keeps same-origin paths", () => {
    expect(safeNextPath("/calendario?m=3")).toBe("/calendario?m=3");
  });
  it("keeps percent-encoded paths, which stay on this origin", () => {
    expect(safeNextPath("/%2F%2Fevil.com")).toBe("/%2F%2Fevil.com");
    expect(new URL(safeNextPath("/%2F%2Fevil.com"), "https://app.example").host).toBe("app.example");
    expect(safeNextPath("/convite/abc?x=%2F%2Fevil.com")).toBe("/convite/abc?x=%2F%2Fevil.com");
  });
  it.each([
    null,
    undefined,
    "",
    "evil",
    "https://evil.com",
    "javascript:alert(1)",
    "//evil.com",
    "///evil.com",
    "/\\evil.com",
    "\\/evil.com",
    "/\\/evil.com",
    // What searchParams.get() returns for %09, %0A, %0D, %00, %20 and %7F: the URL parser drops
    // tab and newline, so "/\t/evil.com" would resolve to https://evil.com/.
    "/\t/evil.com",
    "/\n/evil.com",
    "/\r/evil.com",
    "/\u0000/evil.com",
    "/ /evil.com",
    "/\u007f/evil.com",
    `/${"a".repeat(2048)}`,
  ])("falls back to / for %j", (v) => expect(safeNextPath(v)).toBe("/"));

  it("never yields a destination on another origin, as the callback route resolves it", () => {
    const attacks = ["/%09/evil.com", "/%0a/evil.com", "/%5Cevil.com", "/%5C%5Cevil.com", "%2F%2Fevil.com", "/%2F/evil.com"];
    for (const raw of attacks) {
      const next = new URL(`https://app.example/auth/callback?next=${raw}`).searchParams.get("next");
      expect(new URL(safeNextPath(next), "https://app.example").origin).toBe("https://app.example");
    }
  });
});

describe("isPublicPath", () => {
  it("allows login, auth, health and cron only", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/auth/callback")).toBe(true);
    expect(isPublicPath("/api/health")).toBe(true);
    expect(isPublicPath("/api/cron/keepalive")).toBe(true);
    expect(isPublicPath("/api/cronx")).toBe(false);
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/loginx")).toBe(false);
  });
});

describe("isValidEmail", () => {
  it("validates basic shape", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });
});

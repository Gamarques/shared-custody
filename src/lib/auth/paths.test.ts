import { describe, expect, it } from "vitest";
import { isPublicPath, isValidEmail, safeNextPath } from "./paths";

describe("safeNextPath", () => {
  it("keeps same-origin paths", () => {
    expect(safeNextPath("/calendario?m=3")).toBe("/calendario?m=3");
  });
  it.each([null, undefined, "", "https://evil.com", "//evil.com", "/\\evil.com", "evil"])(
    "falls back to / for %s",
    (v) => expect(safeNextPath(v)).toBe("/"),
  );
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

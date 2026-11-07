import { describe, expect, it } from "vitest";
import { inviteErrorMessage, inviteMailto, inviteTokenFromPath, inviteUrl, isValidInviteToken } from "./invites";

const token = "a".repeat(64);

describe("invite helpers", () => {
  it("accepts only 64-char lowercase hex tokens", () => {
    expect(isValidInviteToken(token)).toBe(true);
    expect(isValidInviteToken("A".repeat(64))).toBe(false);
    expect(isValidInviteToken("a".repeat(63))).toBe(false);
    expect(isValidInviteToken("../login")).toBe(false);
  });

  it("finds the token only in an exact invite page path", () => {
    expect(inviteTokenFromPath(`/convite/${token}`)).toBe(token);
    for (const path of ["/", "/convite", `/convite/${token}/x`, `/convite/${token}?a=1`, `/x/convite/${token}`, "/convite/not-a-token", `/convite/${"A".repeat(64)}`]) {
      expect(inviteTokenFromPath(path), path).toBeNull();
    }
  });

  it("maps the claim_invite codes", () => {
    expect(inviteErrorMessage("IV009")).toBe("Indica um e-mail válido.");
    expect(inviteErrorMessage("IV010")).toMatch(/Demasiadas tentativas/);
  });

  it("builds the invite URL without double slashes", () => {
    expect(inviteUrl("https://app.example/", token)).toBe(`https://app.example/convite/${token}`);
  });

  it("builds a mailto link with the encoded URL", () => {
    const url = inviteUrl("https://app.example", token);
    const href = inviteMailto(" bruno@example.com ", url, "Família Silva");
    expect(href.startsWith("mailto:bruno%40example.com?subject=")).toBe(true);
    const body = new URLSearchParams(href.split("?")[1]).get("body");
    expect(body).toContain(url);
    expect(body).toContain("Família Silva");
  });

  it("maps database error codes to messages", () => {
    expect(inviteErrorMessage("IV005")).toMatch(/dois responsáveis/);
    expect(inviteErrorMessage("23514")).toBe(inviteErrorMessage("IV005"));
    expect(inviteErrorMessage("IV003")).toMatch(/expirou/);
    expect(inviteErrorMessage(undefined)).toMatch(/Tenta novamente/);
    expect(inviteErrorMessage("XX000")).toMatch(/Tenta novamente/);
  });
});

import { describe, expect, it } from "vitest";
import { breadcrumbFor, isAuthPath, isCardPath } from "./nav";

describe("app chrome by path", () => {
  it("only the login renders without the navigation", () => {
    expect(isAuthPath("/login")).toBe(true);
    for (const p of ["/onboarding", "/convite/abc", "/", "/convidar", "/despesas"]) expect(isAuthPath(p)).toBe(false);
  });

  it("onboarding and invite pages are shown as a card inside the navigation", () => {
    expect(isCardPath("/onboarding")).toBe(true);
    expect(isCardPath("/convite/abc")).toBe(true);
    expect(isCardPath("/convidar")).toBe(false);
    expect(isCardPath("/")).toBe(false);
  });

  it("names the onboarding and invite pages in the header", () => {
    expect(breadcrumbFor("/onboarding")).toEqual([{ label: "Criar família" }]);
    expect(breadcrumbFor("/convite/abc")).toEqual([{ label: "Convite" }]);
  });
});

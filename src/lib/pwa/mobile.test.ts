import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { metadata, viewport } from "@/app/layout";

// next/font is compiled by Next's build; outside it the font loader is only a stub.
vi.mock("next/font/google", () => ({ Geist: () => ({ className: "", variable: "", style: {} }) }));

// T-24: static checks for problems that only show on phones and that a desktop browser hides.
const css = readFileSync("src/app/globals.css", "utf8");

describe("mobile browsers (Android Chrome, iOS Safari)", () => {
  it("form fields use at least 16px text, so iOS Safari does not zoom in on focus", () => {
    const rule = css.match(/input,\s*select,\s*textarea,\s*button\s*\{([^}]*)\}/);
    expect(rule?.[1]).toMatch(/font-size:\s*max\(16px,\s*1rem\)/);
  });

  it("keeps the text size on rotation in iOS Safari", () => {
    expect(css).toMatch(/-webkit-text-size-adjust:\s*100%/);
  });

  it("declares the viewport and the home screen app for iOS", () => {
    expect(viewport).toMatchObject({ width: "device-width", initialScale: 1 });
    // No maximumScale/userScalable: pinch zoom must stay available (accessibility).
    expect(viewport).not.toHaveProperty("maximumScale");
    expect(viewport).not.toHaveProperty("userScalable");
    expect(metadata.appleWebApp).toMatchObject({ capable: true });
    expect(metadata.icons).toMatchObject({ apple: "/icons/apple-touch-icon.png" });
  });

  it("uses no CSS that iOS Safari lacks for layout-critical rules", () => {
    // 100vh on iOS includes the area under the address bar; the layout uses dvh.
    expect(css).not.toMatch(/\b100vh\b/);
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/despesas",
  useSearchParams: () => new URLSearchParams("ok=despesa-atualizada"),
}));

import { FeedbackRegion, FeedbackToast } from "./Feedback";

describe("FeedbackToast", () => {
  it("success: green check, the text and a labelled close button", () => {
    const html = renderToStaticMarkup(<FeedbackToast feedback={{ id: 1, tone: "success", text: "Despesa enviada." }} onClose={() => {}} />);
    expect(html).toContain('data-tone="success"');
    expect(html).toContain('<path d="m5 12.5 4.5 4.5L19 7.5"'); // the "check" icon
    expect(html).toContain(">Despesa enviada.</p>");
    expect(html).toMatch(/<button type="button" class="toast-close" aria-label="Fechar aviso">/);
  });

  it("error: danger tone", () => {
    const html = renderToStaticMarkup(<FeedbackToast feedback={{ id: 2, tone: "error", text: "Falhou." }} onClose={() => {}} />);
    expect(html).toContain('data-tone="error"');
    expect(html).toContain(">Falhou.</p>");
  });
});

describe("FeedbackRegion", () => {
  it("server render: both live regions exist and are empty (nothing comes from the URL on the server)", () => {
    const html = renderToStaticMarkup(<FeedbackRegion shell="app" />);
    expect(html).toContain('class="toast-region" data-shell="app"');
    expect(html).toContain('<div class="toast-live" role="status" aria-live="polite"></div>');
    expect(html).toContain('<div class="toast-live" role="alert"></div>');
    expect(html).not.toContain("Despesa atualizada.");
  });

  it("is mounted by the shell", async () => {
    const { readFileSync } = await import("node:fs");
    const shell = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
    expect(shell).toContain('<FeedbackRegion shell="auth" />');
    expect(shell).toContain('<FeedbackRegion shell="app" />');
  });
});

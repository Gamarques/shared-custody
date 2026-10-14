import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const members = vi.fn();
const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser },
    from: () => ({ select: () => ({ eq: () => ({ limit: () => members() }) }) }),
    rpc,
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

import InvitePage from "./page";

const token = "b".repeat(64);
const invite = {
  family_name: "Família Silva",
  inviter_name: "Ana",
  invited_email: null,
  status: "valid",
  taken_colors: ["#2f6f5e"],
};

async function render(t = token) {
  return renderToStaticMarkup(await InvitePage({ params: Promise.resolve({ token: t }) }));
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcd1234.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  getUser.mockResolvedValue({ data: { user: { id: "u2", email: "bruno@example.com" } } });
  members.mockResolvedValue({ data: [] });
  rpc.mockResolvedValue({ data: [invite], error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("/convite/[token]", () => {
  it("shows the family and the accept form, hiding the inviter's color", async () => {
    const html = await render();
    expect(rpc).toHaveBeenCalledWith("get_invite", { invite_token: token });
    expect(html).toContain("Ana convidou você para a família <strong>Família Silva</strong>");
    expect(html).toContain("Entrar na família");
    expect(html).not.toContain('value="#2f6f5e"');
    expect(html).toContain('value="#c2410c"');
  });

  it("rejects malformed tokens without querying", async () => {
    const html = await render("not-a-token");
    expect(html).toContain("Convite não encontrado");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reports unknown tokens", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect(await render()).toContain("Convite não encontrado");
  });

  it.each([
    ["full", "já tem os dois responsáveis"],
    ["accepted", "já foi usado"],
    ["expired", "expirou"],
  ])("blocks %s invites", async (status, text) => {
    rpc.mockResolvedValue({ data: [{ ...invite, status }], error: null });
    const html = await render();
    expect(html).toContain(text);
    expect(html).not.toContain("Entrar na família");
  });

  it("tells users who already have a family", async () => {
    members.mockResolvedValue({ data: [{ id: "m1" }] });
    const html = await render();
    expect(html).toContain("Você já faz parte de uma família");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("warns when signed in with another e-mail than the invited one", async () => {
    rpc.mockResolvedValue({ data: [{ ...invite, invited_email: "outra@example.com" }], error: null });
    expect(await render()).toContain("Este convite foi enviado para outra@example.com");
  });
});

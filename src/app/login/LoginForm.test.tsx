import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FROM_INVITE_NOTE,
  INVALID_EMAIL_ERROR,
  INVITE_SIGNUP_REJECTED_ERROR,
  LINK_SEND_ERROR,
  LoginForm,
  magicLinkErrorMessage,
  NO_ACCOUNT_ERROR,
  PASSWORD_LOGIN_ERROR,
  RATE_LIMIT_ERROR,
  sendMagicLink,
  signInWithPassword,
  type MagicLinkClient,
} from "./LoginForm";
import LoginPage from "./page";

// No DOM in these tests: each mode is rendered as the server would, and the sign-in steps are
// plain functions, called with a fake client.

const token = "c".repeat(64);
const invitePath = `/convite/${token}`;
const origin = "https://app.example";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcd1234.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
});
afterEach(() => vi.unstubAllEnvs());

async function renderPage(params: { next?: string; modo?: string }) {
  return renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve(params) }));
}

describe("login page", () => {
  it("shows only the magic link: no password field and no visible way to the password form", async () => {
    for (const html of [renderToStaticMarkup(<LoginForm next="/" />), await renderPage({}), await renderPage({ next: "/admin" })]) {
      expect(html).toContain("Enviar ligação de acesso");
      expect(html).not.toContain('type="password"');
      expect(html).not.toMatch(/palavra-passe/i);
      expect(html).not.toContain("modo=");
    }
  });

  it("/login?modo=palavra-passe still shows the password form, with the right autocomplete", async () => {
    const html = await renderPage({ next: "/admin", modo: "palavra-passe" });
    const passwordInput = html.match(/<input[^>]*type="password"[^>]*>/)?.[0] ?? "";
    expect(passwordInput).toMatch(/autocomplete="current-password"/i);
    expect(html).toContain(">Palavra-passe</label>");
    expect(html).toMatch(/<input[^>]*type="email"[^>]*autocomplete="username"/i);
    expect(html).not.toContain("Enviar ligação de acesso");
    // No toggle back either, and there is no password sign-up anywhere.
    expect(html).not.toContain("Receber ligação por e-mail");
    expect(html).not.toMatch(/criar conta|registar|new-password/i);
  });

  it("the submit button starts disabled in both modes (nothing typed yet)", () => {
    for (const mode of ["link", "password"] as const) {
      const html = renderToStaticMarkup(<LoginForm next="/" mode={mode} />);
      expect(html.match(/<button type="submit"[^>]*>/)?.[0]).toContain('disabled=""');
    }
  });

  it("says the login comes from an invite only when next is a valid invite page", async () => {
    expect(await renderPage({ next: invitePath })).toContain(FROM_INVITE_NOTE);
    for (const next of [undefined, "/", "/convidar", "/convite/not-a-token", `${invitePath}/x`, `//evil.example${invitePath}`]) {
      expect(await renderPage({ next }), String(next)).not.toContain(FROM_INVITE_NOTE);
    }
    expect(await renderPage({ next: invitePath, modo: "palavra-passe" })).not.toContain(FROM_INVITE_NOTE);
  });
});

describe("sendMagicLink", () => {
  function client(opts: { claimError?: { code?: string } | null; otpError?: unknown; throws?: boolean } = {}) {
    const calls: string[] = [];
    const c = {
      calls,
      claimInvite: vi.fn(async () => {
        calls.push("claim_invite");
        return { error: opts.claimError ?? null };
      }),
      signInWithOtp: vi.fn(async () => {
        calls.push("signInWithOtp");
        if (opts.throws) throw new Error("fetch failed");
        return { error: (opts.otpError ?? null) as never };
      }),
    } satisfies MagicLinkClient & { calls: string[] };
    return c;
  }

  it("normal login never creates an account (shouldCreateUser false) and does not claim", async () => {
    const c = client();
    expect(await sendMagicLink(c, "  ana@example.com ", "/despesas", origin)).toEqual({ ok: true });
    expect(c.claimInvite).not.toHaveBeenCalled();
    expect(c.signInWithOtp).toHaveBeenCalledWith({
      email: "ana@example.com",
      options: { shouldCreateUser: false, emailRedirectTo: `${origin}/auth/callback?next=%2Fdespesas` },
    });
  });

  it("an unsafe next falls back to / and is not treated as an invite", async () => {
    const c = client();
    await sendMagicLink(c, "ana@example.com", `//evil.example${invitePath}`, origin);
    expect(c.claimInvite).not.toHaveBeenCalled();
    expect(c.signInWithOtp).toHaveBeenCalledWith({
      email: "ana@example.com",
      options: { shouldCreateUser: false, emailRedirectTo: `${origin}/auth/callback?next=%2F` },
    });
  });

  it("invite login claims the invite first, then asks for a link that may create the account", async () => {
    const c = client();
    expect(await sendMagicLink(c, " Bruno@Example.com ", invitePath, origin)).toEqual({ ok: true });
    expect(c.calls).toEqual(["claim_invite", "signInWithOtp"]);
    expect(c.claimInvite).toHaveBeenCalledWith(token, "Bruno@Example.com");
    expect(c.signInWithOtp).toHaveBeenCalledWith({
      email: "Bruno@Example.com",
      options: { shouldCreateUser: true, emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(invitePath)}` },
    });
  });

  it.each([
    ["IV001", /Convite não encontrado/],
    ["IV002", /já foi usado/],
    ["IV003", /expirou/],
    ["IV004", /enviado para outro e-mail/],
    ["IV005", /dois responsáveis/],
    ["IV009", /e-mail válido/],
    ["IV010", /Demasiadas tentativas/],
    [undefined, /Algo correu mal/],
  ])("a failed claim (%s) shows its message and asks for no link", async (code, text) => {
    const c = client({ claimError: { code } });
    const result = await sendMagicLink(c, "bruno@example.com", invitePath, origin);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(text);
    expect(c.signInWithOtp).not.toHaveBeenCalled();
  });

  it("an invalid e-mail calls nothing", async () => {
    const c = client();
    expect(await sendMagicLink(c, "bruno", invitePath, origin)).toEqual({ ok: false, error: INVALID_EMAIL_ERROR });
    expect(c.calls).toEqual([]);
  });

  it("maps Supabase's answer for an unknown e-mail on a normal login", async () => {
    const c = client({ otpError: { code: "otp_disabled", status: 422, message: "Signups not allowed for otp" } });
    expect(await sendMagicLink(c, "nova@example.com", "/", origin)).toEqual({ ok: false, error: NO_ACCOUNT_ERROR });
  });

  it("a network failure gives the generic message", async () => {
    expect(await sendMagicLink(client({ throws: true }), "ana@example.com", "/", origin)).toEqual({ ok: false, error: LINK_SEND_ERROR });
  });
});

describe("magicLinkErrorMessage", () => {
  it.each(["otp_disabled", "signup_disabled", "user_not_found"])("%s: no account (normal) / sign-up refused (invite)", (code) => {
    expect(magicLinkErrorMessage({ code, status: 422, message: "whatever English text" }, false)).toBe(NO_ACCOUNT_ERROR);
    expect(magicLinkErrorMessage({ code, status: 422 }, true)).toBe(INVITE_SIGNUP_REJECTED_ERROR);
  });

  it("the Before User Created hook rejection (403 / signup_requires_invite) is a refused sign-up", () => {
    expect(magicLinkErrorMessage({ status: 403, message: "signup_requires_invite" }, true)).toBe(INVITE_SIGNUP_REJECTED_ERROR);
    expect(magicLinkErrorMessage({ status: 403 }, false)).toBe(NO_ACCOUNT_ERROR);
    expect(magicLinkErrorMessage({ code: "unexpected_failure", status: 500, message: "signup_requires_invite" }, true)).toBe(INVITE_SIGNUP_REJECTED_ERROR);
  });

  it.each(["over_email_send_rate_limit", "over_request_rate_limit"])("%s: rate limit", (code) => {
    expect(magicLinkErrorMessage({ code, status: 429 }, false)).toBe(RATE_LIMIT_ERROR);
  });

  it("a 429 without a known code is a rate limit too", () => {
    expect(magicLinkErrorMessage({ status: 429 }, false)).toBe(RATE_LIMIT_ERROR);
  });

  it.each(["email_address_invalid", "validation_failed"])("%s: invalid e-mail", (code) => {
    expect(magicLinkErrorMessage({ code, status: 400 }, false)).toBe(INVALID_EMAIL_ERROR);
  });

  it("anything else is the generic message, never Supabase's text", () => {
    expect(magicLinkErrorMessage({ code: "unexpected_failure", status: 500, message: "Database error saving new user" }, false)).toBe(LINK_SEND_ERROR);
    expect(magicLinkErrorMessage(null, false)).toBe(LINK_SEND_ERROR);
    expect(NO_ACCOUNT_ERROR).toBe(
      "Não encontrámos nenhuma conta com este e-mail. Para entrar pela primeira vez, abre a ligação de convite que recebeste.",
    );
  });
});

describe("signInWithPassword", () => {
  function auth(result: { error: unknown } | Error) {
    return {
      signInWithPassword: vi.fn(async () => {
        if (result instanceof Error) throw result;
        return result;
      }),
    };
  }

  it("signs in with the trimmed e-mail and goes to the safe next path", async () => {
    const a = auth({ error: null });
    expect(await signInWithPassword(a, "  root@example.com ", "s3gredo", "/admin")).toEqual({ ok: true, redirectTo: "/admin" });
    expect(a.signInWithPassword).toHaveBeenCalledWith({ email: "root@example.com", password: "s3gredo" });
    expect(await signInWithPassword(a, "root@example.com", "s3gredo", "//evil.example")).toEqual({ ok: true, redirectTo: "/" });
  });

  it("never says which field was wrong", async () => {
    const wrongPassword = auth({ error: { code: "invalid_credentials", message: "Invalid login credentials" } });
    const unconfirmed = auth({ error: { code: "email_not_confirmed", message: "Email not confirmed" } });
    const network = auth(new Error("fetch failed"));
    for (const a of [wrongPassword, unconfirmed, network]) {
      expect(await signInWithPassword(a, "root@example.com", "x", "/")).toEqual({ ok: false, error: PASSWORD_LOGIN_ERROR });
    }
    expect(PASSWORD_LOGIN_ERROR).toBe("E-mail ou palavra-passe incorretos.");
  });

  it("does not call Supabase with an invalid e-mail or an empty password", async () => {
    const a = auth({ error: null });
    expect(await signInWithPassword(a, "not-an-email", "x", "/")).toEqual({ ok: false, error: PASSWORD_LOGIN_ERROR });
    expect(await signInWithPassword(a, "root@example.com", "", "/")).toEqual({ ok: false, error: PASSWORD_LOGIN_ERROR });
    expect(a.signInWithPassword).not.toHaveBeenCalled();
  });
});

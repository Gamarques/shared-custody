import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm, PASSWORD_LOGIN_ERROR, signInWithPassword } from "./LoginForm";
import LoginPage from "./page";

// No DOM in these tests: each mode is rendered as the server would, and the sign-in step is a
// plain function, called with a fake supabase.auth.

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcd1234.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
});
afterEach(() => vi.unstubAllEnvs());

describe("login form modes", () => {
  it("defaults to the magic link and offers the password toggle", () => {
    const html = renderToStaticMarkup(<LoginForm next="/" />);
    expect(html).toContain("Enviar ligação de acesso");
    expect(html).toContain("Entrar com palavra-passe");
    expect(html).not.toContain('type="password"');
  });

  it("password mode shows e-mail and palavra-passe with the right autocomplete, and a way back", () => {
    const html = renderToStaticMarkup(<LoginForm next="/admin" initialMode="password" />);
    const passwordInput = html.match(/<input[^>]*type="password"[^>]*>/)?.[0] ?? "";
    expect(passwordInput).toMatch(/autocomplete="current-password"/i);
    expect(html).toContain(">Palavra-passe</label>");
    expect(html).toMatch(/<input[^>]*type="email"[^>]*autocomplete="username"/i);
    expect(html).toContain("Receber ligação por e-mail");
    expect(html).not.toContain("Enviar ligação de acesso");
    // There is no password sign-up anywhere.
    expect(html).not.toMatch(/criar conta|registar|new-password/i);
  });

  it("/login?modo=palavra-passe opens the password mode directly", async () => {
    const html = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({ next: "/admin", modo: "palavra-passe" }) }));
    expect(html).toMatch(/autocomplete="current-password"/i);
    const plain = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({}) }));
    expect(plain).not.toMatch(/autocomplete="current-password"/i);
    expect(plain).toContain("Entrar com palavra-passe");
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

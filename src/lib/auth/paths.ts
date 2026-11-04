/** Routes reachable without a session. */
const PUBLIC_PREFIXES = ["/login", "/auth", "/api/health", "/api/cron"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

// Any origin works here: it is only used to check that `next` stays on the origin it resolves against.
const PROBE_ORIGIN = "https://same-origin.invalid";

/**
 * Only same-origin relative paths are allowed as post-login destinations (no open redirect).
 *
 * Rejected: absolute URLs, protocol-relative `//host`, backslashes (`/\host`, which browsers read
 * as `//host`), and ASCII control characters and spaces. The URL parser strips tab and newline
 * anywhere, so `/<TAB>/evil.com` (sent as `/%09/evil.com`) would otherwise become `//evil.com`.
 * As a last check the path must resolve to the same origin.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || next.length > 2048) return "/";
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  // eslint-disable-next-line no-control-regex
  if (/[\u0000- \u007f]/.test(next)) return "/";
  try {
    if (new URL(next, PROBE_ORIGIN).origin !== PROBE_ORIGIN) return "/";
  } catch {
    return "/";
  }
  return next;
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

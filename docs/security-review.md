# Security review — 2026-11-04

Scope: the repository at branch `security-review` (Next.js 16.4.5 App Router + Supabase, schema
`shared_custody`, deployed at <https://shared-custody.vercel.app>). Nothing was deployed and the remote
Supabase project was not touched. Findings are tracked in `docs/TODO-BUGS.md` (TODO-018 to TODO-025);
owner steps are in `docs/MANUAL-STEPS.md`, section "Security review".

## Checklist

| # | Item | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Secrets in git history and working tree | OK | `git log -p --all` (44 commits) has no Supabase secret/publishable key, JWT, `service_role` key, `CRON_SECRET` value, database URL or private key. The only env file ever committed is `.env.example` (placeholders). `.env`, `.env.local`, `.env.production` and `.vercel/` are ignored (`git check-ignore`). The local `.env.local` holds the public Supabase URL and anon key plus a `VERCEL_OIDC_TOKEN` written by the Vercel CLI: never committed, not `NEXT_PUBLIC_`. Server-only variables (`CRON_SECRET`, `DEMO_MODE`, `VERCEL_ENV`) are read only in server code; the only `NEXT_PUBLIC_` variables are the Supabase URL, the anon key and `NEXT_PUBLIC_DEMO_MODE` (a flag). No service role key is used anywhere. |
| 2 | Build output | OK | `npm run build` passes. `.next/static` (38 files): 0 source maps; the values of `NEXT_PUBLIC_SUPABASE_URL` and the anon key appear (expected, public); `VERCEL_OIDC_TOKEN` value: 0 hits; no JWT; `sb_secret_` appears only as a prefix check inside supabase-js, never with a key. `productionBrowserSourceMaps: false` is now explicit. |
| 3 | Routes, route handlers, server actions | FIXED | Open redirect through control characters in `next` (TODO-018), demo mode had no production guard (TODO-021), cron leaked upstream error bodies to an authorized caller (TODO-022). Table below. |
| 4 | Proxy matcher | FIXED (+1 OPEN, low) | The extension exclusion skipped page paths like `/convite/x.png` (TODO-019). Pages that rely only on the proxy + RLS for anonymous users: TODO-024 (no data leaks, RLS returns nothing to `anon`). |
| 5 | Security headers | FIXED (+1 OPEN, low) | CSP, HSTS, nosniff, Referrer-Policy, X-Frame-Options DENY + `frame-ancestors 'none'`, Permissions-Policy, no `X-Powered-By` (TODO-020). `script-src` keeps `'unsafe-inline'` (no nonce): TODO-023. |
| 6 | Database (migrations) | OK (+1 OPEN, low) | RLS on every table, policies scoped by `is_family_member(family_id)`, security definer functions pinned to `search_path = shared_custody` and checking the caller, anon has no table privilege, private receipts bucket with family-scoped policies, admin functions raise 42501 for non-admins. New guard test `src/test/security-grants.sql.test.ts`. Timestamps rewritable by members inside their own family: TODO-025. No migration was needed for a security fix. |
| 7 | Supabase Auth settings | OPEN (owner) | Not visible from the repository; list in `docs/MANUAL-STEPS.md` "Security review". |
| 8 | Dependencies | OK | `npm audit --omit=dev`: 0 vulnerabilities; `npm audit`: 0 vulnerabilities. |

## Routes

Proxy (`src/proxy.ts`) runs on every path except `_next/static/`, `_next/image`, `public/icons/`,
`favicon.ico`, `manifest.webmanifest`, `sw.js` and `offline.html`. It refreshes the session and sends
anonymous callers to `/login?next=...`, except on `/login`, `/auth/*`, `/api/health`, `/api/cron/*`.
Signed-in users without a family go to `/onboarding` (except `/`, `/auth`, `/api`, `/convite/*`, `/admin`).
All data access goes through the caller's own Supabase session (anon key + user JWT), so RLS applies
to every query; the app has no service role key.

| Route | Who can call | Check in the route itself | Returns |
| --- | --- | --- | --- |
| `/` | signed in | `getSessionUser`, redirects to `/login` / `/onboarding` | family home (RLS) |
| `/calendario`, `/guarda`, `/excecoes`, `/despesas`, `/despesas/nova`, `/despesas/[id]/editar`, `/despesas/[id]/historico`, `/saldo`, `/convidar` | signed in, member | proxy only (TODO-024); queries under RLS | the caller's family data; empty state otherwise |
| `/onboarding` | signed in without family | proxy; `create_family` RPC checks `auth.uid()` | form |
| `/convite/[token]` | anyone; accepting needs a session | token format, `getUser`, `get_invite` keyed by the 244-bit token | invite summary or message |
| `/admin` | platform admins | `getSessionUser` + `is_app_admin()`; others get 404 | every family and user (admin RPCs refuse non-admins with 42501) |
| `/login` | anyone | `next` passed through `safeNextPath` | form |
| `/manifest.webmanifest` | anyone | — | static manifest |
| `GET /auth/callback` | anyone | `exchangeCodeForSession(code)`; `next` through `safeNextPath` | redirect to a same-origin path or `/login?error=1` |
| `POST /auth/signout` | anyone (POST only; session cookies are SameSite=Lax) | — | 303 to `/login` |
| `GET /api/health` | anyone | — | `{ ok, supabaseConfigured }` (+ `demo: true` in demo mode): booleans only |
| `GET /api/cron/keepalive` | Vercel Cron | `Authorization: Bearer <CRON_SECRET>`, `timingSafeEqual`; no secret configured means nobody | `{ ok, dbTime, ms }`; `{ ok:false }` on failure (details only in logs); 401 `{ ok:false, error:"unauthorized" }` |
| `POST /api/demo`, `GET /api/demo/receipt` | demo mode only | 404 unless `DEMO_MODE`, and always 404 when `VERCEL_ENV=production` | fake in-memory data |
| `GET /despesas/exportar` | signed in member | `getUser` (401), membership (404), RLS | CSV of the caller's family, `Cache-Control: no-store` |
| Server action `removeMemberAction(familyId, userId)` | admins | UUID format, `isAppAdmin()`, then `admin_remove_member` re-checks `is_app_admin()` in SQL | `{ ok }` / message |
| Server action `deleteFamilyAction(familyId)` | admins | same; storage cleanup with the admin's own session (admin storage policies) | `{ ok }` / redirect with warning |

Browser-side writes (expenses, overrides, rules, settlements, invites, onboarding, receipts) call
Supabase directly with the user's session; RLS, column guards and triggers are the gate (covered by
the `*.sql.test.ts` suites on PGlite).

## Headers sent on every response

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob: https://<ref>.supabase.co; font-src 'self' data:;
  connect-src 'self' https://<ref>.supabase.co wss://<ref>.supabase.co; worker-src 'self'; manifest-src 'self';
  frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
Strict-Transport-Security: max-age=63072000; includeSubDomains
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
X-Frame-Options: DENY
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()
```

`<ref>` comes from `NEXT_PUBLIC_SUPABASE_URL` at build time. In `next dev` the CSP also allows
`'unsafe-eval'` and `ws:` (React dev tools and HMR). The receipt picker is a plain file input without
`capture`, so the camera permission is off for the page; phones still offer the camera app in the picker.

How it was checked: `curl -I` on a production build; a production build with demo data opened in
headless Chrome on 14 screens with a `securitypolicyviolation` listener and the console/log streams:
0 violations, 0 errors, service worker activated, a receipt photo set on `/despesas/nova` without
violations; `npm run qa:visual`: 42 checks, 0 failing.

## Database notes

- `get_invite` is the only callable security definer function that does not check `auth.uid()` or
  membership: it is keyed by the secret invite token and returns only what the invite page shows.
- `is_family_member` is executable by `anon` and returns false without a session.
- `expenses_guard_decision` trusts the transaction setting `app.expense_decision`, set only inside
  `decide_expense`. PostgREST exposes no way to call `set_config`, but any function added later to an
  exposed schema (`public`, `graphql_public`, `shared_custody`) that sets arbitrary settings from user
  input would reopen the decision columns. The other app in `public` was not reviewed.
- The app relies on the Supabase default that `anon`/`authenticated` reach only exposed schemas;
  `shared_custody` revokes all table privileges from `anon`.

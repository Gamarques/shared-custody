# QA end-to-end on Android and iOS (T-24)

Requirements: RNF-05 (installable PWA on Android and iOS, calendar readable offline) and RNF-07
(home loads in under 2 s on 4G, with the day's data from a single query).
Acceptance criterion: "Fluxo completo sem erro nos dois sistemas; home abaixo de 2 s em 4G".

This file has two parts:

1. **What was checked locally** (repository, test database, desktop Chrome with mobile and 4G
   emulation), with the numbers measured on 2026-10-15. These results are real but are **not**
   the acceptance criterion: no phone, no live Supabase project and no deploy were involved.
2. **The device test script** to run on one Android phone and one iPhone against the deployed
   app. Its result table is empty: it has **not been executed** yet (see `MANUAL-STEPS.md`, T-24).

## 1. Checked locally

### 1.1 Complete flow on the database (`src/test/e2e-flow.sql.test.ts`)

One test file walks the whole MVP journey, in order, on an in-memory Postgres (PGlite) with every
migration in `supabase/migrations` applied, each step as the signed-in user who would do it, through
the same form helpers and SQL functions the screens call:

| Step | What is checked | Req. |
| --- | --- | --- |
| 1 | Ana creates the family; the home has no rule yet | RF-02, RF-03 |
| 2 | Ana invites Bruno by e-mail; Bruno joins with another color; a third user cannot reuse the link (`IV002`); no new invite once the family has 2 members (`IV005`) | RF-02 |
| 3 | Child name and custody rule (Sunday 18:00, Europe/Lisbon); the home shows the right holder and next handover | RF-03, RF-04, RF-05 |
| 4 | An exception ("Férias") overrides the rule on the home for both members; an outsider cannot add one | RF-05, RF-07 |
| 5 | Four expenses with different shares, typed as in the form ("45,50", "30") and stored as integer cents / basis points | RF-08, RF-09, RNF-02 |
| 6 | Only the other member confirms or disputes; a dispute needs a comment | RF-11 |
| 7 | Editing a confirmed expense sends it back to `pending`; deletion is logical; hard delete changes no row | RF-17 |
| 8 | Audit rows for each change, read and rendered like the history screen; audit rows cannot be changed or deleted | RF-12, RNF-03 |
| 9 | Balance for both members: "Ana deve 6,00 € a Bruno" (plan example), disputed line 22,75 € apart | RF-13 |
| 10 | A 6,00 € settlement brings the balance to zero; settlements cannot be updated | RF-14 |
| 11 | The month's CSV has a BOM, accents, the live expenses only | RF-15 |
| 12 | A user of another family saw 0 rows of the family across all 9 tables during the whole journey and could change nothing; `anon` cannot read | RNF-01 |

Result: 12/12 pass (`npx vitest run src/test/e2e-flow.sql.test.ts`). The full suite (58 files, 591
tests) passes. Not covered: the real Supabase stack (PostgREST, GoTrue, Storage, real JWTs), the
browser screens themselves, receipts photos and the service worker on a device.

### 1.2 Home performance (RNF-07), lab measurement

`node tools/perf-home.mjs` builds the app in production mode, serves it with `next start`, and loads
the home in headless Chrome with phone emulation (412×915, Android user agent, touch, 4× CPU
slowdown) and throttled network, signed in as a family member. Supabase is replaced by a local
stand-in (Auth public keys + PostgREST) that answers each request after a fixed delay, which stands
for the network distance between Vercel and Supabase. It also counts the requests the server makes
to Supabase while rendering the page. Median of 7 cold runs (empty cache) and 7 repeat runs
(HTTP cache warm, service worker bypassed so that the HTML is throttled too):

| Network profile | Supabase delay | Visit | HTML received | LCP | Load event | Transferred |
| --- | --- | --- | --- | --- | --- | --- |
| 4G (60 ms, 9 Mbit/s) | 20 ms | first | 78 ms | 420 ms | 664 ms | 153 KB |
| 4G (60 ms, 9 Mbit/s) | 20 ms | repeat | 81 ms | 152 ms | 200 ms | 15 KB |
| 4G (60 ms, 9 Mbit/s) | 100 ms | first | 156 ms | 484 ms | 722 ms | 153 KB |
| 4G (60 ms, 9 Mbit/s) | 100 ms | repeat | 158 ms | 208 ms | 259 ms | 13 KB |
| DevTools "Slow 4G" (562.5 ms, 1.4 Mbit/s) | 20 ms | first | 635 ms | 1 420 ms | **2 743 ms** | 150 KB |
| DevTools "Slow 4G" (562.5 ms, 1.4 Mbit/s) | 20 ms | repeat | 634 ms | 640 ms | 695 ms | 11 KB |

Every run rendered the holder ("Lia está com Ana") with no console errors, and the server made
**exactly one request to Supabase** per render (`GET /rest/v1/members` with the embedded select).

Reading the numbers:

- On the 4G profile the home is complete in about 0.7 s on a first visit and 0.2–0.3 s afterwards,
  under the 2 s budget with a wide margin. This is the profile the script's exit code checks.
- The DevTools "Slow 4G" preset is the former "Fast 3G" preset renamed; it is a stress case. There
  the content is visible (LCP) at 1.4 s, but the load event of a first visit comes at 2.7 s, over
  2 s: about 150 KB of JavaScript (React and the Next.js runtime, ~120 KB of it) at 1.4 Mbit/s.
  Repeat visits are at 0.7 s. If real phones show this, the next step is reducing client JS.
- The antivirus on the measuring machine (Kaspersky) injects a script into every page; the script
  blocks those requests and reports them, because they are not part of the app.

What changed in T-24 to get there (before/after measured with the same script, 4G profile,
100 ms Supabase delay, first visit):

| | Requests to Supabase per home render | HTML received | Load event |
| --- | --- | --- | --- |
| Before (commit 703b1d1) | 4 (`/auth/v1/user` ×2, `/rest/v1/members` ×2) | 488 ms | 1 063 ms |
| After | 1 (`/rest/v1/members`) | 156 ms | 722 ms |

- The proxy, the session bar and the home read the user with `getClaims()`
  (`src/lib/supabase/session-user.ts`), which verifies the token's signature locally with the
  project's cached public keys instead of asking Supabase Auth on every request. This needs the
  project to use **asymmetric JWT signing keys** (Supabase > Project Settings > JWT Keys; see
  `MANUAL-STEPS.md`, T-24). With the legacy shared secret it falls back to one Auth request per
  call, which is still correct but slower.
- The proxy no longer checks the membership for `/`: the home's own query already finds it, and
  the home redirects to `/onboarding` when there is no member row.

What the lab number does not include: DNS/TLS setup to the real Vercel domain, Vercel cold
starts (the first request after idle can take several hundred ms more), the real distance between
the Vercel region and the Supabase region, and real radio conditions. Keep the Vercel function
region next to the Supabase region (see `MANUAL-STEPS.md`, T-24).

### 1.3 Problems found by inspection and fixed

| Problem | Where | Systems | Fix |
| --- | --- | --- | --- |
| Form fields had the browser default text size (~13 px): iOS Safari zooms the page into every field on focus and does not zoom back | `src/app/globals.css` | iOS | Form controls use `max(16px, 1rem)`; `text-size-adjust: 100%` for rotation. Checked by `src/lib/pwa/mobile.test.ts` |
| "Ver comprovante" called `window.open` after waiting for the signed URL; Safari on iOS treats that as an unrequested pop-up and blocks it | `src/app/despesas/ReceiptLink.tsx`, `openReceipt` in `src/lib/receipts/receipts.ts` | iOS (and slow networks on Android) | The tab opens inside the tap and is pointed at the signed URL afterwards; falls back to the current tab. Checked by `receipts.test.ts` |
| Four requests to Supabase per home render | proxy, session bar, home | both | See 1.2 |

Checked and found fine: `type="date"` fields with `max` (iOS ignores `max` in its picker, but the
forms also refuse future dates in code); `inputMode="decimal"` on money fields; the apple touch
icon (180×180), `appleWebApp.capable` and the manifest (`display: standalone`, 192/512/maskable
icons); `100dvh` instead of `100vh`; pinch zoom not disabled.

## 2. Device test script (to run on real phones)

Devices: one Android phone with Chrome (Android 10 or later) and one iPhone with Safari (iOS 16.4
or later). Two real e-mail accounts (A and B) and a third one (C). App deployed on Vercel over
HTTPS against the live Supabase project, all migrations applied (`MANUAL-STEPS.md`, T-01 to T-23).

Run the full list on both systems: A on Android and B on iPhone, then swap roles for a second pass
if time allows. Record OK / FAIL with a short note and a screenshot for every FAIL.

| # | Step | Expected | Android | iOS |
| --- | --- | --- | --- | --- |
| 1 | Open the URL in the browser, not installed | `/login` opens; no horizontal scroll at 360 px width | | |
| 2 | Install: Chrome menu > "Instalar app" / Safari Share > "Adicionar à Tela de Início" | Icon on the home screen with the app's icon and the name "Guarda" | | |
| 3 | Open from the icon | Opens standalone (no address bar) | | |
| 4 | Sign in with a magic link: request it in the installed app, open the e-mail | Signed in. **iOS:** the link opens in Safari, not in the installed app (separate storage): sign in once inside the app by opening the link from the same context, or note the behavior | | |
| 5 | Close the app completely and reopen | Still signed in | | |
| 6 | A: onboarding (family name, display name, color) | Lands on the home | | |
| 7 | A: `/convidar`, generate a link for B's e-mail, share it (copy or `mailto:`) | Link copied / mail app opens | | |
| 8 | B: open the link, sign in, choose a name; A's color is not offered | B lands on the home; `/convidar` for A says the family is complete | | |
| 9 | C: open the same link | "Este convite já foi usado." | | |
| 10 | A: `/guarda`, set the rule (who starts, Sunday 18:00, first date) | Rule shown; home shows who has the child and the countdown | | |
| 11 | Focus every text, number and date field on `/guarda`, `/excecoes`, `/despesas/nova`, `/saldo` | **No page zoom on focus (iOS)**; the date picker opens; the decimal keypad shows for money fields | | |
| 12 | `/calendario`: current and next month | Weeks colored, handover marked "⇄ 18:00" on Sundays | | |
| 13 | B: `/excecoes`, add "Férias" covering today | Home shows the exception member and "Exceção: Férias" on both phones | | |
| 14 | A: `/despesas/nova`, take a photo with the camera as the receipt (on iPhone a HEIC photo), amount "45,50", 50% | Saved; in Supabase Storage the object is ≤ ~300 KB | | |
| 15 | B: `/despesas`, "Ver comprovante" | **The receipt opens in a new tab (no blocked pop-up on iOS)** | | |
| 16 | B: confirm one expense, dispute another with a comment | Status updated for both; empty comment refused | | |
| 17 | A: edit the confirmed expense | Back to "Pendente" | | |
| 18 | A: delete an expense | Gone from the list; history still shows it | | |
| 19 | `/despesas/<id>/historico` | All changes with names and times | | |
| 20 | `/saldo` | Who owes whom; "Em disputa" line separate | | |
| 21 | Register a settlement for the shown amount | "Ninguém deve nada neste período." | | |
| 22 | `/despesas` > "Exportar mês em CSV" | File downloads / share sheet opens; opens in a spreadsheet app with accents | | |
| 23 | Offline: open the calendar online, close the app, airplane mode, reopen, open "Calendário" | Month opens with "Sem conexão" notice and "Atualizado em" (T-12 steps) | | |
| 24 | "Sair", then airplane mode, open `/calendario` | Fallback page, not the old data | | |
| 25 | Rotate to landscape on the home and calendar | Layout readable, text not enlarged | | |
| 26 | Home speed on 4G (Wi-Fi off), see below | Under 2 s | | |

**Home speed on a real phone (step 26).** Turn Wi-Fi off and check that the phone shows 4G/LTE (not
5G; on Android, Settings > Network > Preferred network type > LTE; on iPhone, Settings > Mobile Data
> Voice & Data > LTE). Open the installed app from a closed state 5 times and note the time until the
holder and the countdown show (screen recording, then count frames, is the most reliable). For
the precise number:

- Android: connect the phone by USB, enable USB debugging, open `chrome://inspect` on a computer,
  inspect the page, Network tab with "Disable cache" off, reload; read "Load" and "DOMContentLoaded"
  at the bottom, and check there is no request from the browser to `supabase.co` for the home data
  (the page arrives with the data already rendered).
- iOS: on a Mac, Safari > Settings > Advanced > "Show features for web developers"; on the iPhone,
  Settings > Safari > Advanced > Web Inspector on; then Develop menu > the iPhone > the page;
  Network tab, reload, read the load time.
- Vercel > Project > Observability (or Logs) shows the server duration of `GET /`; it should be
  a few hundred ms at most when the region matches Supabase.

### Results

Not executed yet. Fill in when run:

| Date | Device / OS / browser | Tester | Steps OK | Steps FAIL (numbers) | Home on 4G (median of 5) |
| --- | --- | --- | --- | --- | --- |
| | Android | | | | |
| | iPhone | | | | |

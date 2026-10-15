# Manual steps

Steps that need real external accounts or devices and cannot be done from the repository.
Each entry says which task it belongs to and how to verify it.

## T-01 — Supabase project and Vercel deploy

Status: **not done yet**. Everything local is in place (Next.js app, Supabase clients,
`.env.example`, tests, `npm run build` passes and `next start` serves the home with HTTP 200).
No public URL exists until the steps below are performed.

### 1. Create the Supabase project

1. At <https://supabase.com/dashboard>, create a new project on the free plan.
2. Choose an EU region (for example `eu-west-*` / Frankfurt) because the data is about a child
   and money and falls under GDPR (see "Riscos" in `docs/plano-mvp.md`).
3. Store the database password in a password manager.
4. In **Project Settings > API**, copy:
   - the Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - the `anon` / publishable key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

   Do **not** copy the `service_role` key into any `NEXT_PUBLIC_` variable.

### 2. Run locally against the project

```bash
cp .env.example .env.local   # then paste the two values
npm install
npm run dev                  # http://localhost:3000/api/health should say "supabaseConfigured":true
```

`GET /api/health` returns `{"ok":true,"supabaseConfigured":true}` when the variables are valid.

### 3. Deploy on Vercel

1. Push the repository to GitHub (the default branch is expected to be `main`).
2. At <https://vercel.com/new>, import the repository. Framework preset: **Next.js**
   (auto-detected). No build settings need to change (`npm run build`, output `.next`).
3. In **Settings > Environment Variables**, add `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` for Production, Preview and Development.
4. Deploy. If the variables were added after the first deploy, **redeploy**: `NEXT_PUBLIC_*`
   values are inlined at build time (the home is rendered per request since T-09).

Alternative with the CLI: `npx vercel link`, `npx vercel env add NEXT_PUBLIC_SUPABASE_URL`,
`npx vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY`, then `npx vercel --prod`.

### 4. Verify the acceptance criterion ("URL pública abre a home")

```bash
curl -i https://<project>.vercel.app/            # HTTP 200, contains "Guarda Compartilhada"
curl -s https://<project>.vercel.app/api/health  # {"ok":true,"supabaseConfigured":true}
```

### 5. Prepare for later tasks

- In Supabase **Authentication > URL Configuration**, set the Site URL to the Vercel production
  URL and add `http://localhost:3000/**` and the preview URL pattern to the redirect allow list.
  Magic links (T-02) depend on this.
- Install the Supabase CLI (`npx supabase`), then `npx supabase link --project-ref <ref>` so the
  migrations in `supabase/migrations` (T-05 onward) can be pushed with `npx supabase db push`.

## T-02 — Magic link login

Status: **code done, not verified against a live Supabase project**. Unit tests mock the
Supabase client; no real e-mail was sent and no real session was created.

1. In Supabase **Authentication > Providers**, keep **Email** enabled (magic link / OTP).
2. In **Authentication > URL Configuration**, set the Site URL and add
   `http://localhost:3000/auth/callback` and `https://<project>.vercel.app/auth/callback`
   (or `/**` patterns) to the redirect allow list.
3. Optional: edit the "Magic Link" e-mail template; the default link works with the PKCE
   flow used by `@supabase/ssr` (`/auth/callback?code=...`).
4. Note: the free-plan built-in SMTP is rate limited (few e-mails per hour). Configure a
   custom SMTP provider before real use.
5. Verify (local or deployed):
   - open `/` → redirected to `/login`; enter an e-mail; receive the link;
   - open the link **in the same browser** (PKCE verifier is stored there) → lands on `/`
     with the e-mail and a "Sair" button shown;
   - close and reopen the browser/PWA → still signed in (cookie refreshed by `src/proxy.ts`);
   - click "Sair" → back at `/login`; `/` redirects to `/login` again.

RLS: T-02 adds no tables (Supabase manages `auth.users`), so no migration is needed here.
Table policies and isolation tests come with T-05.

## T-03 — Family onboarding

Status: **code done, not verified against a live Supabase project**. Unit tests mock the
Supabase client and check the migration statically; the SQL was never executed on Postgres.

1. Apply the migration: `npx supabase db push` (linked project) or `npx supabase db reset`
   (local stack). File: `supabase/migrations/20261014000100_families_members.sql`.
2. Verify with a brand-new e-mail:
   - sign in, get redirected to `/onboarding`; fill family name, display name and color, click
     "Criar família", land on `/`; `/onboarding` then redirects to `/`;
   - in the SQL editor: one row in `families` and one in `members` (`role = owner`);
   - as a second, unrelated user, `select * from families` / `members` returns no rows (RLS);
   - a third insert into `members` for the same family fails (max 2).
3. The child name (RF-03) is not stored yet: the `children` table arrives with the full schema in T-05.

## T-04 — Invite the other responsible adult by link

Status: **code done; SQL executed locally, not on a live Supabase project**. The migrations
(T-03 and T-04) now run in the test suite on an in-memory Postgres (PGlite, `src/test/pg.ts`)
with a small stub of what Supabase provides (`anon`/`authenticated` roles, `auth.users`,
`auth.uid()`, default grants). That covers the invite functions and RLS, but it is not the real
Supabase stack (PostgREST, GoTrue, real JWTs), so the steps below are still needed.

1. Apply the migration: `npx supabase db push`. File: `supabase/migrations/20261014000200_invites.sql`.
2. The app does **not** send the invite e-mail itself: `/convidar` shows the link to copy and,
   when an e-mail is given, a `mailto:` link that opens the member's own mail app. Sending from
   the server would need an SMTP/e-mail provider (e.g. Resend) and a server-side secret; not in
   the MVP.
3. Verify with two real e-mails (A and B) and a third one (C):
   - A signs in, creates the family, opens `/convidar`, generates a link (optionally with B's e-mail);
   - B opens the link in another browser, is sent to `/login`, signs in via magic link, comes back
     to `/convite/<token>`, picks a name and a color (A's color is not offered), clicks
     "Entrar na família" and lands on `/`;
   - in the SQL editor: two rows in `members` for the family (`owner`, `member`) and the invite
     has `accepted_at` set;
   - `/convidar` now says the family is complete; C opening the old link sees
     "Este convite já foi usado." and cannot join; `select create_invite()` as A fails with `IV005`.
4. Invites expire after 7 days; generating a new link revokes the previous pending one.

## T-05 — Schema, RLS and isolation tests

Status: **code done; SQL executed locally (PGlite), not on a live Supabase project**.
`src/test/rls-isolation.sql.test.ts` checks that a user of another family, a user without a
family and `anon` can neither read nor write any row of any table. The test database is a stub,
not the real Supabase stack (PostgREST, GoTrue, real JWTs, `postgres`/`supabase_admin` default
privileges), so these steps are still needed:

1. Apply the migration: `npx supabase db push`. File:
   `supabase/migrations/20261014000300_core_schema_rls.sql`.
2. In **Database > Tables**, check that RLS is on for all 9 tables (the dashboard also warns
   about tables without RLS in the Security Advisor; it should show none).
3. Verify through the API with two real users in different families (A, C): with C's session,
   `supabase.from('<table>').select('*')` returns only C's rows for every table, and an insert
   with A's `family_id` fails with `42501` / "new row violates row-level security policy".
4. Check that `anon` cannot read tables: with only the anon key (no session),
   `GET /rest/v1/families` returns `401`/`42501`, not `[]` with rows.
5. Not done here: the expense audit trigger (done in T-17), the Storage bucket policies for receipts
   (done in T-14), and saving the child's name in onboarding (the `children` table now exists).

## T-06 — PWA base (manifest, icons, service worker)

Status: **code done and tested locally; install on real devices not verified**.
Manifest (`/manifest.webmanifest`), icons (`public/icons`, regenerate with `node tools/gen-icons.mjs`),
`public/sw.js` and `public/offline.html` are in place. The service worker registers only in
production builds. Icons are placeholders (ring glyph); replace with final art when available.

1. Deploy (or `npm run build && npm start` and expose via HTTPS tunnel — install needs HTTPS).
2. Android/Chrome: open the URL, menu > "Instalar app"; icon appears on home screen, opens standalone.
3. iOS/Safari: Share > "Adicionar à Tela de Início"; check icon and standalone launch.
4. Chrome DevTools > Application: Manifest shows no errors, Service Worker is "activated",
   Lighthouse PWA/installable check passes.
5. Airplane mode: opening a previously visited page works; unseen page shows "Sem conexão".
   (Offline calendar data is T-12.)

## T-08 — Custody rule configuration (RF-04)

Status: **code done; SQL executed locally (PGlite), not on a live Supabase project**.
`/guarda` shows the current rule, a form (who starts, handover weekday and time, first handover
date and, for a change, "vale a partir de") and the history of all versions. Saving always
inserts a new row in `custody_rules`; members cannot update or delete rows (privileges revoked),
and a trigger blocks content changes even for roles that bypass RLS. `valid_from` defaults to
`starts_on` for the first version and to today in the family time zone for later ones;
`created_at` is always the server clock. Saving a new version does not write `valid_to` on the
previous one (that would change a preserved row); `getCustodyHolder` orders versions by save
order instead. Covered by `src/lib/custody/custody-rules.sql.test.ts` and `holder.test.ts`.

1. Apply the migration: `npx supabase db push`. File:
   `supabase/migrations/20261014000400_custody_rule_versions.sql`.
2. Verify with two members of one family (A, B):
   - A opens `/guarda`, sees "Nenhuma regra definida ainda.", saves Sunday 18:00 with a first
     handover date; the page shows it as "Regra atual" and one entry in the history;
   - B opens `/guarda`, changes to Friday 19:00 and clicks "Salvar nova versão"; the history now
     has two entries, the old one unchanged;
   - in the SQL editor: two rows in `custody_rules`, the first with its original values;
   - through the API with A's session, `supabase.from('custody_rules').update({...})` and
     `.delete()` fail with `42501` (permission denied), and the row count stays at 2.
3. Any member can change the rule and can choose a past "vale a partir de" to correct a
   mistake; old versions stay in the history. No approval by the other member (out of MVP scope).

## T-09 — Home: who has the child today and the next handover (RF-05)

Status: **code done and unit-tested; not verified against a live Supabase project or on a
device**. `/` shows "<child> está com <member>" in the member's color (text color picked for
contrast), the override reason when one is in force, the next handover ("Domingo, 18/10, às
18:00, com Bruno") and a countdown ("Faltam 4 dias e 8 horas") that updates every 30 s and
reloads the page once the handover passes. All times are in the family time zone (RNF-04).
The data comes from one PostgREST request (`members` with embedded `families`, `children`,
`members`, `custody_rules` and the `custody_overrides` that have not ended), per RNF-07.
No new tables or policies: the existing RLS (T-05, T-08) applies to every embedded table, and
`src/lib/custody/home-data.sql.test.ts` checks those reads under RLS on PGlite. The embedded
select itself was only tested against a mocked client, not a real PostgREST.

1. No migration to apply for this task.
2. Verify with a family of two members (A, B) and a saved rule (T-08):
   - open `/` as A: the child's name (or "A criança" if no child row exists yet), the current
     holder in their color, the next handover with the other member, and the countdown;
   - compare with the rule: on the handover day before the handover time the current holder
     is still the previous one; after it, the page shows the other member (wait or reload);
   - insert an override in the SQL editor covering now (`custody_overrides`, member B): `/`
     shows B and "Exceção: <reason>", and the next handover is the end of the override;
   - with the network throttled to "Fast 4G" in DevTools, `/` loads in under 2 s and the
     Network tab shows a single `rest/v1/members?select=...` request for the home data (RNF-07,
     final check in T-24).
3. With only one member (before B joins), odd weeks show "o outro responsável" without a color.
4. Known limit: the child's name is read from `children`, but onboarding does not write that
   table yet (see T-05 notes); until it does, the home says "A criança".

## T-10 — Monthly calendar with colored weeks (RF-06)

Status: **code done and unit-tested; not verified against a live Supabase project or on a
device**. `/calendario` shows the month as whole Monday-to-Sunday weeks (days of the previous
and next month dimmed). Each day has the color of the member who has the child; on a handover
day the cell is split left to right at the handover time (75% for 18:00, 76% on the 25-hour
day summer time ends) and shows "⇄ 18:00". `?mes=YYYY-MM` opens another month, with links to
the previous and next one; today is outlined. All days and times are in the family time zone
(RNF-04). Each cell's `aria-label` says who has the child and when the handover happens.
The page reads the family zone first (it decides which days the grid covers), then one
embedded `members` request with the rule versions and only the overrides that overlap the
days shown. No new tables or policies: `src/lib/custody/calendar-data.sql.test.ts` checks the
reads under the existing RLS on PGlite. The embedded select was only tested against a mocked
client, not a real PostgREST.

1. No migration to apply for this task.
2. Verify with a family of two members (A, B) and a saved rule (T-08), e.g. Sunday 18:00:
   - open `/calendario` (or "Calendário do mês" on the home): every Monday-to-Saturday run is
     one color, alternating each week, and every Sunday is split with "⇄ 18:00";
   - compare a few days with the home (`/`): the color of today matches "com quem está hoje";
   - open the month with the end of summer time (`/calendario?mes=2026-10`): the handover on
     25/10 is still marked 18:00;
   - save a new rule version with another weekday (T-08): the weeks before `valid_from` keep
     the old handover day, the later ones show the new one;
   - insert an override in the SQL editor (`custody_overrides`): its days take the override
     member's color and the cell's tooltip shows the reason (the override screen is T-11).
3. Offline reading of the calendar: see T-12.

## T-11 — Custody exceptions: swapped days, school breaks, holidays (RF-07)

Status: **code done; SQL executed locally (PGlite), not on a live Supabase project or on a
device**. `/excecoes` (linked from the home and the calendar) lists the upcoming and current
exceptions, folds the past ones, and has a form: who keeps the child, start and end date and
time (local to the family zone, RNF-04), and a reason with quick picks ("Troca de dias",
"Férias", "Feriado"). Exceptions are never edited, only added or removed: removing one makes the
rule apply again for its period. In `/calendario` the days an exception covers take the
member's color, carry a bottom bar, and show the reason on the day it starts and at the start of
each week row it spans; a rule handover inside an exception is not drawn; and a list "Exceções
do mês" under the grid gives each reason with its period. When two exceptions overlap, the one
created last wins (business rule 4).

Migration `20261014000500_custody_overrides.sql` replaces the `for all` policy with select,
insert and delete policies for family members, revokes `update`, sets `created_at` to the server
clock on insert (so precedence cannot be forged by the client), and limits one exception to
366 days. Covered by `src/lib/custody/custody-overrides.sql.test.ts` (RLS on PGlite),
`calendar.test.ts`, `override-form.test.ts` and the page tests. The supabase-js insert and
delete calls from the browser were only tested against mocks, not a real PostgREST.

1. Apply the migration: `npx supabase db push`. File:
   `supabase/migrations/20261014000500_custody_overrides.sql`.
2. Verify with two members of one family (A, B) and a saved rule (T-08), e.g. Sunday 18:00:
   - A opens `/excecoes`, picks A, from a Friday 18:00 in A's week to the next Thursday 18:00
     (in what would be B's week), clicks "Férias" and "Adicionar exceção"; the exception appears
     under "Próximas e em curso" with "Criada por A";
   - B opens `/calendario` for that month: those days are in A's color with "Férias" on the
     Friday (and on the Monday, as the period spans two rows), the Sunday handover is gone,
     "⇄ 18:00" shows on the Thursday, and "Exceções do mês" lists "Férias: com A de ... a ...";
   - B adds an overlapping one-day "Feriado" with B inside that period: that day shows B and
     "Feriado" (created last wins);
   - while an exception is in force, `/` shows its member and "Exceção: <reason>";
   - B removes "Feriado" on `/excecoes` (confirmation dialog): the calendar shows "Férias" again;
   - through the API with A's session, `supabase.from('custody_overrides').update({...})` fails
     with `42501`; inserting with `created_at: '2099-01-01'` stores the server time instead;
   - a user of another family sees no rows and cannot insert or delete them.
3. Any member can add or remove any exception of the family. No approval by the other member
   and no notification (notifications are out of this task's scope).

## T-12 — Calendar readable offline (RF-16)

Status: **code done; service worker tested in a simulated environment (vitest with an in-memory
Cache Storage and a network that can be switched off), not in a real browser or on a device**.
The acceptance criterion ("in airplane mode, the month already seen opens") needs a phone, a
production build served over HTTPS and a live Supabase project, so it is still to be verified.

How it works:

- `public/sw.js` (cache version `v2`) stores every page loaded by a full navigation (network
  first, the stored copy only when the network fails), as in T-06, and now also:
  - answers a `cache-pages` message from `/calendario`: the page asks for a copy of the URL on
    screen and of its canonical form `/calendario?mes=YYYY-MM`, plus the `/_next/static/`
    scripts and styles it loaded. This covers months reached with the "Anterior"/"Próximo"
    links (client-side navigation, which the worker never sees as a page load) and the first
    visit (whose scripts were fetched before the worker was in control). Offline, a link click
    fails to fetch from the server and Next.js falls back to a full navigation, which the worker
    answers from the stored copy;
  - keeps the 40 pages stored most recently;
  - deletes all stored pages when "Sair" posts to `/auth/signout` (they contain the family's
    data); icons and scripts stay;
  - never stores redirects, `/api/` or `/auth/` responses.
- `/calendario` shows "Atualizado em dd/mm/aaaa hh:mm" (family zone) under the grid, so an
  offline copy says how old it is, and a notice "Sem conexão: este é o calendário salvo neste
  aparelho..." while the device is offline.
- Covered by `src/lib/pwa/sw.test.ts`, `src/lib/pwa/offline.test.ts` and the calendar page test.

Verification (Android/Chrome and iOS/Safari, app installed from the T-06 steps, logged in, with
a rule saved):

1. Online, open the app, go to "Calendário" (current month), then "Próximo ›" once.
2. Close the app. Turn on airplane mode.
3. Open the app again, go to "Calendário": the current month opens with the colors and
   handovers, the "Sem conexão" notice and the "Atualizado em" time of step 1.
4. "Próximo ›" opens the next month (seen in step 1). Another "Próximo ›" (never seen) shows the
   "Sem conexão" fallback page.
5. Turn airplane mode off and reload: the notice disappears and "Atualizado em" shows now.
6. "Sair", then in airplane mode open `/calendario`: the fallback page shows, not the old data.
   In Chrome DevTools > Application > Cache Storage, `pages-v2` is gone after signing out.

Known limits:

- iOS may evict the storage of a PWA that is not opened for a few weeks, and Safari outside the
  home screen keeps less (see "Riscos" in `docs/plano-mvp.md`).
- Only months already opened while online are available; nothing is prefetched.
- After a deploy, `shell-v2` keeps the old build's scripts until the cache version is raised.

## T-13 — Expense form with a share per expense and the family default (RF-08, RF-09)

Status: **code done; SQL executed locally (PGlite), not on a live Supabase project; the form
was not exercised in a browser**. `/despesas/nova` (linked from the home as "Nova despesa")
registers an expense: amount (typed as text, "12,50", "1.234,56" or "1,234.56", parsed to
integer cents without floats), date (today in the family zone by default, no future dates),
description, category (the fixed list of the `expenses.category` check), who paid (the caller
by default) and the payer's share in percent, prefilled with `families.default_payer_share_bps`
and editable per expense. A line under the form shows the split ("Ana paga 30,00 € (60%) e
Bruno, 20,00 € (40%)"), rounded as business rule 1 says, so the two parts add up to the amount.
The "Padrão da família" section on the same page edits the default; existing expenses keep the
share they were saved with.

Migration `20261014000600_expense_form.sql`: a new expense always starts `pending`, with
`deleted_at` null and server timestamps, whatever the client sends (the payer cannot
self-confirm); amounts are capped at 1 000 000,00. The RLS from T-05 is unchanged: members
read, insert and update their family's expenses, nobody deletes them, and members update their
own family (the default share). Covered by `src/lib/expenses/expenses.sql.test.ts`,
`money.test.ts`, `expense-form.test.ts` and `src/app/despesas/nova/page.test.tsx`.

1. Apply the migration: `npx supabase db push`.
2. Verify with two members of one family (A, B):
   - A opens `/despesas/nova`: "Parte de quem pagou (%)" shows `50`; type `100,00`, a
     description and a category; the split line shows 50,00 € for each; "Registrar despesa"
     shows "Despesa registrada: ...";
   - in the SQL editor: the row has `amount_cents = 10000`, `payer_share_bps = 5000`,
     `status = 'pending'`, `created_by` = A;
   - change the percent to `30` for another expense: the row has `payer_share_bps = 3000`;
   - B sets "Padrão da família" to `60` and saves; reloading the page as A shows `60`
     prefilled; the earlier rows still have 5000 and 3000;
   - with a user of another family, `supabase.from('expenses').insert({... family_id: <A's> })`
     fails with `42501`, and `supabase.from('families').update({default_payer_share_bps: 0})
     .eq('id', <A's family>)` changes no row.
3. Gaps: the receipt photo of RF-08 arrives in T-14 (`receipt_path` stays null); the expense
   list (T-15) does not exist yet, so the page only confirms the saved expense. Either member
   can change the family default, without the other's approval.

## T-14 — Receipt upload with client compression

Status: **code and policies done and tested locally; not verified against a live Supabase
project or a real phone camera**. The form compresses the photo in the browser (canvas, JPEG,
longer side up to 1600 px, quality 0.8 down to 0.4, then smaller pictures) until it is at most
300 KB, uploads it to the private `receipts` bucket at `<family_id>/<uuid>.jpg` and stores the
path in `expenses.receipt_path`. `ReceiptLink` (src/app/despesas/ReceiptLink.tsx) opens a
receipt through a 60 s signed URL; the expense list (T-15) must render it. Tests:
`src/lib/receipts/*.test.ts` (compression search with a fake encoder, path, signed URL call)
and `receipts.sql.test.ts` (bucket private, policies, `receipt_path` check; on PGlite with a
stub of the `storage` schema).

Not tested: the canvas/`createImageBitmap` path itself (needs a browser), and real Storage.

1. Apply the migration: `npx supabase db push` (file `20261014000700_receipts_storage.sql`).
   It creates the bucket with `public = false`, 500 KB limit, `image/jpeg` only. If the
   dashboard shows the bucket as public, switch it off.
2. In **Storage > Policies**, check the 4 policies "receipts: members ..." on `storage.objects`.
3. As A, on `/despesas/nova`, pick a 3-6 MB photo from the camera, fill the form and save.
   In **Storage > receipts** the object is under A's family id and is about 300 KB or less
   (check on Android and on iOS Safari/PWA; HEIC photos must also work).
4. Open the object's public URL (`/storage/v1/object/public/receipts/...`): must return an
   error, not the image.
5. With a user of another family, `supabase.storage.from('receipts').createSignedUrl(<A's
   path>, 60)` must fail, and `list` must show nothing. A signed URL made by A must stop
   working after 60 s.

## T-16 — Confirm or dispute an expense (RF-11)

Not tested: the RPC calls against a real PostgREST (tests use PGlite and a mocked client).

1. Apply the migration: `npx supabase db push` (file `20261014000800_expense_decision.sql`).
   It adds `dispute_comment`, `decided_by`, `decided_at`, the functions `confirm_expense` and
   `dispute_expense`, and a trigger that blocks direct updates of the status.
2. As A (payer), create an expense. On `/despesas` A sees no "Confirmar"/"Contestar" buttons.
3. As B, confirm it: status becomes "Confirmada". Create another, dispute it with a comment:
   status "Contestada" and the comment "Motivo: ..." shows for both. An empty comment must be refused.
4. In the SQL editor / client, `update expenses set status = 'confirmed'` as A must fail
   with "expense status can only change through confirm_expense or dispute_expense".

## T-17 — Expense audit trigger and history screen (RF-12, RNF-03)

Status: **code done; SQL executed locally (PGlite), not on a live Supabase project; the history
screen was only rendered in tests with a mocked client**.

Migration `20261015000100_expense_audit.sql`:

- trigger `expenses_audit` (after insert or update on `expenses`, `security definer`) writes one
  `expense_audit` row per change with the full row before (`old_data`) and after (`new_data`),
  `changed_by = auth.uid()` and the server time. `action` is `insert`, `update`, or `delete` when
  `deleted_at` goes from null to a value (logical delete, RF-17 / T-18). An update that changes
  nothing (apart from `updated_at`) writes no row. Confirm/dispute (T-16) are recorded as updates
  by the member who decided;
- a direct `INSERT` into `expense_audit` is refused (`42501`) for every role, including the
  table owner, so all rows come from the trigger;
- `UPDATE`, `DELETE` and `TRUNCATE` on `expense_audit` are refused for every role (`AU001`).
  The only exception is the cascade when a whole family is deleted (same rule as
  `custody_rules`). As a consequence an expense can never be hard-deleted on its own;
- new column `seq` (identity) orders rows within one transaction; the foreign key from
  `changed_by` to `auth.users` was dropped so deleting an auth user never has to rewrite audit
  rows (the user id stays as a historical fact).

Screen: `/despesas/<id>/historico` (link "Histórico" on each item of `/despesas`) lists the
changes newest first: "Criou / Alterou / Confirmou / Contestou / Excluiu / Restaurou a despesa",
who, when (family time zone) and each changed field as "antes → depois". Receipts show as
"anexado / substituído / sem comprovante", never by path. A deleted expense keeps its history
at the same URL.

Covered by `src/lib/expenses/expense-audit.sql.test.ts`, `expense-history.test.ts`,
`src/app/despesas/[id]/historico/page.test.tsx` and `src/test/rls-isolation.sql.test.ts`.

1. Apply the migration: `npx supabase db push`.
2. Verify with two members of one family (A, B):
   - A creates an expense; B disputes it; A edits the amount (SQL editor or T-18 screen once it
     exists); B confirms. `/despesas/<id>/historico` shows 4 entries with the right names and
     times, and the amount change as "100,00 € → 120,00 €";
   - in the SQL editor (role `postgres`): `update expense_audit set action = 'x'`,
     `delete from expense_audit` and `truncate expense_audit` all fail with "expense audit rows
     are immutable"; `insert into expense_audit ...` fails with "expense audit rows are written
     only by the expenses_audit trigger"; `delete from expenses where id = '<id>'` also fails;
   - through the API with A's session, `supabase.from('expense_audit').insert/update/delete`
     fail with `42501`; a user of another family reads no rows.
3. Data erasure (GDPR): deleting the family row removes its expenses and audit. Removing a
   single expense or audit row requires the table owner to disable the triggers explicitly
   (`alter table expense_audit disable trigger expense_audit_immutable`), which is itself visible
   in the database logs. Do not do this as routine.
4. Note: the `service_role` key and the SQL editor bypass RLS but not these triggers. A
   superuser can still disable triggers; the audit protects against the app and its users, not
   against the database administrator.

## T-18: edit and logical deletion of expenses (RF-17)

Migration `20261015000200_expense_edit_delete.sql` replaces the `expenses_guard_decision` trigger
(T-16). Server rules on `UPDATE`: a deleted expense is final (no edit, restore or second delete,
`55000`); `family_id` never changes; `deleted_at` is stamped with the server clock; editing the
amount, payer, date, description, category, share or receipt of a confirmed or disputed expense
returns it to `pending` and clears the decision (plan rule 5). Deletion is an `UPDATE` of
`deleted_at`: the row stays and the audit (T-17) records it as `delete`.

Screens: `/despesas/<id>/editar` (link "Editar") and button "Excluir" with confirmation on
`/despesas`. The receipt photo is kept on edit; replacing it is not part of this task.

Covered by `src/lib/expenses/expense-edit-delete.sql.test.ts`.

1. Apply the migration: `npx supabase db push`.
2. Verify with two members (A, B) on the live project:
   - A creates an expense, B confirms, A edits the amount: status shows "Pendente" and B sees
     Confirmar/Contestar again;
   - A clicks "Excluir" and confirms: it leaves `/despesas`, and `/despesas/<id>/historico`
     still shows the creation and the "Excluiu a despesa" entries;
   - opening `/despesas/<id>/editar` of a deleted expense shows "não encontrada ou já excluída".

## T-20 — Balance screen with the "em disputa" line (RF-13)

Status: **code done; reads checked under RLS on PGlite, not on a live Supabase project; the page
was only rendered in tests with a mocked client**. `/saldo` (linked from the home as "Saldo")
shows, for a period, one sentence saying who owes whom ("Ana deve 6,00 € a Bruno." or "Ninguém
deve nada neste período."), how many expenses are in it and the settlements already deducted.
Below it, the "Em disputa" section keeps disputed expenses out of the balance (business rule 4):
how many, what they would add if accepted, and each one with its date, amount, payer, the other
member's part, the dispute reason and a link to its history.

Period: the current month in the family zone by default; another month with `?mes=YYYY-MM` (and
"‹ Anterior" / "Próximo ›" links); `?mes=todos` for everything; or a date range
`?de=YYYY-MM-DD&ate=YYYY-MM-DD` with both days included. An invalid or reversed range shows the
current month with a notice. Expenses are filtered by `spent_on`, settlements by `settled_on`,
deleted expenses are never read. The arithmetic is `computeBalance` (T-19).

No new tables or policies, so no migration: the page reads `expenses` and `settlements` under
the RLS of T-05. Covered by `src/lib/balance/balance-view.test.ts`,
`src/lib/balance/balance-screen.sql.test.ts` (the page's filters under RLS, both members and an
outsider) and `src/app/saldo/page.test.tsx`.

1. No migration to apply for this task.
2. Verify with two members of one family (A, B) on the live project:
   - A records 100,00 € paid by A at 50% and B records 80,00 € paid by B at 30%, both this month;
     `/saldo` as A and as B says "A deve 6,00 € a B." and "2 despesas no saldo";
   - A disputes a third expense paid by B (45,50 € at 50%) on `/despesas`: the main sentence
     stays at 6,00 €; "Em disputa" shows "Fora do saldo: 1 despesa. Se aceitas, A deveria 22,75 €
     a B por elas." with the reason; after B edits it (back to pending, T-18) it moves into the
     main balance;
   - open "‹ Anterior", "Todo o período" and a "De / Até" range that ends on an expense's date:
     that expense is included;
   - insert a settlement in the SQL editor (`settlements`, from A to B, 6,00 €, a date this
     month): `/saldo` says "Ninguém deve nada neste período." (the settlement screen is T-21).
3. Known limits: the balance of a single month nets only that month's expenses and settlements,
   so a settlement paid in November for an October debt shows as a credit in November; use
   "Todo o período" for the running balance. With only one member the page asks to invite the
   other one instead of showing a number.

## T-21 — Settlements migration on the live project

Status: **not done yet** (needs the real Supabase project from T-01).

1. Apply `supabase/migrations/20261015000300_settlements.sql` (`supabase db push`, or paste it in
   the SQL editor after the earlier migrations).
2. Verify as a signed-in member: register a settlement on `/saldo`; the balance drops and the
   settlement appears under "Acertos de contas". Updating or deleting it from the SQL API must
   fail with `permission denied`. A mistaken settlement is undone by registering the opposite one.

## T-22 — CSV export of the month's expenses

Status: **code done, not checked in real Excel yet** (needs the live project from T-01 and Excel).

No migration: the export reads `expenses` and `members` through the signed-in user's session, so
the RLS of T-05 applies. Covered by `src/lib/expenses/expense-csv.test.ts` and
`src/app/despesas/exportar/route.test.ts` (BOM bytes, accents, month range, soft-deleted rows excluded).

1. Open `/despesas`, pick a month with accented descriptions (e.g. "Ação de São João"), click
   "Exportar mês em CSV".
2. Open the downloaded `despesas-AAAA-MM.csv` by double click in Excel (pt/EU locale): accents must
   show correctly and the nine columns must split. Check the same in LibreOffice or Excel for
   Mac if available.
3. Known limits: the file uses `;` as separator and decimal commas (pt/EU Excel); an Excel with
   an English-US locale may need Data > From Text/CSV and `;` as delimiter.

## T-23 — Keepalive cron so the free Supabase project does not pause (RNF-06)

Status: **code done, weekly run not confirmed yet** (needs the Vercel deploy and the live Supabase
project from T-01; a cron only runs on a production deployment).

What exists locally: `vercel.json` schedules `GET /api/cron/keepalive` at `0 6 * * 1,4` (Monday and
Thursday, 06:00 UTC; at most 4 days between runs, under the ~7 days that pause a free project,
and within the Hobby limit of one run per day). The route checks `Authorization: Bearer
<CRON_SECRET>`, calls the `keepalive_ping()` RPC (migration `20261015000400_keepalive_ping.sql`,
returns `now()`, reads no table) and writes one JSON log line with `"event":"supabase_keepalive"`.
Covered by `src/lib/keepalive/*.test.ts` and `src/app/api/cron/keepalive/route.test.ts`.
A local `next start` returned 401 without the secret and 500 "supabase not configured" with it
(no `.env.local` here); the success path against a real project is not verified.

1. Apply `supabase/migrations/20261015000400_keepalive_ping.sql` (`supabase db push`, or paste it
   in the SQL editor). Check: `curl -X POST "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/rpc/keepalive_ping"
   -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" -d '{}'`
   returns a timestamp.
2. In Vercel > Project Settings > Environment Variables, add `CRON_SECRET` for Production
   (`openssl rand -hex 32`). Without it every call returns 401 and the cron does nothing.
3. Redeploy to production. Vercel > Project > Settings > Cron Jobs must list
   `/api/cron/keepalive` with the schedule above. Click "Run" once: the response is 200 and
   Vercel > Logs (filter `supabase_keepalive`) shows `"ok":true` with the database time.
4. Acceptance ("Execução semanal confirmada nos logs"): after 7 days, filter the logs for
   `supabase_keepalive` and confirm at least two scheduled runs (Monday and Thursday) with
   `"ok":true`. Note that the Hobby plan keeps runtime logs for a short time only (about 1 hour
   at the time of writing), so check soon after a run, or use a Log Drain / Pro plan for longer
   history. Supabase > Project > Reports (API requests) also shows the RPC calls.
5. A failed ping returns 502 and logs with `console.error` (`"ok":false`, HTTP status and body),
   so it shows as an error in Vercel Logs. Known limit: Hobby cron timing is precise only to the
   hour, and a skipped run still leaves at most 7 days between pings; there is no alert yet if
   the project is already paused (the "alerta no primeiro uso após pausa" from the risk table is
   not part of T-23).

## T-24 — QA end-to-end on Android and iOS (RNF-05, RNF-07)

Status: **not done on devices**. The acceptance criterion ("Fluxo completo sem erro nos dois
sistemas; home abaixo de 2 s em 4G") needs a real Android phone, a real iPhone, the deploy and the
live Supabase project from T-01, none of which exist here. What was done locally, with the measured
numbers, and the full device test script are in [`docs/qa-e2e.md`](qa-e2e.md):

- `src/test/e2e-flow.sql.test.ts`: the whole journey of two guardians (family, invite, rule,
  exception, expenses, confirm/dispute, edit, delete, audit, balance, settlement, CSV) on PGlite
  with every migration, plus an outsider who must see nothing. Passes; it is not the real
  PostgREST/GoTrue stack.
- `node tools/perf-home.mjs`: production build in headless Chrome with phone and 4G emulation
  against a local Supabase stand-in. Home on the 4G profile: ~0.7 s first visit, ~0.2 s repeat; one
  Supabase request per render. On DevTools' "Slow 4G" preset a first visit reaches the load event
  at ~2.7 s (content visible at ~1.4 s). Lab numbers on a desktop, not a phone.
- Fixes: iOS zoom on form fields (16 px text), receipt pop-up blocked on iOS, home reduced from
  4 to 1 request to Supabase (`getClaims()` instead of `getUser()` in the proxy, session bar and
  home; no membership check in the proxy for `/`).

Steps:

1. **JWT signing keys.** In Supabase > Project Settings > JWT Keys, check that the project signs
   tokens with an asymmetric key (ECC P-256 or RSA). If it still uses the legacy JWT secret, migrate
   (create a standby asymmetric key, rotate it in, keep the legacy one as previously used until all
   sessions renew). Without this, `getClaims()` falls back to one request to Supabase Auth per call
   (proxy, session bar, home): still correct, but the home loses most of the T-24 gain.
2. **Same region for Vercel and Supabase.** In Vercel > Project > Settings > Functions, set the
   Function Region to the one next to the Supabase project (for example Supabase `eu-central-1`
   Frankfurt with Vercel `fra1`, or `eu-west-2` London with `lhr1`). The default `iad1` (US East)
   adds roughly 80–100 ms to every request from the server to a European database. Redeploy.
3. **Run the device script** in `docs/qa-e2e.md`, section 2, on one Android phone (Chrome) and one
   iPhone (Safari), with the app installed to the home screen, and fill in its results table.
   Every FAIL becomes an issue with a screenshot; the criterion is met only with no FAIL on either
   system.
4. **Measure the home on 4G** on both phones (step 26 of the script: Wi-Fi off, LTE, cold start,
   median of 5, with `chrome://inspect` on Android and Safari Web Inspector on iOS for the exact
   load time). Write the numbers in the results table. If the median is over 2 s, check first the
   server duration of `GET /` in Vercel (region, cold start), then the JavaScript size.
5. Optional, to repeat the lab measurement after changes: `node tools/perf-home.mjs` (needs Chrome
   or Edge; `--runs`, `--supabase-latency <ms>`, `--waterfall`, `--skip-build`). Exit code 1 when the
   4G profile is over 2 s, the home does not render, or the page logs an error.

Known iOS limits to expect (not bugs of the app): a magic link opened from Mail goes to Safari,
whose storage is separate from the installed app; iOS may evict the offline copy of an app not
opened for weeks (see T-12); push notifications are out of the MVP.

## DEMO — Demo mode in a real browser

Status: **partly verified**. `npm run demo` was started locally and every main page (`/`,
`/calendario`, `/guarda`, `/excecoes`, `/despesas`, `/despesas/nova`, `/saldo`, `/convidar`,
`/login`, an expense history and the CSV export) was fetched with curl and rendered the seed data
(home: "Leonor está com Ana"; `/saldo`: "Ana deve 6,00 € a Bruno", with the "Em disputa" line). A
write sent to `POST /api/demo` the way the browser client does showed up on `/despesas` and
changed `/saldo`. The forms themselves were not clicked through in a browser.

Steps:

1. `npm run demo`, open <http://localhost:3000> in a browser; the yellow DEMO banner is at the top.
2. Add an expense with a photo in `/despesas/nova`, open its receipt from `/despesas`, edit it,
   confirm "Dentista", record a settlement in `/saldo`, add and remove an exception in `/excecoes`,
   save a new rule in `/guarda`. Each change must appear on the pages without errors in the console.
3. Restart the server: the seed data is back.

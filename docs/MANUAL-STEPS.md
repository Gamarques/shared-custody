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
npm run dev                  # http://localhost:3000 should say "Supabase configurado."
```

`GET /api/health` returns `{"ok":true,"supabaseConfigured":true}` when the variables are valid.

### 3. Deploy on Vercel

1. Push the repository to GitHub (the default branch is expected to be `main`).
2. At <https://vercel.com/new>, import the repository. Framework preset: **Next.js**
   (auto-detected). No build settings need to change (`npm run build`, output `.next`).
3. In **Settings > Environment Variables**, add `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` for Production, Preview and Development.
4. Deploy. If the variables were added after the first deploy, **redeploy**: `NEXT_PUBLIC_*`
   values are inlined at build time, and the home page is statically prerendered.

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

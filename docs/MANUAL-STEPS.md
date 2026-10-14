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

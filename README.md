# Guarda Compartilhada

PWA for two guardians to share weekly alternating custody of a child and split expenses.
The plan is in [`docs/plano-mvp.md`](docs/plano-mvp.md); steps that need external accounts are in
[`docs/MANUAL-STEPS.md`](docs/MANUAL-STEPS.md).

Stack: Next.js (App Router) + TypeScript, Supabase (Auth, Postgres, Storage), Vercel.

## Development

```bash
npm install
cp .env.example .env.local   # fill in the Supabase URL and anon key
npm run dev                  # http://localhost:3000
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production build and server |
| `npm test` | Unit tests (vitest) |
| `npm run typecheck` | TypeScript check |

## Layout

- `src/app` — routes (`/` home, `/api/health` liveness check)
- `src/lib/env.ts` — validation of the public Supabase variables
- `src/lib/supabase` — browser and server Supabase clients (`@supabase/ssr`)
- `supabase/migrations` — SQL migrations, including RLS policies

Conventions: money is always stored and computed as integer cents; every table has RLS enabled.

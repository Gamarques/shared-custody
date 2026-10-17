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
| `npm run demo` | Dev server in demo mode: fake in-memory data, no Supabase (see below) |
| `npm run build` / `npm start` | Production build and server |
| `npm test` | Unit tests (vitest) |
| `npm run typecheck` | TypeScript check |
| `npm run qa:visual` | Layout QA in real Chrome on every screen at 390/768/1280 px (see `docs/qa-visual.md`) |
| `node tools/perf-home.mjs` | Lab measurement of the home on emulated 4G (see `docs/qa-e2e.md`) |

## Demo mode (no Supabase)

```bash
npm install
npm run demo                 # http://localhost:3000, or: npm run demo -- -p 3100
```

`npm run demo` starts `next dev` with `DEMO_MODE=1` and `NEXT_PUBLIC_DEMO_MODE=1`. No `.env.local`
or Supabase project is needed (the Supabase variables are ignored if present). Setting
`DEMO_MODE=1` before `npm run dev` does the same: `next.config.ts` derives
`NEXT_PUBLIC_DEMO_MODE` from it for Client Components.

- The Supabase factories (`src/lib/supabase/client.ts`, `server.ts`, `proxy.ts`) return a fake
  client (`src/lib/demo`). Server code runs it directly on an in-memory store; Client Components
  send each request to `POST /api/demo`, which runs it on the same store, so forms write data that
  the pages then show. Receipts are kept in memory and served by `/api/demo/receipt`.
- There is no login: everyone is **Ana** (`ana@demo.example`). A yellow **DEMO** banner is shown on
  every page.
- Seed data: family "Família Silva Costa" (EUR, Europe/Lisbon) with Ana and Bruno, child Leonor,
  weekly rule (Sundays at 18:00, Ana first), an override tomorrow ("Feriado com os avós", Bruno),
  and expenses including the plan's example (Material escolar 100,00 € paid by Ana at 50 %,
  Dentista 80,00 € paid by Bruno at 30 %, so **Ana owes Bruno 6,00 €**), a disputed expense, a
  deleted one, last month's pediatrician visit and the settlement that paid it, with their audit
  history. Dates are relative to today.
- The store reproduces what the migrations enforce for the app's calls: RLS by family,
  insert-only/read-only tables, the expense triggers (pending on insert, back to pending when a
  decided expense is edited, logical delete, audit rows) and the RPCs, with the same error codes.
  It is not a SQL engine; the real rules stay in `supabase/migrations` and their PGlite tests.
- Data lives in the server process: restarting the server restores the seed. Never deploy with
  `DEMO_MODE` set: `/api/demo` would let anyone read and write the fake data (it returns 404 when
  demo mode is off).

## Layout

- `src/app` — routes (`/` home, `/api/health` liveness check)
- `src/lib/env.ts` — validation of the public Supabase variables
- `src/lib/supabase` — browser and server Supabase clients (`@supabase/ssr`)
- `src/lib/demo` — demo mode: fake Supabase client, in-memory store and seed data
- `supabase/migrations` — SQL migrations, including RLS policies

Conventions: money is always stored and computed as integer cents; every table has RLS enabled.

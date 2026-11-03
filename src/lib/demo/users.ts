/** Demo accounts. The demo is always used as Ana; Bruno is the other guardian. */
export const DEMO_ANA = { id: "a0a0a0a0-0000-4000-8000-000000000001", email: "ana@demo.example" } as const;
export const DEMO_BRUNO = { id: "b0b0b0b0-0000-4000-8000-000000000002", email: "bruno@demo.example" } as const;
/** Signed up but never finished onboarding: only seen in /admin ("Utilizadores"). */
export const DEMO_RITA = { id: "e0e0e0e0-0000-4000-8000-000000000005", email: "rita@demo.example" } as const;
export const DEMO_USER = DEMO_ANA;
/** Ana is also the platform admin in the demo, so /admin can be tried. */
export const DEMO_ADMINS: readonly string[] = [DEMO_ANA.id];

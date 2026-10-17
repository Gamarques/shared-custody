// `npm run demo`: the dev server in demo mode (fake in-memory data, no Supabase project).
// Extra arguments go to `next dev`, e.g. `npm run demo -- -p 3100`.
// DEMO_VARIANT=no-family|solo|empty|error picks an alternative data set for visual QA (see src/lib/demo/seed.ts).
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");
const child = spawn(process.execPath, [nextBin, "dev", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, DEMO_MODE: "1", NEXT_PUBLIC_DEMO_MODE: "1" },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));

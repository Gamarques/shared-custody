import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // tools/perf-home.mjs builds into its own directory so the normal .next build is untouched.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Client Components read NEXT_PUBLIC_DEMO_MODE (inlined at build time): DEMO_MODE=1 alone is
  // enough to turn demo mode on everywhere (src/lib/demo/mode.ts).
  env: {
    NEXT_PUBLIC_DEMO_MODE: process.env.NEXT_PUBLIC_DEMO_MODE === "1" || process.env.DEMO_MODE === "1" ? "1" : "",
  },
};

export default nextConfig;

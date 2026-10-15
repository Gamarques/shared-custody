import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // tools/perf-home.mjs builds into its own directory so the normal .next build is untouched.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    // Booting PGlite and applying every migration takes seconds per SQL test file, more when
    // several run in parallel.
    hookTimeout: 60_000,
  },
});

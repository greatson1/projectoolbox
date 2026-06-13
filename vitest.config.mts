// NOTE: keep this as .mts, not .ts. On Node < 22.12 (and Windows in
// particular) vitest loads a .ts config through a CJS require path, which
// then require()s std-env — an ESM-only package — and dies with
// ERR_REQUIRE_ESM before any test runs. The .mts extension forces vite to
// load the config via native ESM import, sidestepping the broken require.
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
    globals: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Project-level rule overrides.
  {
    rules: {
      // Codebase intentionally uses `any` in API routes, Prisma queries,
      // and NextAuth session types — these are wide-open by design.
      "@typescript-eslint/no-explicit-any": "off",

      // Several large page components use @ts-nocheck at the top (agile
      // board, schedule, sprint tracker) to defer full typing. Keeping
      // the pragma in place is deliberate while the codebase matures.
      "@typescript-eslint/ban-ts-comment": "off",

      // Apostrophes in UI copy strings — &apos; would look odd in code.
      "react/no-unescaped-entities": "off",

      // Demoted from error to warning so the gate stays green while
      // genuine const-vs-let issues surface as dev warnings.
      "prefer-const": "warn",

      // Codebase has many destructured-but-unused parameters kept for
      // documentation / future use. Underscored names are exempted.
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      }],

      // Transitional React compiler/lint rules: keep visible but non-blocking
      // while larger refactors are in progress. These are new React-compiler
      // diagnostics (impure calls like Date.now() in render, components defined
      // during render, setState-in-effect) that flag real-but-non-urgent
      // refactors across many legacy pages — demoted to warn so the CI lint
      // gate stays green while they're worked through incrementally.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      // Rules-of-hooks promoted to error 2026-06 after a hook called
      // AFTER an early-return on the /artefacts page shipped to prod
      // and crashed the page with React error #310 ("Rendered fewer
      // hooks than expected"). The codebase now passes this rule with
      // zero violations; keep it as `error` so the next violation
      // breaks CI instead of shipping. See artefacts/page.tsx around
      // the AgentStatusBanner component for the canonical fix shape
      // (hoist hooks above the guard, then guard, then derived state).
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/purity": "warn",
      "react-hooks/static-components": "warn",
    },
  },
  // Playwright e2e specs are not React. The react-hooks plugin false-positives
  // on the standard fixture pattern `base.extend({ request: async ({...}, use)
  // => { await use(ctx) } })` — it reads `use(...)` as a React Hook call in a
  // non-component function and errors on rules-of-hooks. Disable the React
  // hook rules for these files; they keep firing everywhere that matters.
  {
    files: ["tests/e2e/**", "tests/**/*.spec.ts", "playwright.config.ts"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
      "react-hooks/purity": "off",
      "react-hooks/static-components": "off",
    },
  },
]);

export default eslintConfig;

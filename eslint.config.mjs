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
    // The e2e suite's own Next build output, same reasoning as .next/.
    ".next-e2e/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored E2E tooling (downloaded binaries, generated).
    "tools/**",
    // Build and test OUTPUT. None of it is source, all of it is gitignored,
    // and linting it makes the result depend on what happened to be run last:
    //
    //   - test-results/ — Playwright creates and removes
    //     .playwright-artifacts-* while it runs, and a directory that vanishes
    //     mid-glob aborts the entire lint with ENOENT rather than a lint error.
    //   - .wrangler/tmp/ — bundles written by `wrangler dev` / `preview`,
    //     containing generated code that trips no-this-alias and a hundred
    //     unused-var warnings. Present only if someone ran wrangler locally,
    //     so the same commit lints clean or dirty depending on the machine.
    //
    // Both are exactly the kind of thing that turns a CI quality gate into a
    // coin toss, which is worse than not having the gate.
    "test-results/**",
    "playwright-report/**",
    ".wrangler/**",
    ".open-next/**",
  ]),
  {
    // Test scaffolding legitimately uses `any` for chainable supabase/mock
    // stubs and keeps intentionally-unused fixtures for readability. Relax the
    // two rules that fight that without weakening app-code linting.
    files: ["tests/**/*.{ts,tsx,mjs}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
]);

export default eslintConfig;

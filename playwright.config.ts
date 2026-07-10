import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config. The webServer command boots the ENTIRE local stack
 * (embedded Postgres + PostgREST + mock GoTrue gateway + next dev) —
 * see tests/e2e/stack/server.mjs. No external Supabase project is touched.
 */
export default defineConfig({
  testDir: "tests/e2e",
  testIgnore: ["**/stack/**"],
  fullyParallel: false, // one shared DB; specs manage their own users
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "node tests/e2e/stack/server.mjs",
    url: "http://localhost:3100",
    reuseExistingServer: true,
    timeout: 240_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});

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
    // The app registers a service worker (public/sw.js) on every page, and
    // page.route() never sees a request the worker makes on the page's
    // behalf. Blocked by default so specs mock exactly what they did before;
    // a spec about the worker itself opts back in with `serviceWorkers: "allow"`.
    serviceWorkers: "block",
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

import { defineConfig } from "@playwright/test";
import base, { STACK_SERVER } from "./playwright.config";

/**
 * The CHECKOUT run: the same stack, started with the development test payment
 * provider switched on (lib/checkout/availability.ts), and only the specs that
 * need it.
 *
 *   pnpm test:e2e:checkout
 *
 * WHY A SECOND CONFIG, not a flag flipped in the default one. The default run
 * exercises the product as it ships today, with no payment provider: the buy
 * button falls back to the seller's own link or an enquiry, and specs 46 and 48
 * assert exactly that. Switching checkout on for every spec would trade that
 * coverage for this. Left as an environment variable to remember, though, the
 * checkout specs skipped on every ordinary run, and the one path that takes a
 * buyer's order went untested by default.
 *
 * The variables are set here rather than on the command line so the script is
 * the same on Windows and Linux. NEXT_PUBLIC_APP_URL points mailed order links
 * at the stack instead of the developer's own :3000.
 */
const CHECKOUT_ENV = {
  CHECKOUT_TEST_PAYMENTS: "1",
  NEXT_PUBLIC_APP_URL: "http://localhost:3100",
};

// Set on THIS process, which is what the stack inherits: Playwright starts the
// web server with the runner's environment, and the stack hands its own on to
// `next dev`. (Passing them through `webServer.env` instead did not reach the
// stack, and every spec here skipped while reporting green.) The specs read
// the switch too (80-seller-order-flow branches on it), and Playwright loads
// this file in every worker.
Object.assign(process.env, CHECKOUT_ENV);

export default defineConfig({
  ...base,
  testMatch: [
    "78-checkout.spec.ts",
    "79-checkout-visuals.spec.ts",
    "80-seller-order-flow.spec.ts",
    "81-phone-action-pages.spec.ts",
    "82-buy-button.spec.ts",
    "83-discounts.spec.ts",
    "86-order-lifecycle.spec.ts",
    "90-device-sweep.spec.ts",
  ],
  webServer: {
    ...STACK_SERVER,
    // Never reuse: a stack already on the port was started WITHOUT the switch,
    // and every spec here would skip against it and report green.
    reuseExistingServer: false,
  },
});

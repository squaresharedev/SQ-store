import { defineConfig } from "@playwright/test";
import base, { STACK_SERVER } from "./playwright.config";
import { STRIPE_MOCK_KEY, STRIPE_MOCK_ORIGIN, STRIPE_MOCK_WEBHOOK_SECRET } from "./tests/e2e/stripe-mock";

/**
 * The STRIPE CONNECT run: the same stack with Connect switched on and pointed
 * at a stand-in for Stripe (tests/e2e/stripe-mock.ts), and only the specs that
 * need it.
 *
 *   pnpm test:e2e:connect
 *
 * WHY A THIRD CONFIG. Connect is off in the default run (the product as it
 * ships today) and the test payment provider wins over it in the checkout run
 * (lib/checkout/availability.ts), so neither can reach the Stripe provider.
 * This one leaves CHECKOUT_TEST_PAYMENTS unset on purpose.
 *
 * NO REAL STRIPE. The key and signing secret are fixed, obviously fake values
 * and STRIPE_API_BASE sends every call to the stand-in on this machine.
 * Nothing leaves it. What that does and does not prove is at the top of
 * tests/e2e/stripe-mock.ts.
 *
 * Set on THIS process, for the reason playwright.checkout.config.ts gives.
 */
const CONNECT_ENV = {
  NEXT_PUBLIC_STRIPE_CONNECT_ENABLED: "true",
  STRIPE_SECRET_KEY: STRIPE_MOCK_KEY,
  STRIPE_CONNECT_WEBHOOK_SECRET: STRIPE_MOCK_WEBHOOK_SECRET,
  STRIPE_API_BASE: `${STRIPE_MOCK_ORIGIN}/v1`,
  NEXT_PUBLIC_APP_URL: "http://localhost:3100",
  // The test provider would win: this run is about the other one.
  CHECKOUT_TEST_PAYMENTS: "",
  // A developer's .env.local may simulate a connected store on the Payments
  // page (lib/payments/mock.ts). Here the page must show the real connection,
  // or a seller who has connected nothing reads as ready to be paid.
  PAYMENTS_MOCK_DATA: "false",
};

Object.assign(process.env, CONNECT_ENV);

export default defineConfig({
  ...base,
  testMatch: ["87-stripe-connect.spec.ts"],
  webServer: {
    ...STACK_SERVER,
    // Never reuse: a stack already on the port was started without Connect.
    reuseExistingServer: false,
  },
});

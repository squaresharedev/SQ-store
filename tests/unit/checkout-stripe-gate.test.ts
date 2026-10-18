/**
 * WHEN A REAL PAYMENT MAY BE TAKEN (lib/checkout/availability.ts).
 *
 * The Stripe provider is offered for a seller only when every one of these
 * holds, and each is pinned here because each is a way to take money that
 * should not have been taken:
 *
 *   - Connect is switched on AND the server holds both of its secrets;
 *   - the seller has a connected account, Stripe says it may take payments,
 *     and it is the same mode as this deployment's key;
 *   - mail works (a sale nobody is told about);
 *   - a deployed build has the bot check (a card-testing endpoint otherwise);
 *   - an order link can be issued (a buyer with no way back to their order).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaymentAccount } from "@/lib/payments/connect/account";

const state = vi.hoisted(() => ({ account: null as PaymentAccount | null, reads: 0 }));

vi.mock("@/lib/payments/availability", () => ({ STRIPE_CONNECT_AVAILABLE: true }));
vi.mock("@/lib/payments/connect/account", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/payments/connect/account")>()),
  readPaymentAccount: vi.fn(async () => {
    state.reads += 1;
    return state.account;
  }),
}));

import { checkoutProviderFor } from "@/lib/checkout/availability";

const OWNER = "5f0c4d0e-6c2b-4f0e-9a43-0d6a0a7b1c11";

const chargeable: PaymentAccount = {
  ownerId: OWNER,
  stripeAccountId: "acct_1Chargeable",
  chargesEnabled: true,
  payoutsEnabled: true,
  detailsSubmitted: true,
  livemode: false,
};

/** A development server with everything a real payment needs, in test mode. */
beforeEach(() => {
  state.account = chargeable;
  state.reads = 0;
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("CHECKOUT_TEST_PAYMENTS", "");
  vi.stubEnv("ORDER_LINK_SECRET", "a-key");
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_unit");
  vi.stubEnv("STRIPE_CONNECT_WEBHOOK_SECRET", "whsec_unit");
  vi.stubEnv("TRANSACTIONAL_EMAIL_FROM", "no-reply@example.test");
  vi.stubEnv("TRANSACTIONAL_EMAIL_ENABLED", "true");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("the Stripe provider", () => {
  it("takes the payment of a seller whose account may take payments", async () => {
    expect(await checkoutProviderFor(OWNER)).toBe("stripe");
  });

  it("is not offered to a seller who has not connected, or is not cleared yet", async () => {
    state.account = null;
    expect(await checkoutProviderFor(OWNER)).toBeNull();
    state.account = { ...chargeable, chargesEnabled: false };
    expect(await checkoutProviderFor(OWNER)).toBeNull();
  });

  it("never charges an account of the other mode", async () => {
    // A live deployment and an account made in test mode, and the other way round.
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_unit");
    expect(await checkoutProviderFor(OWNER)).toBeNull();
    state.account = { ...chargeable, livemode: true };
    expect(await checkoutProviderFor(OWNER)).toBe("stripe");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_unit");
    expect(await checkoutProviderFor(OWNER)).toBeNull();
  });

  it("needs both of Connect's secrets, and does not even look the seller up without them", async () => {
    vi.stubEnv("STRIPE_CONNECT_WEBHOOK_SECRET", "");
    expect(await checkoutProviderFor(OWNER)).toBeNull();
    vi.stubEnv("STRIPE_CONNECT_WEBHOOK_SECRET", "whsec_unit");
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    expect(await checkoutProviderFor(OWNER)).toBeNull();
    expect(state.reads).toBe(0);
  });

  it("needs mail: a paid order nobody is told about is not taken", async () => {
    vi.stubEnv("TRANSACTIONAL_EMAIL_FROM", "");
    expect(await checkoutProviderFor(OWNER)).toBeNull();
    // A deployed build with a sender but mail still switched off.
    vi.stubEnv("TRANSACTIONAL_EMAIL_FROM", "no-reply@example.test");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "a-secret");
    vi.stubEnv("TRANSACTIONAL_EMAIL_ENABLED", "");
    expect(await checkoutProviderFor(OWNER)).toBeNull();
    vi.stubEnv("TRANSACTIONAL_EMAIL_ENABLED", "true");
    expect(await checkoutProviderFor(OWNER)).toBe("stripe");
  });

  it("needs the bot check in a deployed build, which is what a card tester can reach", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(await checkoutProviderFor(OWNER)).toBeNull();
    vi.stubEnv("TURNSTILE_SECRET_KEY", "a-secret");
    expect(await checkoutProviderFor(OWNER)).toBe("stripe");
  });

  it("needs an order link to hand the buyer", async () => {
    vi.stubEnv("ORDER_LINK_SECRET", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(await checkoutProviderFor(OWNER)).toBeNull();
  });

  it("stands behind the test provider on a development server that has it on", async () => {
    vi.stubEnv("CHECKOUT_TEST_PAYMENTS", "1");
    expect(await checkoutProviderFor(OWNER)).toBe("test");
    expect(state.reads).toBe(0);
  });
});

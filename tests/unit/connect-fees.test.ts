/**
 * OUR CUT AS STRIPE COLLECTED IT (lib/payments/connect/fees.ts).
 *
 * The checkout asks Stripe for a fee; what lands in Square Share's balance is
 * Stripe's to say. Pinned here:
 *
 *   - the ledger is written from Stripe's own application fee object, read
 *     from the PLATFORM account, for the payment on the seller's account;
 *   - when Stripe collected something other than what was asked, a person is
 *     told and the order is corrected to what was collected;
 *   - a sale that carried no fee writes nothing;
 *   - every return of a fee is written once, under Stripe's refund id.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { method: string; path: string; params: unknown; account: string | undefined };

const state = vi.hoisted(() => ({
  order: null as { platform_fee_cents: number; ad_fee_cents: number; application_fee_cents: number | null } | null,
  stripe: {} as Record<string, unknown>,
  calls: [] as Call[],
  updates: [] as Record<string, unknown>[],
}));

const ledger = vi.hoisted(() => ({ recordOrderFees: vi.fn(), recordFeeRefund: vi.fn() }));
const ops = vi.hoisted(() => ({ alertOps: vi.fn() }));

vi.mock("@/lib/billing/fee-ledger", () => ledger);
vi.mock("@/lib/ops/alert", () => ops);
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/billing/stripe-api", () => ({
  stripeRequest: vi.fn(async (method: string, path: string, params: unknown, options?: { account?: string }) => {
    state.calls.push({ method, path, params, account: options?.account });
    if (!(path in state.stripe)) throw new Error(`unexpected Stripe call: ${path}`);
    return state.stripe[path];
  }),
}));

import { recordChargeFeeRefunds, settleOrderFees } from "@/lib/payments/connect/fees";
import type { createAdminClient } from "@/lib/supabase/admin";

const ORDER = "0b9f7a52-1a0f-4f5e-8f0e-7d7f2f3c9a11";
const ACCOUNT = "acct_1Seller";
const PAYMENT = "pi_3Payment";

/** The slice of the admin client the module uses: read one order, update it. */
const admin = {
  from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.order, error: null }) }) }),
    update: (values: Record<string, unknown>) => ({
      eq: async () => {
        state.updates.push(values);
        return { error: null };
      },
    }),
  }),
} as unknown as ReturnType<typeof createAdminClient>;

const charged = (feeId: string | null) => ({
  [`/payment_intents/${PAYMENT}`]: { id: PAYMENT, latest_charge: { id: "ch_1", application_fee: feeId, application_fee_amount: null } },
});
const feeObject = (id: string, amount: number, refunded = 0) => ({
  [`/application_fees/${id}`]: { id, amount, amount_refunded: refunded, currency: "eur", livemode: false },
});

beforeEach(() => {
  state.order = { platform_fee_cents: 125, ad_fee_cents: 0, application_fee_cents: 125 };
  state.stripe = {};
  state.calls = [];
  state.updates = [];
  vi.clearAllMocks();
});

describe("settling a confirmed payment", () => {
  it("writes the ledger from Stripe's fee object when it is what was asked for", async () => {
    state.stripe = { ...charged("fee_1"), ...feeObject("fee_1", 125) };
    await settleOrderFees(admin, ORDER, ACCOUNT, PAYMENT);

    expect(ledger.recordOrderFees).toHaveBeenCalledWith(ORDER, { applicationFeeId: "fee_1", livemode: false });
    expect(state.updates).toEqual([]);
    expect(ops.alertOps).not.toHaveBeenCalled();
  });

  it("reads the payment on the seller's account and the fee on the platform's", async () => {
    state.stripe = { ...charged("fee_1"), ...feeObject("fee_1", 125) };
    await settleOrderFees(admin, ORDER, ACCOUNT, PAYMENT);

    expect(state.calls).toEqual([
      { method: "GET", path: `/payment_intents/${PAYMENT}`, params: { expand: ["latest_charge"] }, account: ACCOUNT },
      // No Stripe-Account header: the fee object is ours, not the seller's.
      { method: "GET", path: "/application_fees/fee_1", params: undefined, account: undefined },
    ]);
  });

  it("corrects the order to what Stripe collected, and tells a person", async () => {
    state.stripe = { ...charged("fee_1"), ...feeObject("fee_1", 120) };
    await settleOrderFees(admin, ORDER, ACCOUNT, PAYMENT);

    expect(ops.alertOps).toHaveBeenCalledWith(
      "A sale's fee differs from what was asked for",
      expect.objectContaining({ order: ORDER, asked: 125, collected: 120 }),
    );
    expect(state.updates).toEqual([{ platform_fee_cents: 120, ad_fee_cents: 0, application_fee_cents: 120 }]);
    // Written AFTER the correction, so the rows are Stripe's figure.
    expect(ledger.recordOrderFees).toHaveBeenCalledWith(ORDER, { applicationFeeId: "fee_1", livemode: false });
  });

  it("lets the ad fee give way first when less was collected than asked", async () => {
    state.order = { platform_fee_cents: 200, ad_fee_cents: 250, application_fee_cents: 450 };
    state.stripe = { ...charged("fee_1"), ...feeObject("fee_1", 300) };
    await settleOrderFees(admin, ORDER, ACCOUNT, PAYMENT);
    expect(state.updates).toEqual([{ platform_fee_cents: 50, ad_fee_cents: 250, application_fee_cents: 300 }]);

    state.updates = [];
    state.stripe = { ...charged("fee_1"), ...feeObject("fee_1", 100) };
    await settleOrderFees(admin, ORDER, ACCOUNT, PAYMENT);
    expect(state.updates).toEqual([{ platform_fee_cents: 0, ad_fee_cents: 100, application_fee_cents: 100 }]);
  });

  it("writes nothing for a sale that carried no fee (a waived seller, fees off)", async () => {
    state.order = { platform_fee_cents: 0, ad_fee_cents: 0, application_fee_cents: 0 };
    state.stripe = charged(null);
    await settleOrderFees(admin, ORDER, ACCOUNT, PAYMENT);

    expect(ledger.recordOrderFees).not.toHaveBeenCalled();
    expect(state.updates).toEqual([]);
    expect(ops.alertOps).not.toHaveBeenCalled();
  });

  it("does not leave an order claiming a fee Stripe never collected", async () => {
    state.stripe = charged(null);
    await settleOrderFees(admin, ORDER, ACCOUNT, PAYMENT);

    expect(ops.alertOps).toHaveBeenCalled();
    expect(state.updates).toEqual([{ platform_fee_cents: 0, ad_fee_cents: 0, application_fee_cents: 0 }]);
    expect(ledger.recordOrderFees).not.toHaveBeenCalled();
  });

  it("reads an order from before the fee columns by its platform fee", async () => {
    state.order = { platform_fee_cents: 125, ad_fee_cents: 0, application_fee_cents: null };
    state.stripe = { ...charged("fee_1"), ...feeObject("fee_1", 125) };
    await settleOrderFees(admin, ORDER, ACCOUNT, PAYMENT);
    expect(ops.alertOps).not.toHaveBeenCalled();
    expect(state.updates).toEqual([]);
  });

  it("asks Stripe nothing without a payment to ask about", async () => {
    await settleOrderFees(admin, ORDER, ACCOUNT, null);
    expect(state.calls).toEqual([]);
  });

  it("throws when Stripe cannot be read, so the event is delivered again", async () => {
    await expect(settleOrderFees(admin, ORDER, ACCOUNT, PAYMENT)).rejects.toThrow(/unexpected Stripe call/);
    expect(ledger.recordOrderFees).not.toHaveBeenCalled();
  });
});

describe("a refunded charge", () => {
  it("writes each return of the fee once, under Stripe's refund id", async () => {
    state.stripe = {
      ...feeObject("fee_1", 125, 63),
      "/application_fees/fee_1/refunds": {
        data: [
          { id: "fr_1", amount: 50, fee: "fee_1" },
          { id: "fr_2", amount: 13, fee: "fee_1" },
        ],
        has_more: false,
      },
    };
    expect(await recordChargeFeeRefunds(ORDER, "fee_1")).toBe(2);

    const source = { applicationFeeId: "fee_1", livemode: false };
    expect(ledger.recordFeeRefund.mock.calls).toEqual([
      [ORDER, "fr_1", 50, source],
      [ORDER, "fr_2", 13, source],
    ]);
  });

  it("writes nothing while none of the fee has gone back", async () => {
    state.stripe = feeObject("fee_1", 125, 0);
    expect(await recordChargeFeeRefunds(ORDER, "fee_1")).toBe(0);
    expect(ledger.recordFeeRefund).not.toHaveBeenCalled();
    // The refunds list is not even asked for.
    expect(state.calls.map((call) => call.path)).toEqual(["/application_fees/fee_1"]);
  });
});

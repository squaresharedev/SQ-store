// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/billing/catalog", () => ({
  readSoldPrice: async () => ({ stripeLookupKey: "pro_month_eur_v1", priceCents: 4000, currency: "EUR" }),
}));

import { stripeBillingProvider } from "@/lib/billing/stripe-provider";

const REQUEST = {
  ownerId: "owner-1",
  customerId: "cus_1",
  plan: "pro",
  interval: "month",
  locale: "en",
  successUrl: "https://example.test/ok",
  cancelUrl: "https://example.test/cancel",
} as const;

const PRICE = {
  id: "price_1",
  lookup_key: "pro_month_eur_v1",
  unit_amount: 4000,
  currency: "eur",
  active: true,
  recurring: { interval: "month", interval_count: 1 },
};

/** Stubs fetch, answering by method and path; records every call in order. */
function stubStripe(open: { id: string; mode: string }[], options: { expireFails?: boolean } = {}) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const call = `${init?.method ?? "GET"} ${url.pathname.replace("/v1", "")}`;
    calls.push(call);
    const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (call === "GET /prices") return ok({ data: [PRICE], has_more: false });
    if (call === "GET /checkout/sessions") return ok({ data: open, has_more: false });
    if (call.endsWith("/expire")) {
      return options.expireFails
        ? new Response(JSON.stringify({ error: { type: "invalid_request_error", message: "not open" } }), {
            status: 400,
          })
        : ok({ id: "expired" });
    }
    if (call === "POST /checkout/sessions") return ok({ id: "cs_new", url: "https://checkout.test/cs_new" });
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

describe("stripeBillingProvider.createCheckout", () => {
  beforeEach(() => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("closes the customer's other open subscription pages before opening a new one", async () => {
    const calls = stubStripe([
      { id: "cs_old", mode: "subscription" },
      { id: "cs_other", mode: "subscription" },
    ]);

    await expect(stripeBillingProvider.createCheckout(REQUEST)).resolves.toBe("https://checkout.test/cs_new");

    const created = calls.indexOf("POST /checkout/sessions");
    expect(calls.filter((call) => call.endsWith("/expire")).sort()).toEqual([
      "POST /checkout/sessions/cs_old/expire",
      "POST /checkout/sessions/cs_other/expire",
    ]);
    // Every expiry came before the new page existed.
    for (const [index, call] of calls.entries()) {
      if (call.endsWith("/expire")) expect(index).toBeLessThan(created);
    }
  });

  it("leaves pages that are not subscriptions alone", async () => {
    const calls = stubStripe([{ id: "cs_pay", mode: "payment" }]);
    await stripeBillingProvider.createCheckout(REQUEST);
    expect(calls.some((call) => call.endsWith("/expire"))).toBe(false);
  });

  it("opens no second page when the first could not be closed", async () => {
    const calls = stubStripe([{ id: "cs_old", mode: "subscription" }], { expireFails: true });
    await expect(stripeBillingProvider.createCheckout(REQUEST)).rejects.toThrow();
    expect(calls).not.toContain("POST /checkout/sessions");
  });
});

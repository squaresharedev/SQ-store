/**
 * THE PUBLIC PRICE LIST (GET /api/billing/plan-prices): what the homepage's
 * pricing section reads. Pinned here: it says only what a pricing page says,
 * it is cacheable so a visitor cannot turn it into a database read per
 * request, and when the prices cannot be read it says so rather than guess.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanPrices } from "@/lib/billing/fees";
import { PLAN_PRICE_SEED } from "@/lib/billing/pricing-seed";

const state = vi.hoisted(() => ({ prices: null as unknown }));
vi.mock("@/lib/billing/catalog", () => ({
  readPlanPrices: vi.fn(async () => state.prices as PlanPrices | null),
}));

import { GET } from "@/app/api/billing/plan-prices/route";
import { PLAN_PRICES_API_PATH } from "@/lib/billing/paths";

beforeEach(() => {
  state.prices = PLAN_PRICE_SEED;
});

describe("GET /api/billing/plan-prices", () => {
  it("lives where its path constant says", () => {
    expect(PLAN_PRICES_API_PATH).toBe("/api/billing/plan-prices");
  });

  it("lists each plan's monthly price and direct fee, cheapest first", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      currency: "EUR",
      plans: [
        { id: "free", monthlyPriceCents: 0, directFeeBps: 500 },
        { id: "starter", monthlyPriceCents: 1200, directFeeBps: 200 },
        { id: "pro", monthlyPriceCents: 3900, directFeeBps: 50 },
      ],
    });
  });

  it("says nothing a pricing page does not: no Stripe key, no dates, no marketplace rate", async () => {
    const body = JSON.stringify(await (await GET()).json());
    expect(body).not.toMatch(/lookup|stripe|effective|version|marketplace/i);
  });

  it("follows the rows in force, and reads the monthly row where a yearly one exists too", async () => {
    state.prices = [
      ...PLAN_PRICE_SEED.map((price) => (price.planId === "pro" ? { ...price, priceCents: 4500, directFeeBps: 25 } : price)),
      { ...PLAN_PRICE_SEED[1]!, interval: "year", priceCents: 12_000, stripeLookupKey: "starter_year_eur_v1" },
    ];
    const { plans } = (await (await GET()).json()) as { plans: { id: string; monthlyPriceCents: number }[] };
    expect(plans.find((plan) => plan.id === "pro")).toEqual({ id: "pro", monthlyPriceCents: 4500, directFeeBps: 25 });
    expect(plans.find((plan) => plan.id === "starter")?.monthlyPriceCents).toBe(1200);
  });

  it("may be cached, and read from another origin", async () => {
    const response = await GET();
    expect(response.headers.get("cache-control")).toMatch(/public, max-age=\d+, s-maxage=\d+/);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("answers 503, uncached, when the prices cannot be read", async () => {
    state.prices = null;
    const response = await GET();
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "The price list is unavailable right now." });
  });
});

// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  APPLICATION_FEE_CAP_BPS,
  FEATURE_KEYS,
  FEE_ENTRY_KINDS,
  SALE_ORIGINS,
  activePlanPrices,
  cheapestPlanFor,
  computeFees,
  feeCents,
  findPlanPrice,
  getActivePlanPrice,
  isDirectOrigin,
  monthlyCostOf,
  planPriceSchema,
  refundedFeeCents,
  splitFeeRefund,
  type ComputeFeesInput,
  type PlanId,
  type PlanPrice,
  type SaleOrigin,
} from "@/lib/pricing";
import { PLAN_PRICE_SEED } from "@/lib/billing/pricing-seed";

const priceOf = (plan: PlanId): PlanPrice => {
  const price = findPlanPrice(PLAN_PRICE_SEED, plan);
  if (!price) throw new Error(`no seeded price for ${plan}`);
  return price;
};

const fees = (
  plan: PlanId,
  origin: SaleOrigin,
  over: Partial<Pick<ComputeFeesInput, "amountCents" | "promotion" | "feeWaiver">> = {},
) =>
  computeFees({
    amountCents: 2500,
    planPrice: priceOf(plan),
    origin,
    promotion: null,
    feeWaiver: false,
    ...over,
  });

describe("the worked examples (a EUR 25.00 order)", () => {
  // The build plan's table, row for row: platform fee, ad fee, application fee.
  const cases: [string, PlanId, SaleOrigin, number | null, number, number, number][] = [
    ["Direct, Free", "free", "embed", null, 125, 0, 125],
    ["Direct, Starter", "starter", "purchase_button", null, 50, 0, 50],
    ["Direct, Pro (12.5 rounds up)", "pro", "hosted_storefront", null, 13, 0, 13],
    ["Marketplace, Free", "free", "marketplace", null, 200, 0, 200],
    ["Marketplace, Starter", "starter", "marketplace", null, 175, 0, 175],
    ["Marketplace promoted, Free, ad 1000 bps", "free", "marketplace", 1000, 200, 250, 450],
    ["Marketplace promoted, Pro, ad 1000 bps", "pro", "marketplace", 1000, 150, 250, 400],
  ];

  it.each(cases)("%s", (_name, plan, origin, adRateBps, platformFee, adFee, applicationFee) => {
    const result = fees(plan, origin, { promotion: adRateBps === null ? null : { adRateBps } });
    expect(result).toMatchObject({
      platformFeeCents: platformFee,
      adFeeCents: adFee,
      applicationFeeCents: applicationFee,
      adRateBps,
      capped: false,
    });
  });

  it("charges every direct origin the same plan fee", () => {
    for (const origin of SALE_ORIGINS.filter(isDirectOrigin)) {
      expect(fees("free", origin)).toMatchObject({ platformFeeBps: 500, platformFeeCents: 125 });
    }
  });

  it("charges a waived seller nothing, whatever the case", () => {
    for (const origin of SALE_ORIGINS) {
      for (const plan of ["free", "starter", "pro"] as const) {
        expect(fees(plan, origin, { feeWaiver: true, promotion: { adRateBps: 2000 } })).toEqual({
          platformFeeBps: 0,
          platformFeeCents: 0,
          adRateBps: null,
          adFeeCents: 0,
          applicationFeeCents: 0,
          capped: false,
        });
      }
    }
  });
});

describe("computeFees", () => {
  it("never charges a direct sale an ad fee, even when handed a promotion", () => {
    expect(fees("free", "embed", { promotion: { adRateBps: 2000 } })).toMatchObject({
      adRateBps: null,
      adFeeCents: 0,
      applicationFeeCents: 125,
    });
  });

  it("rounds half up to the cent, down to nothing on a one-cent order", () => {
    // 5% of 1 cent is 0.05 cents.
    expect(fees("free", "embed", { amountCents: 1 })).toMatchObject({ platformFeeCents: 0, applicationFeeCents: 0 });
    // 5% of 10 cents is exactly half a cent: up.
    expect(fees("free", "embed", { amountCents: 10 }).platformFeeCents).toBe(1);
    // 5% of 9 cents is 0.45: down.
    expect(fees("free", "embed", { amountCents: 9 }).platformFeeCents).toBe(0);
    // 8% of 1 cent rounds to nothing, and so does the cap.
    expect(fees("free", "marketplace", { amountCents: 1, promotion: { adRateBps: 2000 } }).applicationFeeCents).toBe(0);
  });

  it("caps the application fee at 30% of the amount, the ad fee giving way first", () => {
    const rates = { directFeeBps: 500, marketplaceFeeBps: 2000 };
    const capped = computeFees({
      amountCents: 2500,
      planPrice: rates,
      origin: "marketplace",
      promotion: { adRateBps: 2000 },
      feeWaiver: false,
    });
    // 20% + 20% would be 1000; the cap is 750.
    expect(capped).toEqual({
      platformFeeBps: 2000,
      platformFeeCents: 500,
      adRateBps: 2000,
      adFeeCents: 250,
      applicationFeeCents: 750,
      capped: true,
    });
    expect(capped.platformFeeCents + capped.adFeeCents).toBe(capped.applicationFeeCents);
    expect(APPLICATION_FEE_CAP_BPS).toBe(3000);
  });

  it("holds the platform fee itself to the cap", () => {
    const capped = computeFees({
      amountCents: 1000,
      planPrice: { directFeeBps: 4000, marketplaceFeeBps: 4000 },
      origin: "embed",
      promotion: null,
      feeWaiver: false,
    });
    expect(capped).toMatchObject({ platformFeeCents: 300, adFeeCents: 0, applicationFeeCents: 300, capped: true });
  });

  it("rounds the cap down: a cap that rounds up is not a cap", () => {
    // 30% of 5 cents is 1.5: the cap is 1, though both fees round to 1 each.
    const capped = computeFees({
      amountCents: 5,
      planPrice: { directFeeBps: 0, marketplaceFeeBps: 2000 },
      origin: "marketplace",
      promotion: { adRateBps: 2000 },
      feeWaiver: false,
    });
    expect(capped).toMatchObject({ platformFeeCents: 1, adFeeCents: 0, applicationFeeCents: 1, capped: true });
  });

  it("throws on an amount that is not a sale", () => {
    expect(() => fees("free", "embed", { amountCents: 0 })).toThrow();
    expect(() => fees("free", "embed", { amountCents: -100 })).toThrow();
    expect(() => fees("free", "embed", { amountCents: 12.5 })).toThrow();
  });

  it("refuses an origin nobody defined", () => {
    expect(() => fees("free", "affiliate" as SaleOrigin)).toThrow();
    expect(() => fees("free", "direct" as SaleOrigin)).toThrow();
  });

  it("refuses a rate out of range and a field it does not know", () => {
    const base = { amountCents: 2500, origin: "embed", promotion: null, feeWaiver: false } as const;
    expect(() => computeFees({ ...base, planPrice: { directFeeBps: 10_001, marketplaceFeeBps: 0 } })).toThrow();
    expect(() => computeFees({ ...base, planPrice: { directFeeBps: 2.5, marketplaceFeeBps: 0 } })).toThrow();
    expect(() => computeFees({ ...base, origin: "marketplace", planPrice: priceOf("free"), promotion: { adRateBps: 0 } })).toThrow();
    // A fee, a plan or an origin a client slipped in beside the real fields.
    expect(() =>
      computeFees({ ...base, planPrice: priceOf("free"), applicationFeeCents: 0 } as unknown as ComputeFeesInput),
    ).toThrow();
  });
});

describe("feeCents", () => {
  it("is never negative and never more than the amount", () => {
    expect(feeCents(1000, 0)).toBe(0);
    expect(feeCents(-50, 300)).toBe(0);
    expect(feeCents(1000, 20_000)).toBe(1000);
    expect(feeCents(1000, -5)).toBe(0);
  });

  it("stays exact on large amounts (integer maths, no float drift)", () => {
    expect(feeCents(99_999_999, 100)).toBe(1_000_000);
    expect(feeCents(2_147_483_647, 50)).toBe(10_737_418);
  });
});

describe("refunds", () => {
  it("returns the whole fee on a full refund", () => {
    expect(refundedFeeCents(125, 2500, 2500)).toBe(125);
    expect(refundedFeeCents(13, 2500, 2500)).toBe(13);
  });

  it("returns the same share of the fee as of the payment", () => {
    expect(refundedFeeCents(125, 2500, 1250)).toBe(63); // half of 125 is 62.5: up
    expect(refundedFeeCents(125, 2500, 1000)).toBe(50);
    expect(refundedFeeCents(450, 2500, 500)).toBe(90);
    expect(refundedFeeCents(125, 2500, 0)).toBe(0);
  });

  it("never returns more than was charged", () => {
    expect(refundedFeeCents(125, 2500, 9999)).toBe(125);
    expect(refundedFeeCents(0, 2500, 2500)).toBe(0);
  });

  it("stays exact where a double would not", () => {
    expect(refundedFeeCents(2_000_000_000, 2_147_483_647, 2_147_483_646)).toBe(1_999_999_999);
  });

  it("splits a fee refund between the platform fee and the ad fee as charged", () => {
    const charged = { platformFeeCents: 200, adFeeCents: 250 };
    expect(splitFeeRefund(450, charged)).toEqual({ platformFeeCents: 200, adFeeCents: 250 });
    expect(splitFeeRefund(90, charged)).toEqual({ platformFeeCents: 40, adFeeCents: 50 });
    expect(splitFeeRefund(1, charged)).toEqual({ platformFeeCents: 0, adFeeCents: 1 });
    expect(splitFeeRefund(999, charged)).toEqual({ platformFeeCents: 200, adFeeCents: 250 });
    expect(splitFeeRefund(63, { platformFeeCents: 125, adFeeCents: 0 })).toEqual({ platformFeeCents: 63, adFeeCents: 0 });
    expect(splitFeeRefund(0, charged)).toEqual({ platformFeeCents: 0, adFeeCents: 0 });
  });
});

describe("plan prices", () => {
  const at = new Date("2026-11-01T00:00:00Z");
  const row = (over: Partial<PlanPrice>): PlanPrice => ({ ...priceOf("starter"), ...over });

  it("seeds option A: Free 5%, Starter EUR 12 + 2%, Pro EUR 39 + 0.5%", () => {
    expect(PLAN_PRICE_SEED.map((p) => [p.planId, p.priceCents, p.directFeeBps, p.marketplaceFeeBps])).toEqual([
      ["free", 0, 500, 800],
      ["starter", 1200, 200, 700],
      ["pro", 3900, 50, 600],
    ]);
    for (const price of PLAN_PRICE_SEED) expect(planPriceSchema.safeParse(price).success).toBe(true);
  });

  it("picks the row in force, never an ended or a future one", () => {
    const ended = row({ version: 1, priceCents: 1500, effectiveTo: "2026-10-20T00:00:00+00:00" });
    const current = row({ version: 2, priceCents: 1200, effectiveFrom: "2026-10-20T00:00:00+00:00" });
    const future = row({
      version: 3,
      priceCents: 900,
      effectiveFrom: "2027-01-01T00:00:00+00:00",
    });
    const prices = [ended, current, future];
    expect(getActivePlanPrice(prices, "starter", at)?.version).toBe(2);
    // The moment a row ends, the next one is the price.
    expect(getActivePlanPrice(prices, "starter", new Date("2026-10-20T00:00:00Z"))?.version).toBe(2);
    expect(getActivePlanPrice(prices, "starter", new Date("2026-10-19T23:59:59Z"))?.version).toBe(1);
    expect(getActivePlanPrice(prices, "starter", new Date("2020-01-01T00:00:00Z"))).toBeNull();
    expect(getActivePlanPrice(prices, "pro", at)).toBeNull();
    expect(activePlanPrices(prices, at)).toEqual([current]);
  });

  it("falls back to the monthly row for an interval the plan is not sold on", () => {
    expect(getActivePlanPrice(PLAN_PRICE_SEED, "pro", at, "year")?.interval).toBe("month");
    const yearly = row({ interval: "year", priceCents: 12_000, stripeLookupKey: "starter_year_eur_v1" });
    expect(findPlanPrice([...PLAN_PRICE_SEED, yearly], "starter", "year")).toEqual(yearly);
    expect(monthlyCostOf(yearly, 0)).toBe(1000);
  });

  it("names the cheapest plan in total, the cheaper subscription winning a tie", () => {
    expect(cheapestPlanFor(PLAN_PRICE_SEED, 0)).toBe("free");
    // Starter pays for itself at EUR 400 a month: 12 / (5% - 2%). A tie is Free's.
    expect(cheapestPlanFor(PLAN_PRICE_SEED, 40_000)).toBe("free");
    expect(cheapestPlanFor(PLAN_PRICE_SEED, 40_100)).toBe("starter");
    // Pro passes Starter at EUR 1 800: 27 / (2% - 0.5%).
    expect(cheapestPlanFor(PLAN_PRICE_SEED, 180_000)).toBe("starter");
    expect(cheapestPlanFor(PLAN_PRICE_SEED, 180_100)).toBe("pro");
    expect(cheapestPlanFor([], 1000)).toBeNull();
  });
});

describe("the vocabulary", () => {
  it("is the build plan's, word for word", () => {
    expect(SALE_ORIGINS).toEqual(["embed", "purchase_button", "hosted_storefront", "marketplace"]);
    expect(FEE_ENTRY_KINDS).toEqual(["platform_fee", "ad_fee", "platform_fee_refund", "ad_fee_refund"]);
    expect(FEATURE_KEYS).toEqual([
      "freeform_editor",
      "custom_fonts",
      "remove_badge",
      "discount_codes",
      "multiple_storefronts",
      "analytics",
      "priority_support",
    ]);
  });
});

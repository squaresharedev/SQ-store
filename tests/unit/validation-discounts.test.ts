import { describe, expect, it } from "vitest";
import { discountInputSchema } from "@/lib/validation/discounts";
import { discountCheckSchema, placeOrderSchema } from "@/lib/validation/checkout";

// The write boundary for a discount, and the two checkout fields that carry
// one. Every bound mirrors a CHECK in 20261004_discounts.sql.

const PRODUCT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const code = {
  kind: "code",
  value: { type: "percent", percentOff: 10 },
  appliesTo: "all",
  productIds: [],
  startsAt: null,
  endsAt: null,
  code: "summer10",
  shareChannel: "Instagram",
  usageLimit: null,
  enabled: true,
};

const sale = {
  kind: "automatic",
  value: { type: "amount", amountOffCents: 500, currency: "EUR" },
  appliesTo: "products",
  productIds: [PRODUCT],
  startsAt: "2026-10-10T08:00:00.000Z",
  endsAt: "2026-10-17T22:00:00.000Z",
};

const issueOf = (input: unknown) => {
  const parsed = discountInputSchema.safeParse(input);
  return parsed.success ? null : parsed.error.issues[0]?.message;
};

describe("discountInputSchema", () => {
  it("accepts a code and folds it to upper case", () => {
    const parsed = discountInputSchema.parse(code);
    expect(parsed.kind === "code" && parsed.code).toBe("SUMMER10");
  });

  it("accepts a scheduled sale on chosen products", () => {
    expect(discountInputSchema.safeParse(sale).success).toBe(true);
  });

  it("holds the percent to 1..90 whole numbers", () => {
    for (const percentOff of [0, 91, 100, 12.5]) {
      expect(discountInputSchema.safeParse({ ...code, value: { type: "percent", percentOff } }).success).toBe(false);
    }
    expect(issueOf({ ...code, value: { type: "percent", percentOff: 95 } })).toBe("Validation.int.percentOff.tooBig");
  });

  it("refuses a code in the wrong shape with the code's own message", () => {
    expect(issueOf({ ...code, code: "no spaces" })).toBe("Validation.discountCode.code");
  });

  it("refuses an amount without a known currency, or of nothing", () => {
    expect(discountInputSchema.safeParse({ ...sale, value: { type: "amount", amountOffCents: 500, currency: "GBP" } }).success).toBe(false);
    expect(issueOf({ ...sale, value: { type: "amount", amountOffCents: 0, currency: "EUR" } })).toBe(
      "Validation.int.amountOff.tooSmall",
    );
  });

  it("needs products when it names products, and none when it covers all", () => {
    expect(issueOf({ ...sale, productIds: [] })).toBe("Validation.discount.productsRequired");
    expect(issueOf({ ...code, productIds: [PRODUCT] })).toBe("Validation.discount.productsRequired");
  });

  it("needs the end after the start", () => {
    expect(issueOf({ ...sale, endsAt: "2026-10-10T07:00:00.000Z" })).toBe("Validation.discount.endBeforeStart");
  });

  it("refuses fields that do not belong to the kind, and bare dates", () => {
    expect(discountInputSchema.safeParse({ ...sale, code: "SALE" }).success).toBe(false);
    expect(discountInputSchema.safeParse({ ...sale, startsAt: "2026-10-10" }).success).toBe(false);
    expect(discountInputSchema.safeParse({ ...code, ownerId: PRODUCT }).success).toBe(false);
  });
});

describe("checkout discount fields", () => {
  it("normalises a typed code, and refuses anything that is not one", () => {
    expect(discountCheckSchema.parse({ code: " summer10 " }).code).toBe("SUMMER10");
    expect(discountCheckSchema.safeParse({ code: "'; drop table discounts" }).success).toBe(false);
    expect(discountCheckSchema.safeParse({ code: "SUMMER10", productId: PRODUCT }).success).toBe(false);
  });

  it("lets an order carry a code and the total it showed, both optional", () => {
    const order = {
      attemptId: "5b1c2d3e-0000-4000-8000-00000000abcd",
      optionIds: [],
      quantity: 1,
      email: "buyer@example.test",
      locale: "en",
      supplyConsent: true,
    };
    expect(placeOrderSchema.safeParse(order).success).toBe(true);
    expect(placeOrderSchema.safeParse({ ...order, discountCode: "summer10", expectedTotalCents: 2160 }).success).toBe(true);
    expect(placeOrderSchema.safeParse({ ...order, expectedTotalCents: -1 }).success).toBe(false);
    expect(placeOrderSchema.safeParse({ ...order, discountCents: 500 }).success).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { coveredProducts } from "@/lib/discounts/covered";
import { MIN_PAYABLE_CENTS, priceOfOne, priceOrder, saleUnitPriceCents } from "@/lib/discounts/pricing";
import type { DiscountProductChoice, DiscountView } from "@/types/discount";

// What a discount's row opens to show: the products it covers, and what one
// of each costs under it. The prices come from the checkout's own arithmetic,
// so a seller is never shown a figure a buyer would not be charged.

const MUG = "11111111-1111-4111-8111-111111111111";
const APRON = "22222222-2222-4222-8222-222222222222";
const TICKET = "33333333-3333-4333-8333-333333333333";
const STICKER = "44444444-4444-4444-8444-444444444444";

const CATALOGUE: DiscountProductChoice[] = [
  { id: MUG, title: "Blue mug", priceCents: 2400, currency: "EUR", imageUrl: "/photos/mug.webp" },
  { id: APRON, title: "Linen apron", priceCents: 3800, currency: "EUR" },
  { id: TICKET, title: "Workshop ticket", priceCents: 9500, currency: "USD" },
  { id: STICKER, title: "Sticker", priceCents: MIN_PAYABLE_CENTS, currency: "EUR" },
];

type Scoped = Pick<DiscountView, "kind" | "value" | "appliesTo" | "productIds">;
const percent = (percentOff: number) => ({ type: "percent" as const, percentOff });
const euros = (amountOffCents: number) => ({ type: "amount" as const, amountOffCents, currency: "EUR" as const });
const sale = (patch: Partial<Scoped> = {}): Scoped => ({
  kind: "automatic",
  value: percent(20),
  appliesTo: "all",
  productIds: [],
  ...patch,
});
const code = (patch: Partial<Scoped> = {}): Scoped => sale({ kind: "code", ...patch });

const priceOf = (covered: ReturnType<typeof coveredProducts>, id: string) =>
  covered.find((product) => product.id === id)?.nowCents;

describe("what one of a product costs under a discount", () => {
  it("is the sale's price for the item", () => {
    expect(priceOfOne("automatic", percent(20), 2400, "EUR")).toBe(1920);
    expect(priceOfOne("automatic", percent(20), 2400, "EUR")).toBe(saleUnitPriceCents(percent(20), 2400, "EUR"));
  });

  it("is what an order of just that item costs with the code", () => {
    expect(priceOfOne("code", euros(500), 2400, "EUR")).toBe(1900);
    expect(priceOfOne("code", euros(500), 2400, "EUR")).toBe(
      priceOrder({ regularUnitCents: 2400, currency: "EUR", quantity: 1, saleUnitCents: null, code: euros(500) })
        .itemsCents,
    );
  });

  it("is the regular price where the discount does not reach", () => {
    // An amount in another currency, and a price already at the floor.
    expect(priceOfOne("code", euros(500), 9500, "USD")).toBe(9500);
    expect(priceOfOne("automatic", percent(90), MIN_PAYABLE_CENTS, "EUR")).toBe(MIN_PAYABLE_CENTS);
  });
});

describe("the products a discount covers", () => {
  it("is the whole catalogue for a discount on all products, in the order given", () => {
    const covered = coveredProducts(sale(), CATALOGUE);
    expect(covered.map((product) => product.title)).toEqual([
      "Blue mug",
      "Linen apron",
      "Workshop ticket",
      "Sticker",
    ]);
    expect(covered[0]).toEqual({
      id: MUG,
      title: "Blue mug",
      currency: "EUR",
      regularCents: 2400,
      nowCents: 1920,
      imageUrl: "/photos/mug.webp",
    });
    // A product with no photo says so plainly, rather than carrying undefined.
    expect(covered[1].imageUrl).toBeNull();
    // A percentage applies whatever the currency.
    expect(priceOf(covered, TICKET)).toBe(7600);
  });

  it("is only the named products for a discount on specific ones", () => {
    const covered = coveredProducts(sale({ appliesTo: "products", productIds: [APRON, MUG] }), CATALOGUE);
    // The catalogue's order, not the order the discount lists them in.
    expect(covered.map((product) => product.id)).toEqual([MUG, APRON]);
  });

  it("leaves out a named product the store no longer has", () => {
    const gone = "99999999-9999-4999-8999-999999999999";
    const covered = coveredProducts(sale({ appliesTo: "products", productIds: [gone, APRON] }), CATALOGUE);
    expect(covered.map((product) => product.id)).toEqual([APRON]);
    // And names nothing when every product it named is gone, or it named none.
    expect(coveredProducts(sale({ appliesTo: "products", productIds: [gone] }), CATALOGUE)).toEqual([]);
    expect(coveredProducts(sale({ appliesTo: "products", productIds: [] }), CATALOGUE)).toEqual([]);
  });

  it("still lists a product in scope that the discount cannot lower, at its regular price", () => {
    const covered = coveredProducts(code({ value: euros(500) }), CATALOGUE);
    expect(priceOf(covered, MUG)).toBe(1900);
    // Priced in dollars: an amount in euro does not apply.
    expect(covered.find((product) => product.id === TICKET)).toMatchObject({ regularCents: 9500, nowCents: 9500 });
    // Already the smallest amount a card can be charged.
    expect(covered.find((product) => product.id === STICKER)).toMatchObject({
      regularCents: MIN_PAYABLE_CENTS,
      nowCents: MIN_PAYABLE_CENTS,
    });
  });

  it("never prices anything below the smallest payable amount, nor above its regular price", () => {
    for (const discount of [sale({ value: percent(90) }), code({ value: euros(100_000) }), code({ value: percent(1) })]) {
      for (const product of coveredProducts(discount, CATALOGUE)) {
        expect(product.nowCents).toBeGreaterThanOrEqual(MIN_PAYABLE_CENTS);
        expect(product.nowCents).toBeLessThanOrEqual(product.regularCents);
      }
    }
  });

  it("has nothing to list for an empty catalogue", () => {
    expect(coveredProducts(sale(), [])).toEqual([]);
  });
});

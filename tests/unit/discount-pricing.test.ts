import { describe, expect, it } from "vitest";
import {
  MIN_PAYABLE_CENTS,
  bestSale,
  priceOrder,
  reductionCents,
  saleUnitPriceCents,
} from "@/lib/discounts/pricing";
import { DISCOUNT_AMOUNT_MAX_CENTS } from "@/types/discount";
import { PRICE_CENTS_MAX } from "@/lib/validation/product";

// The arithmetic the server's quote and the checkout's preview share. If these
// two ever disagreed, a buyer would be shown one total and charged another.

const percent = (percentOff: number) => ({ type: "percent" as const, percentOff });
const euros = (amountOffCents: number) => ({ type: "amount" as const, amountOffCents, currency: "EUR" as const });

describe("reductionCents", () => {
  it("rounds a percentage DOWN, so the price never ends up lower than promised", () => {
    expect(reductionCents(percent(20), 1999, "EUR")).toBe(399);
    expect(reductionCents(percent(15), 2400, "EUR")).toBe(360);
  });

  it("takes a fixed amount off whole", () => {
    expect(reductionCents(euros(500), 2400, "EUR")).toBe(500);
  });

  it("never goes below the smallest card payment, and does nothing at or under it", () => {
    expect(reductionCents(euros(5000), 2400, "EUR")).toBe(2400 - MIN_PAYABLE_CENTS);
    expect(reductionCents(percent(90), 60, "EUR")).toBe(10);
    expect(reductionCents(percent(50), MIN_PAYABLE_CENTS, "EUR")).toBe(0);
    expect(reductionCents(euros(100), 30, "EUR")).toBe(0);
  });

  it("does nothing for an amount in another currency", () => {
    expect(reductionCents(euros(500), 2400, "USD")).toBe(0);
  });

  it("caps an amount at the same ceiling as a price", () => {
    expect(DISCOUNT_AMOUNT_MAX_CENTS).toBe(PRICE_CENTS_MAX);
  });
});

describe("bestSale", () => {
  const sale = (id: string, value: ReturnType<typeof percent> | ReturnType<typeof euros>) => ({ id, value });

  it("picks the sale that makes the item cheapest, keeping the first on a tie", () => {
    const sales = [sale("a", percent(10)), sale("b", euros(500)), sale("c", percent(20)), sale("d", euros(480))];
    expect(bestSale(sales, 2400, "EUR")).toEqual({ sale: sales[1], unitPriceCents: 1900 });
    expect(bestSale([sale("x", percent(20)), sale("y", euros(480))], 2400, "EUR")?.sale.id).toBe("x");
  });

  it("is null when nothing lowers the price", () => {
    expect(bestSale([], 2400, "EUR")).toBeNull();
    expect(bestSale([sale("a", euros(500))], 2400, "USD")).toBeNull();
    expect(saleUnitPriceCents(percent(50), 40, "EUR")).toBe(40);
  });
});

describe("priceOrder", () => {
  const base = { regularUnitCents: 2400, currency: "EUR" as const, quantity: 2 };

  it("charges the regular price without a discount", () => {
    expect(priceOrder({ ...base, saleUnitCents: null, code: null })).toEqual({
      unitPriceCents: 2400,
      subtotalCents: 4800,
      codeDiscountCents: 0,
      itemsCents: 4800,
      discountCents: 0,
      applied: null,
      codeOutdone: false,
    });
  });

  it("prices a sale per item", () => {
    expect(priceOrder({ ...base, saleUnitCents: 1800, code: null })).toMatchObject({
      unitPriceCents: 1800,
      itemsCents: 3600,
      discountCents: 1200,
      applied: "sale",
    });
  });

  it("takes a code off the order once, from the regular price", () => {
    expect(priceOrder({ ...base, saleUnitCents: null, code: euros(500) })).toMatchObject({
      unitPriceCents: 2400,
      subtotalCents: 4800,
      codeDiscountCents: 500,
      itemsCents: 4300,
      discountCents: 500,
      applied: "code",
    });
  });

  it("gives the buyer whichever is better, and the sale on a tie", () => {
    // 10% sale: 4320. 15% code: 4080. The code wins.
    expect(priceOrder({ ...base, saleUnitCents: 2160, code: percent(15) }).applied).toBe("code");
    // 25% sale: 3600. 15% code: 4080. The sale stays, and the code is outdone.
    expect(priceOrder({ ...base, saleUnitCents: 1800, code: percent(15) })).toMatchObject({
      applied: "sale",
      codeOutdone: true,
      itemsCents: 3600,
    });
    // Equal: the sale stays.
    expect(priceOrder({ ...base, saleUnitCents: 1800, code: euros(1200) }).applied).toBe("sale");
  });

  it("ignores a 'sale' that is not lower than the regular price", () => {
    expect(priceOrder({ ...base, saleUnitCents: 2400, code: null }).applied).toBeNull();
  });
});

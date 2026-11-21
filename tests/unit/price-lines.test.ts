/**
 * priceLines: one price function for an order of any number of lines.
 *
 * Pinned here:
 *   - For one line it is EXACTLY the rule the checkout charged before carts
 *     (an independent copy of that rule below, swept over random orders), so
 *     "Buy now" did not change.
 *   - A code competes with the sales of the lines it covers as one block, and
 *     never touches a line it does not cover.
 *   - An amount off comes off once and its parts add up to it exactly; no line
 *     ever pays below zero or more than its regular price; the items never go
 *     below the smallest card payment.
 *   - allocateCents splits exactly, stably, and never gives a part more than
 *     its weight.
 */
import { describe, expect, it } from "vitest";
import { MIN_PAYABLE_CENTS, allocateCents, priceLines, reductionCents } from "@/lib/discounts/pricing";
import { seededRandom } from "../setup/fake-admin";
import type { DiscountValue } from "@/types/discount";

/** The one-product rule as it was written before carts, kept here as an oracle. */
function oracleOne(input: {
  regular: number;
  quantity: number;
  sale: number | null;
  code: DiscountValue | null;
}): { amount: number; applied: "sale" | "code" | null } {
  const regularSubtotal = input.regular * input.quantity;
  const saleUnit = input.sale !== null && input.sale < input.regular ? input.sale : null;
  const saleSubtotal = saleUnit === null ? null : saleUnit * input.quantity;
  const codeOff = input.code ? reductionCents(input.code, regularSubtotal, "EUR") : 0;
  if (codeOff > 0 && (saleSubtotal === null || regularSubtotal - codeOff < saleSubtotal)) {
    return { amount: regularSubtotal - codeOff, applied: "code" };
  }
  if (saleSubtotal !== null) return { amount: saleSubtotal, applied: "sale" };
  return { amount: regularSubtotal, applied: null };
}

function randomCode(random: () => number): DiscountValue | null {
  const pick = random();
  if (pick < 0.3) return null;
  if (pick < 0.65) return { type: "percent", percentOff: 1 + Math.floor(random() * 90) };
  return {
    type: "amount",
    amountOffCents: 1 + Math.floor(random() * 20_000),
    currency: random() < 0.85 ? "EUR" : "USD",
  };
}

describe("priceLines for one line", () => {
  it("charges exactly what the one-product rule charged, over 5,000 random orders", () => {
    const random = seededRandom(1120).next;
    for (let n = 0; n < 5000; n++) {
      const regular = 50 + Math.floor(random() * 50_000);
      const quantity = 1 + Math.floor(random() * 10);
      const sale = random() < 0.5 ? Math.max(50, Math.floor(regular * random())) : null;
      const code = randomCode(random);
      const priced = priceLines({
        currency: "EUR",
        code,
        lines: [{ regularUnitCents: regular, saleUnitCents: sale, quantity, coveredByCode: true }],
      });
      const truth = oracleOne({ regular, quantity, sale, code });
      expect(priced.lines[0]!.amountCents, `order ${n}`).toBe(truth.amount);
      expect(priced.lines[0]!.applied, `order ${n}`).toBe(truth.applied);
      expect(priced.itemsCents).toBe(truth.amount);
    }
  });
});

describe("priceLines for many lines", () => {
  it("leaves a line the code does not cover on its own sale", () => {
    const priced = priceLines({
      currency: "EUR",
      code: { type: "percent", percentOff: 50 },
      lines: [
        { regularUnitCents: 1000, saleUnitCents: null, quantity: 1, coveredByCode: true },
        { regularUnitCents: 1000, saleUnitCents: 800, quantity: 2, coveredByCode: false },
      ],
    });
    expect(priced.lines.map((line) => [line.amountCents, line.applied])).toEqual([
      [500, "code"],
      [1600, "sale"],
    ]);
    expect(priced.codeCents).toBe(500);
  });

  it("keeps the sales when they beat the code over the covered lines, and says the code was outdone", () => {
    const priced = priceLines({
      currency: "EUR",
      code: { type: "percent", percentOff: 10 },
      lines: [
        { regularUnitCents: 1000, saleUnitCents: 700, quantity: 1, coveredByCode: true },
        { regularUnitCents: 1000, saleUnitCents: null, quantity: 1, coveredByCode: true },
      ],
    });
    // Sales: 7.00 + 10.00 = 17.00. Code: 20.00 - 2.00 = 18.00. Sales win.
    expect(priced.itemsCents).toBe(1700);
    expect(priced.codeCents).toBe(0);
    expect(priced.codeOutdone).toBe(true);
  });

  it("holds the arithmetic over 5,000 random carts", () => {
    const random = seededRandom(2011).next;
    for (let n = 0; n < 5000; n++) {
      const lines = Array.from({ length: 1 + Math.floor(random() * 20) }, () => {
        const regular = 50 + Math.floor(random() * 30_000);
        return {
          regularUnitCents: regular,
          saleUnitCents: random() < 0.4 ? Math.max(50, Math.floor(regular * random())) : null,
          quantity: 1 + Math.floor(random() * 5),
          coveredByCode: random() < 0.6,
        };
      });
      const code = randomCode(random);
      const priced = priceLines({ currency: "EUR", code, lines });
      const sum = priced.lines.reduce((total, line) => total + line.amountCents, 0);
      expect(sum, `cart ${n}: lines add up`).toBe(priced.itemsCents);
      expect(priced.lines.reduce((total, line) => total + line.codeCents, 0), `cart ${n}: code parts`).toBe(
        priced.codeCents,
      );
      priced.lines.forEach((line, index) => {
        const regular = lines[index]!.regularUnitCents * lines[index]!.quantity;
        expect(line.amountCents, `cart ${n} line ${index}`).toBeGreaterThanOrEqual(0);
        expect(line.amountCents, `cart ${n} line ${index}`).toBeLessThanOrEqual(regular);
        expect(line.discountCents).toBe(regular - line.amountCents);
        if (!lines[index]!.coveredByCode || !code) expect(line.codeCents).toBe(0);
      });
      // The code never takes the items it covers below the smallest card payment.
      if (priced.codeCents > 0) {
        const covered = priced.lines.filter((_, index) => lines[index]!.coveredByCode);
        expect(covered.reduce((total, line) => total + line.amountCents, 0)).toBeGreaterThanOrEqual(MIN_PAYABLE_CENTS);
      }
      // Never more than the cheaper of "sales only" and "code over the covered lines".
      const salesOnly = lines.reduce(
        (total, line) =>
          total +
          (line.saleUnitCents !== null && line.saleUnitCents < line.regularUnitCents ? line.saleUnitCents : line.regularUnitCents) *
            line.quantity,
        0,
      );
      expect(priced.itemsCents, `cart ${n}: never above the sales`).toBeLessThanOrEqual(salesOnly);
    }
    // 5,000 carts of up to 20 lines: seconds under a loaded machine.
  }, 60_000);
});

describe("allocateCents", () => {
  it("splits exactly, in proportion, with the leftover cents to the largest remainders", () => {
    expect(allocateCents(1000, [2400, 1200])).toEqual([667, 333]);
    expect(allocateCents(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocateCents(0, [5, 5])).toEqual([0, 0]);
    expect(allocateCents(10, [0, 0])).toEqual([0, 0]);
    // A zero weight never takes a cent.
    expect(allocateCents(7, [0, 3, 4])).toEqual([0, 3, 4]);
  });

  it("is exact for amounts too large for a double's products", () => {
    const parts = allocateCents(999_999_999, [9_007_199_254, 1_000_000_000_000, 77]);
    expect(parts.reduce((total, part) => total + part, 0)).toBe(999_999_999);
  });

  it("never gives a part more than its weight while the total fits", () => {
    const random = seededRandom(7).next;
    for (let n = 0; n < 2000; n++) {
      const weights = Array.from({ length: 1 + Math.floor(random() * 20) }, () => Math.floor(random() * 100_000));
      const sum = weights.reduce((total, weight) => total + weight, 0);
      const total = Math.floor(random() * (sum + 1));
      const parts = allocateCents(total, weights);
      expect(parts.reduce((acc, part) => acc + part, 0)).toBe(sum > 0 ? total : 0);
      parts.forEach((part, index) => expect(part).toBeLessThanOrEqual(weights[index]!));
    }
  });
});

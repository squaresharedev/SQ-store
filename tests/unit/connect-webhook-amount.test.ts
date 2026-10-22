// @vitest-environment node
// A completed Connect checkout confirms its order only when it took exactly
// what the order was quoted (security review 2026-10-21): a seller's own
// Stripe account can complete a session it made itself that names the order.
import { describe, expect, it } from "vitest";
import { paidAsQuoted } from "@/lib/payments/connect/webhook";

const order = { amount_cents: 4999, currency: "EUR" };

describe("paidAsQuoted", () => {
  it("accepts the quoted amount in the quoted currency, whatever its case", () => {
    expect(paidAsQuoted({ amount_total: 4999, currency: "eur" }, order)).toBe(true);
    expect(paidAsQuoted({ amount_total: 4999, currency: "EUR" }, order)).toBe(true);
  });

  it("refuses less, more, another currency, or a session that does not say", () => {
    expect(paidAsQuoted({ amount_total: 1, currency: "eur" }, order)).toBe(false);
    expect(paidAsQuoted({ amount_total: 5000, currency: "eur" }, order)).toBe(false);
    expect(paidAsQuoted({ amount_total: 4999, currency: "czk" }, order)).toBe(false);
    expect(paidAsQuoted({ currency: "eur" }, order)).toBe(false);
    expect(paidAsQuoted({ amount_total: "4999", currency: "eur" }, order)).toBe(false);
    expect(paidAsQuoted({ amount_total: 4999 }, order)).toBe(false);
  });
});

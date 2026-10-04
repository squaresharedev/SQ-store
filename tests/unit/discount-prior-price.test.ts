import { describe, expect, it } from "vitest";
import { priorPriceCents, saleAnnouncement } from "@/lib/discounts/prior-price";

// The EU rule (Price Indication Directive art. 6a): a sale may only show, as
// its "was" price, the lowest price of the 30 days before it started. Every
// case here is one where getting it wrong would announce a reduction the law
// does not allow.

const START = "2026-10-01T00:00:00.000Z";
const day = (offset: number) => new Date(Date.parse(START) + offset * 24 * 60 * 60 * 1000).toISOString();
const point = (offset: number, priceCents: number, currency = "EUR") => ({ priceCents, currency, validFrom: day(offset) });
const percent = (percentOff: number) => ({ type: "percent" as const, percentOff });

function prior(history: ReturnType<typeof point>[], otherSales: Parameters<typeof priorPriceCents>[0]["otherSales"] = []) {
  return priorPriceCents({ history, otherSales, saleStart: START, currency: "EUR" });
}

describe("priorPriceCents", () => {
  it("is the steady price when nothing changed for 30 days", () => {
    expect(prior([point(-90, 2400)])).toBe(2400);
  });

  it("is the LOWEST price inside the window, not the latest", () => {
    // Cheaper ten days ago, then raised just before the sale: the classic
    // "raise, then discount" the rule exists to stop.
    expect(prior([point(-90, 2000), point(-3, 2400)])).toBe(2000);
  });

  it("forgets prices older than the window", () => {
    expect(prior([point(-90, 1500), point(-40, 2400)])).toBe(2400);
  });

  it("counts another sale that ran inside the window", () => {
    expect(
      prior([point(-90, 2400)], [{ value: percent(25), startsAt: day(-20), endsAt: day(-10) }]),
    ).toBe(1800);
  });

  it("counts a sale that started before the window and ran into it", () => {
    expect(
      prior([point(-90, 2400)], [{ value: percent(10), startsAt: day(-45), endsAt: day(-25) }]),
    ).toBe(2160);
  });

  it("ignores a sale that ended before the window", () => {
    expect(
      prior([point(-90, 2400)], [{ value: percent(50), startsAt: day(-60), endsAt: day(-31) }]),
    ).toBe(2400);
  });

  it("is null when the history does not reach back 30 days", () => {
    expect(prior([point(-12, 2400)])).toBeNull();
    expect(prior([])).toBeNull();
  });

  it("is null when the currency changed inside the window", () => {
    expect(prior([point(-90, 2400), point(-5, 2600, "USD")])).toBeNull();
  });

  it("ignores history after the sale started", () => {
    expect(prior([point(-90, 2400), point(2, 900)])).toBe(2400);
  });
});

describe("saleAnnouncement", () => {
  it("announces against the prior price, rounding the percent down", () => {
    expect(saleAnnouncement(2400, 1919)).toEqual({ priorPriceCents: 2400, percentOff: 20 });
  });

  it("announces nothing when the prior price is unknown or not higher", () => {
    expect(saleAnnouncement(null, 1900)).toEqual({ priorPriceCents: null, percentOff: null });
    expect(saleAnnouncement(1800, 1900)).toEqual({ priorPriceCents: null, percentOff: null });
    expect(saleAnnouncement(1900, 1900)).toEqual({ priorPriceCents: null, percentOff: null });
  });

  it("shows the was-price but no badge below 1%", () => {
    expect(saleAnnouncement(10000, 9950)).toEqual({ priorPriceCents: 10000, percentOff: null });
  });
});

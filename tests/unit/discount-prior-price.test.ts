import { describe, expect, it } from "vitest";
import { priorPriceCents, saleAnnouncement } from "@/lib/discounts/prior-price";

// The EU rule (Price Indication Directive art. 6a): what a sale says it takes
// off is measured against the lowest price of the 30 days before it started.
// Every case here is one where getting that price wrong would put a percentage
// on a tile that the law does not allow.

const START = "2026-10-01T00:00:00.000Z";
const day = (offset: number) => new Date(Date.parse(START) + offset * 24 * 60 * 60 * 1000).toISOString();
const point = (offset: number, priceCents: number, currency = "EUR") => ({ priceCents, currency, validFrom: day(offset) });
const percent = (percentOff: number) => ({ type: "percent" as const, percentOff });

function prior(
  history: ReturnType<typeof point>[],
  otherSales: Parameters<typeof priorPriceCents>[0]["otherSales"] = [],
  listedAt: string | null = null,
) {
  return priorPriceCents({ history, otherSales, saleStart: START, currency: "EUR", listedAt });
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

  describe("for a product listed less than 30 days before the sale", () => {
    it("is the lowest price it has had since it was listed", () => {
      expect(prior([point(-12, 2400)], [], day(-12))).toBe(2400);
      // Listed at 30.00, dropped to 24.00, raised again: 24.00 was charged.
      expect(prior([point(-12, 3000), point(-8, 2400), point(-2, 2800)], [], day(-12))).toBe(2400);
    });

    it("counts another sale that ran since then", () => {
      expect(
        prior([point(-12, 2400)], [{ value: percent(25), startsAt: day(-6), endsAt: day(-4) }], day(-12)),
      ).toBe(1800);
    });

    it("is null when the records begin after the product did: its first prices are not on file", () => {
      expect(prior([point(-12, 2400)], [], day(-20))).toBeNull();
      // A minute's slack is all the two timestamps are allowed to differ by.
      expect(prior([point(-12, 2400)], [], new Date(Date.parse(day(-12)) - 61_000).toISOString())).toBeNull();
      expect(prior([point(-12, 2400)], [], new Date(Date.parse(day(-12)) - 59_000).toISOString())).toBe(2400);
    });

    it("is null for a product listed after the sale began: it has no earlier price at all", () => {
      expect(prior([point(1, 2400)], [], day(1))).toBeNull();
    });

    it("does not shorten the window of a product that has 30 days on record", () => {
      // Cheaper 20 days ago; a listing date nearer than that changes nothing.
      expect(prior([point(-90, 2000), point(-3, 2400)], [], day(-3))).toBe(2000);
    });

    it("is null when the listing date is not a date", () => {
      expect(prior([point(-12, 2400)], [], "not a date")).toBeNull();
    });
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

  it("claims no percentage when the lowest price is unknown", () => {
    expect(saleAnnouncement(null, 1900)).toEqual({ priorPriceCents: null, percentOff: null });
  });

  it("claims no percentage, but still says the lowest price, when a sale as deep ran in those 30 days", () => {
    // The page crosses the regular price out either way; this is what keeps it
    // honest: no number, and the lower price there to be stated beside it.
    expect(saleAnnouncement(1800, 1900)).toEqual({ priorPriceCents: 1800, percentOff: null });
    expect(saleAnnouncement(1900, 1900)).toEqual({ priorPriceCents: 1900, percentOff: null });
  });

  it("keeps the lowest price but claims no percentage below 1%", () => {
    expect(saleAnnouncement(10000, 9950)).toEqual({ priorPriceCents: 10000, percentOff: null });
  });
});

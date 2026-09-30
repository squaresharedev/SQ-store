import { describe, expect, it } from "vitest";
import {
  canQuoteShipping,
  quoteShipping,
  shippingCountries,
} from "@/lib/shipping/rates";
import type { SellerShippingPolicy } from "@/types/shipping-policy";

/**
 * SHIPPING QUOTE ENGINE. Pure functions, so every interesting case is a unit
 * test rather than a UI fixture.
 *
 * The scenarios here map to the three guarantees the module makes:
 *   1. Currency check gates all quoting.
 *   2. Country matching is exact-then-catch-all, first-match-wins.
 *   3. Profile override replaces the rate; free-over threshold trumps both.
 */

// ── fixtures ───────────────────────────────────────────────────────────────────

const irelandRow = {
  area: "Ireland",
  time: "2-3 days",
  countries: ["IE"],
  rateCents: 450,
};

const euRow = {
  area: "Rest of EU",
  time: "5-7 days",
  countries: ["DE", "FR", "NL"],
  rateCents: 800,
};

const anywhereRow = {
  area: "Worldwide",
  time: "7-14 days",
  countries: ["*"],
  rateCents: 1500,
};

const displayOnlyRow = {
  area: "UK",
  time: "3-5 days",
  cost: "ask us",
  // no rateCents, no countries: display-only
};

const basePolicy: SellerShippingPolicy = {
  ratesCurrency: "EUR",
  destinations: [irelandRow, euRow, anywhereRow],
};

// ── shippingCountries ──────────────────────────────────────────────────────────

describe("shippingCountries", () => {
  it("returns empty when no destinations are priced", () => {
    expect(shippingCountries({})).toEqual({ codes: [], anywhere: false });
    expect(shippingCountries({ destinations: [displayOnlyRow] })).toEqual({
      codes: [],
      anywhere: false,
    });
  });

  it("collects specific ISO codes from priced rows, sorted", () => {
    const { codes, anywhere } = shippingCountries({
      destinations: [irelandRow, euRow],
    });
    expect(codes).toEqual(["DE", "FR", "IE", "NL"]);
    expect(anywhere).toBe(false);
  });

  it("sets anywhere = true when a priced row includes the * catch-all", () => {
    const { codes, anywhere } = shippingCountries({ destinations: [anywhereRow] });
    expect(codes).toEqual([]);
    expect(anywhere).toBe(true);
  });

  it("normalises lowercase codes to uppercase in the output", () => {
    const { codes } = shippingCountries({
      destinations: [{ area: "a", time: "b", countries: ["ie"], rateCents: 100 }],
    });
    expect(codes).toContain("IE");
  });

  it("does NOT include the * sentinel in the codes array", () => {
    const { codes } = shippingCountries({ destinations: [anywhereRow, irelandRow] });
    expect(codes).not.toContain("*");
  });
});

// ── canQuoteShipping ───────────────────────────────────────────────────────────

describe("canQuoteShipping", () => {
  it("returns false when no destinations are priced", () => {
    expect(canQuoteShipping({}, "EUR")).toBe(false);
    expect(canQuoteShipping({ destinations: [displayOnlyRow] }, "EUR")).toBe(false);
  });

  it("returns false on a currency mismatch", () => {
    // basePolicy is EUR; USD does not match
    expect(canQuoteShipping(basePolicy, "USD")).toBe(false);
  });

  it("defaults to EUR when ratesCurrency is absent", () => {
    const policy: SellerShippingPolicy = { destinations: [irelandRow] };
    expect(canQuoteShipping(policy, "EUR")).toBe(true);
    expect(canQuoteShipping(policy, "USD")).toBe(false);
  });

  it("returns true when the currency matches and at least one row is priced", () => {
    expect(canQuoteShipping(basePolicy, "EUR")).toBe(true);
  });
});

// ── quoteShipping ──────────────────────────────────────────────────────────────

describe("quoteShipping", () => {
  // ── no_rates ────────────────────────────────────────────────────────────────
  it("returns no_rates when no rows are priced", () => {
    const result = quoteShipping(
      { destinations: [displayOnlyRow] },
      { profileId: null, country: "IE", subtotalCents: 1000, currency: "EUR" },
    );
    expect(result).toEqual({ ok: false, reason: "no_rates" });
  });

  // ── currency_mismatch ────────────────────────────────────────────────────────
  it("returns currency_mismatch when the currencies differ", () => {
    // basePolicy is EUR; a USD request is a mismatch
    const result = quoteShipping(basePolicy, {
      profileId: null,
      country: "IE",
      subtotalCents: 1000,
      currency: "USD",
    });
    expect(result).toEqual({ ok: false, reason: "currency_mismatch" });
  });

  // ── direct match ─────────────────────────────────────────────────────────────
  it("matches a specific country code", () => {
    const result = quoteShipping(basePolicy, {
      profileId: null,
      country: "IE",
      subtotalCents: 1000,
      currency: "EUR",
    });
    expect(result).toEqual({ ok: true, rateCents: 450, free: false, area: "Ireland" });
  });

  it("falls back to the * row when no specific row matches", () => {
    const result = quoteShipping(basePolicy, {
      profileId: null,
      country: "US",
      subtotalCents: 1000,
      currency: "EUR",
    });
    expect(result).toEqual({ ok: true, rateCents: 1500, free: false, area: "Worldwide" });
  });

  it("returns not_shipped_here when no match and no catch-all", () => {
    const policyNoAnywhere: SellerShippingPolicy = {
      ratesCurrency: "EUR",
      destinations: [irelandRow],
    };
    const result = quoteShipping(policyNoAnywhere, {
      profileId: null,
      country: "US",
      subtotalCents: 1000,
      currency: "EUR",
    });
    expect(result).toEqual({ ok: false, reason: "not_shipped_here" });
  });

  // ── first-match-wins ─────────────────────────────────────────────────────────
  it("uses the first matching row, not the cheapest", () => {
    // Both rows cover IE; only the first should win.
    const policy: SellerShippingPolicy = {
      ratesCurrency: "EUR",
      destinations: [
        { area: "Expensive first", time: "1 day", countries: ["IE"], rateCents: 2000 },
        { area: "Cheap second", time: "5 days", countries: ["IE"], rateCents: 100 },
      ],
    };
    const result = quoteShipping(policy, {
      profileId: null,
      country: "IE",
      subtotalCents: 500,
      currency: "EUR",
    });
    expect(result).toEqual({ ok: true, rateCents: 2000, free: false, area: "Expensive first" });
  });

  it("prefers a specific match over the * catch-all even when * comes first", () => {
    const policy: SellerShippingPolicy = {
      ratesCurrency: "EUR",
      destinations: [anywhereRow, irelandRow],
    };
    const result = quoteShipping(policy, {
      profileId: null,
      country: "IE",
      subtotalCents: 500,
      currency: "EUR",
    });
    expect(result).toEqual({ ok: true, rateCents: 450, free: false, area: "Ireland" });
  });

  // ── display-only rows ignored ────────────────────────────────────────────────
  it("ignores rows without both rateCents and countries", () => {
    const policy: SellerShippingPolicy = {
      ratesCurrency: "EUR",
      destinations: [displayOnlyRow, irelandRow],
    };
    const result = quoteShipping(policy, {
      profileId: null,
      country: "IE",
      subtotalCents: 500,
      currency: "EUR",
    });
    expect(result).toEqual({ ok: true, rateCents: 450, free: false, area: "Ireland" });
  });

  // ── rate 0 is free ───────────────────────────────────────────────────────────
  it("reports free = true when rateCents is 0", () => {
    const policy: SellerShippingPolicy = {
      ratesCurrency: "EUR",
      destinations: [{ area: "Ireland", time: "2 days", countries: ["IE"], rateCents: 0 }],
    };
    const result = quoteShipping(policy, {
      profileId: null,
      country: "IE",
      subtotalCents: 500,
      currency: "EUR",
    });
    expect(result).toEqual({ ok: true, rateCents: 0, free: true, area: "Ireland" });
  });

  // ── freeOverCents threshold ──────────────────────────────────────────────────
  it("applies the free-over threshold when the cart reaches it", () => {
    const policy: SellerShippingPolicy = {
      ratesCurrency: "EUR",
      destinations: [irelandRow],
      freeOverCents: 5000,
    };
    const result = quoteShipping(policy, {
      profileId: null,
      country: "IE",
      subtotalCents: 5000, // exactly at threshold
      currency: "EUR",
    });
    expect(result).toEqual({ ok: true, rateCents: 0, free: true, area: "Ireland" });
  });

  it("does NOT apply free-over when the cart is below the threshold", () => {
    const policy: SellerShippingPolicy = {
      ratesCurrency: "EUR",
      destinations: [irelandRow],
      freeOverCents: 5000,
    };
    const result = quoteShipping(policy, {
      profileId: null,
      country: "IE",
      subtotalCents: 4999,
      currency: "EUR",
    });
    expect(result).toEqual({ ok: true, rateCents: 450, free: false, area: "Ireland" });
  });

  // ── profile override ─────────────────────────────────────────────────────────
  it("replaces the destination rate with the profile rate when matched", () => {
    const policy: SellerShippingPolicy = {
      ratesCurrency: "EUR",
      destinations: [irelandRow],
      profiles: [{ id: "heavy", name: "Heavy items", body: "Bulky shipping.", rateCents: 1200 }],
    };
    const result = quoteShipping(policy, {
      profileId: "heavy",
      country: "IE",
      subtotalCents: 500,
      currency: "EUR",
    });
    expect(result).toEqual({ ok: true, rateCents: 1200, free: false, area: "Ireland" });
  });

  it("falls back to the destination rate when profile has no rateCents", () => {
    const policy: SellerShippingPolicy = {
      ratesCurrency: "EUR",
      destinations: [irelandRow],
      profiles: [{ id: "special", name: "Special", body: "Call us." }],
    };
    const result = quoteShipping(policy, {
      profileId: "special",
      country: "IE",
      subtotalCents: 500,
      currency: "EUR",
    });
    expect(result).toEqual({ ok: true, rateCents: 450, free: false, area: "Ireland" });
  });

  it("ignores an unknown profileId (falls through to destination rate)", () => {
    const result = quoteShipping(basePolicy, {
      profileId: "no-such-id",
      country: "IE",
      subtotalCents: 500,
      currency: "EUR",
    });
    expect(result).toEqual({ ok: true, rateCents: 450, free: false, area: "Ireland" });
  });

  // ── profile override + free-over ─────────────────────────────────────────────
  it("applies free-over threshold on top of a profile override", () => {
    const policy: SellerShippingPolicy = {
      ratesCurrency: "EUR",
      destinations: [irelandRow],
      profiles: [{ id: "heavy", name: "Heavy", body: "Bulky.", rateCents: 1200 }],
      freeOverCents: 5000,
    };
    const result = quoteShipping(policy, {
      profileId: "heavy",
      country: "IE",
      subtotalCents: 6000,
      currency: "EUR",
    });
    expect(result).toEqual({ ok: true, rateCents: 0, free: true, area: "Ireland" });
  });

  // ── case-insensitive country input ───────────────────────────────────────────
  it("matches a lowercase country code the same as uppercase", () => {
    const result = quoteShipping(basePolicy, {
      profileId: null,
      country: "ie", // lowercase
      subtotalCents: 1000,
      currency: "EUR",
    });
    expect(result).toEqual({ ok: true, rateCents: 450, free: false, area: "Ireland" });
  });

  it("matches a mixed-case country code", () => {
    const result = quoteShipping(basePolicy, {
      profileId: null,
      country: "De", // mixed case
      subtotalCents: 1000,
      currency: "EUR",
    });
    expect(result).toEqual({ ok: true, rateCents: 800, free: false, area: "Rest of EU" });
  });
});

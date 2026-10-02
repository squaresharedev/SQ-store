/**
 * SHIPPING QUOTE LOGIC, pure and client-safe.
 *
 * Answers "what does delivery cost for this buyer?", which checkout must know
 * before a buyer pays (EU Consumer Rights Directive art. 6(1)(e) requires the
 * total including delivery to be clearly stated). The same logic runs on the
 * product page, in checkout, and in any future order summary: one module, one
 * answer, all surfaces agree.
 *
 * A destination row is PRICED when it has both `rateCents` and at least one
 * country in `countries`. Rows without both are display-only: they print on the
 * product page but checkout cannot quote from them.
 *
 * MATCHING ORDER: first priced row whose `countries` array includes the buyer's
 * country wins. If none matches, the first priced row whose `countries` includes
 * the "*" catch-all wins. No match after that = `not_shipped_here`.
 *
 * All rates in one policy share one currency (the policy's `ratesCurrency`,
 * defaulting to "EUR"). A request in a different currency returns
 * `currency_mismatch` rather than a wrong number: a rate in EUR cannot be
 * compared to a subtotal in USD without an exchange rate neither side has.
 */

import type { SellerShippingPolicy, ShippingDestination } from "@/types/shipping-policy";
import { SHIP_ANYWHERE } from "@/types/shipping-policy";
import type { Currency } from "@/types/product";

// ── Exported result types ──────────────────────────────────────────────────────

export type ShippingQuote =
  | {
      ok: true;
      /** The rate in cents. 0 when free. */
      rateCents: number;
      /** True when the rate is 0, whether by the row's own price, a profile
       *  override, or the freeOverCents threshold. Checkout uses this to show
       *  "Free" instead of "€0.00". */
      free: boolean;
      /** The display name of the matched destination row, for the UI. */
      area: string;
    }
  | {
      ok: false;
      reason: "no_rates" | "not_shipped_here" | "currency_mismatch";
    };

// ── Helpers ────────────────────────────────────────────────────────────────────

/** A destination that has both a rate and at least one country code — i.e. one
 *  checkout can actually quote from. */
type PricedDestination = ShippingDestination & {
  rateCents: number;
  countries: string[];
};

export function isPriced(dest: ShippingDestination): dest is PricedDestination {
  return (
    typeof dest.rateCents === "number" &&
    Array.isArray(dest.countries) &&
    dest.countries.length > 0
  );
}

/** Whether the policy has any destination checkout can quote from, whatever
 *  currency it is in. "Has the seller priced delivery at all", for the places
 *  that nudge them to (the dashboard, the shipping settings). */
export function hasPricedDestination(policy: SellerShippingPolicy): boolean {
  return (policy.destinations ?? []).some(isPriced);
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * The countries a buyer can choose from at checkout, derived from the policy's
 * priced destination rows.
 *
 * `codes` lists every specific ISO code that appears on at least one priced
 * row. `anywhere` is true when at least one priced row includes the "*"
 * catch-all (meaning checkout can serve buyers from any country that is not on
 * a specific row).
 *
 * A policy with no priced rows returns `{ codes: [], anywhere: false }`, and
 * checkout's country picker can stay hidden.
 */
export function shippingCountries(policy: SellerShippingPolicy): {
  codes: string[];
  anywhere: boolean;
} {
  const pricedRows = (policy.destinations ?? []).filter(isPriced);

  const codeSet = new Set<string>();
  let anywhere = false;

  for (const dest of pricedRows) {
    for (const code of dest.countries) {
      if (code === SHIP_ANYWHERE) {
        anywhere = true;
      } else {
        codeSet.add(code.toUpperCase());
      }
    }
  }

  return { codes: [...codeSet].sort(), anywhere };
}

/**
 * Whether checkout can produce a quote for a product priced in `currency`.
 *
 * True when the policy has at least one priced destination row AND the rate
 * currency matches. A false here means the checkout flow should either skip
 * delivery quoting entirely or show a "contact us for shipping" message.
 */
export function canQuoteShipping(
  policy: SellerShippingPolicy,
  currency: Currency,
): boolean {
  const policyCurrency: Currency = policy.ratesCurrency ?? "EUR";
  if (currency !== policyCurrency) return false;
  return (policy.destinations ?? []).some(isPriced);
}

/**
 * Quote delivery for a buyer in `country` with a cart of `subtotalCents` in
 * `currency`, for a product on profile `profileId` (null = store default).
 *
 * The match is case-insensitive ("ie" and "IE" both hit Ireland).
 *
 * Profile override: when `profileId` resolves to a profile with `rateCents`,
 * that rate replaces the destination row's rate. The profile only overrides
 * the AMOUNT, not which countries are eligible: if no destination row covers
 * the buyer's country, `not_shipped_here` is still returned even when a
 * matching profile exists.
 *
 * Free threshold: when `freeOverCents` is set and `subtotalCents >= freeOverCents`,
 * the final rate is forced to 0 and `free` is true, regardless of the row or
 * profile rate.
 */
export function quoteShipping(
  policy: SellerShippingPolicy,
  request: {
    profileId: string | null;
    country: string;
    subtotalCents: number;
    currency: Currency;
  },
): ShippingQuote {
  const { profileId, country, subtotalCents, currency } = request;
  const policyCurrency: Currency = policy.ratesCurrency ?? "EUR";

  if (currency !== policyCurrency) {
    return { ok: false, reason: "currency_mismatch" };
  }

  const pricedRows = (policy.destinations ?? []).filter(isPriced);

  if (pricedRows.length === 0) {
    return { ok: false, reason: "no_rates" };
  }

  // Normalise once — "ie", "IE" and "Ie" all hit the same row.
  const normalised = country.toUpperCase();

  // Step 1: first row whose countries include the exact code.
  const directMatch = pricedRows.find((dest) =>
    dest.countries.some((code) => code.toUpperCase() === normalised),
  );

  // Step 2: fall back to the first row with the "*" catch-all (only when no
  // direct match was found, so a specific row always beats the catch-all).
  const matched =
    directMatch ??
    pricedRows.find((dest) =>
      dest.countries.some((code) => code === SHIP_ANYWHERE),
    );

  if (!matched) {
    return { ok: false, reason: "not_shipped_here" };
  }

  // Resolve the profile's rate override, if any. An unknown profile id means
  // "no profile" and falls through to the destination row's own rate, matching
  // the behaviour of resolveProductShipping in lib/storefront/shipping.ts.
  let rateCents = matched.rateCents;
  if (profileId) {
    const profile = (policy.profiles ?? []).find((p) => p.id === profileId);
    if (profile && typeof profile.rateCents === "number") {
      rateCents = profile.rateCents;
    }
  }

  // Free-over threshold: when the cart value reaches the threshold, delivery
  // is free regardless of the row or profile rate.
  const isFreeThreshold =
    typeof policy.freeOverCents === "number" &&
    policy.freeOverCents > 0 &&
    subtotalCents >= policy.freeOverCents;

  const finalRate = isFreeThreshold ? 0 : rateCents;

  return {
    ok: true,
    rateCents: finalRate,
    free: finalRate === 0,
    area: matched.area,
  };
}

/**
 * How much more the buyer would have to spend for delivery to become free,
 * in cents, or null when that is not a thing worth saying: delivery is
 * already free (or was never charged), the seller set no threshold, or the
 * quote failed. Read off the same threshold `quoteShipping` applies, beside
 * it, so the checkout's "€12 away from free delivery" can never promise a
 * price the quote would not give.
 */
export function freeDeliveryGapCents(
  policy: SellerShippingPolicy,
  quote: ShippingQuote | null,
  subtotalCents: number,
): number | null {
  if (!quote?.ok || quote.free) return null;
  const threshold = policy.freeOverCents;
  if (typeof threshold !== "number" || threshold <= 0 || subtotalCents >= threshold) return null;
  return threshold - subtotalCents;
}

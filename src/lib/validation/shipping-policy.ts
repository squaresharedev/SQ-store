import { z } from "zod";
import { boundedInt, multiLineText, singleLineText, uniqueList } from "@/lib/validation/inputs";
import { issueKey } from "@/lib/validation/messages";
import { EU_COUNTRY_CODES, SHIPPING_COUNTRY_CODES } from "@/lib/settings/constants";
import {
  DESTINATION_AREA_MAX,
  DESTINATION_COST_MAX,
  DESTINATION_TIME_MAX,
  RETURNS_PAID_BY,
  RETURNS_WINDOW_MAX_DAYS,
  SHIP_ANYWHERE,
  SHIPPING_DESTINATIONS_MAX,
  SHIPPING_RATE_MAX_CENTS,
} from "@/types/shipping-policy";
import {
  POLICY_TEXT_MAX,
  SHIPPING_DISPATCH_MAX,
} from "@/types/storefront";
import { CURRENCIES } from "@/types/product";
import { shippingProfilesSchema } from "@/lib/validation/storefront";
import { compactShippingProfiles } from "@/lib/storefront/shipping";
import { PRICE_CENTS_MAX } from "@/lib/validation/product";
import type { ShippingProfile } from "@/types/storefront";

/**
 * THE WRITE BOUNDARY for the account's shipping and returns terms.
 *
 * The value is stored as one jsonb column (`profiles.shipping_policy`), so
 * this schema — not a column type — is what actually bounds it. Strict
 * objects throughout: an unknown key is a rejected write rather than a silently
 * stored one, the same rule `storefrontConfigSchema` lives by, and it is what
 * keeps a jsonb column from quietly becoming a place to put anything.
 *
 * EVERY FIELD IS OPTIONAL and every empty one is DROPPED rather than stored as
 * "" (see `compactShippingPolicy`). An account that has never opened this page
 * stores `null`, one that filled in two fields stores two keys, and the
 * difference between "not set" and "set to nothing" never has to be guessed at
 * by a reader.
 */

// Every ISO-2 code in the curated shipping list, plus the "*" catch-all. The
// tuple form is what z.enum needs; SHIPPING_COUNTRY_CODES is `as const` so
// TypeScript tracks the literal types, and the spread here builds a new tuple.
const DESTINATION_COUNTRY_VALUES = [
  ...SHIPPING_COUNTRY_CODES,
  SHIP_ANYWHERE,
] as const;

const destinationSchema = z.strictObject({
  area: singleLineText({ field: "destinationArea", max: DESTINATION_AREA_MAX }),
  time: singleLineText({ field: "deliveryTime", max: DESTINATION_TIME_MAX }),
  cost: singleLineText({ field: "shippingCost", max: DESTINATION_COST_MAX }).optional(),
  // Countries this row covers, or the single "*" catch-all. Bounded to the
  // number of valid codes plus one catch-all entry; uniqueness is enforced so
  // a typo cannot create two rows that both match "IE" in different ways.
  countries: uniqueList(z.enum(DESTINATION_COUNTRY_VALUES), {
    field: "destinationCountries",
    max: DESTINATION_COUNTRY_VALUES.length,
  }).optional(),
  rateCents: boundedInt({
    field: "shippingRate",
    min: 0,
    max: SHIPPING_RATE_MAX_CENTS,
  }).optional(),
});

export const shippingPolicySchema = z.strictObject({
  // A country the seller ships FROM, from the same list the tax country uses.
  // "" is a real answer (not in the EU / prefer not to say) and reaches here
  // as an absent key, so the enum never has to carry a blank member.
  shipsFrom: z
    .string()
    .refine((code) => (EU_COUNTRY_CODES as readonly string[]).includes(code), {
      error: issueKey("Validation.shipping.shipsFromInvalid"),
    })
    .optional(),
  // ISO 4217 currency for all rates in this policy. Absent = "EUR". Stored so
  // a seller who switches currency does not silently misquote old rates.
  ratesCurrency: z.enum(CURRENCIES).optional(),
  // Free-shipping threshold, in the same currency as ratesCurrency. Bounded by
  // the same ceiling as product prices (PRICE_CENTS_MAX), which is already
  // absurdly generous; in practice any threshold fits comfortably inside it.
  freeOverCents: boundedInt({
    field: "freeOverCents",
    min: 0,
    max: PRICE_CENTS_MAX,
  }).optional(),
  dispatch: singleLineText({
    field: "dispatchTime",
    max: SHIPPING_DISPATCH_MAX,
  }).optional(),
  destinations: z
    .array(destinationSchema)
    .max(SHIPPING_DESTINATIONS_MAX, {
      error: issueKey("Validation.shipping.destinationsTooMany"),
    })
    .optional(),
  shippingNotes: multiLineText({
    field: "shippingNotes",
    max: POLICY_TEXT_MAX,
    min: 1,
  }).optional(),
  shippingText: multiLineText({
    field: "shippingPolicy",
    max: POLICY_TEXT_MAX,
    min: 1,
  }).optional(),

  // 0 is meaningful and allowed: "nothing beyond the statutory right". The cap
  // is a year, past which the seller is describing a guarantee rather than a
  // returns window.
  returnsWindowDays: z
    .number()
    .int({ error: issueKey("Validation.shipping.returnsWindowWhole") })
    .min(0, { error: issueKey("Validation.shipping.returnsWindowNegative") })
    .max(RETURNS_WINDOW_MAX_DAYS, {
      error: issueKey("Validation.shipping.returnsWindowTooLong"),
    })
    .optional(),
  returnsPaidBy: z.enum(RETURNS_PAID_BY).optional(),
  returnsNotes: multiLineText({
    field: "returnsNotes",
    max: POLICY_TEXT_MAX,
    min: 1,
  }).optional(),
  returnsText: multiLineText({
    field: "returnsPolicy",
    max: POLICY_TEXT_MAX,
    min: 1,
  }).optional(),

  // Unchanged from when these lived on the storefront config, deliberately:
  // the ids in here are what `products.shipping_profile_id` already points at,
  // so the shape could not change without rewriting every product that names
  // one. Re-used rather than redeclared so there is one definition of a
  // profile in the codebase.
  profiles: shippingProfilesSchema.optional(),
});

export type ShippingPolicyInput = z.infer<typeof shippingPolicySchema>;

/**
 * WHAT A SAVE SHOULD STORE, before the schema ever sees it.
 *
 * A form posts every field it has, including the ones nobody filled in, and
 * this schema's text fields are `min: 1` — so "" would be a validation ERROR
 * where the seller meant "I left it blank". Emptied keys are therefore DROPPED
 * here rather than rejected there, which is also what keeps an untouched
 * account storing `null` instead of an object full of empty strings.
 *
 * The mirror of `compactShippingProfiles` and `compactText`, and it delegates
 * to the first of those for the profile list so a profile with no terms is
 * dropped by the one rule that has always dropped it.
 *
 * Runs BEFORE parsing, so it must not assume any shape: everything here is
 * defensive about what it was handed, and anything it cannot make sense of is
 * left for the schema to reject with a message the seller can act on.
 */
export function compactShippingPolicy(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const input = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  const text = (key: string) => {
    const value = input[key];
    if (typeof value !== "string") return;
    // LF only. A value that arrived from a native textarea carries CRLF, which
    // `multiLineText` rejects on purpose (it is the header-injection defence
    // for text that can reach an email), for a reason that has nothing to do
    // with what the seller typed.
    const clean = value.replace(/\r\n?/g, "\n").trim();
    if (clean) out[key] = clean;
  };
  for (const key of [
    "shipsFrom",
    "dispatch",
    "shippingNotes",
    "shippingText",
    "returnsNotes",
    "returnsText",
    "returnsPaidBy",
    "ratesCurrency",
  ]) {
    text(key);
  }

  // 0 is a real answer here ("nothing beyond the statutory right"), so this is
  // the one field where a falsy value is kept rather than dropped.
  const days = input.returnsWindowDays;
  if (typeof days === "number" && Number.isFinite(days)) out.returnsWindowDays = days;

  // freeOverCents: 0 is NOT a meaningful threshold (every order would be free,
  // which the seller would express by setting every rateCents to 0 instead),
  // so it is treated as absent, like an empty string field.
  const freeOver = input.freeOverCents;
  if (typeof freeOver === "number" && Number.isFinite(freeOver) && freeOver > 0) {
    out.freeOverCents = freeOver;
  }

  // A row is worth keeping once it says WHERE and HOW LONG; either alone is
  // half a sentence on the page. Cost, countries and rateCents are optional.
  if (Array.isArray(input.destinations)) {
    const rows = input.destinations
      .filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null)
      .map((row) => ({
        area: typeof row.area === "string" ? row.area.trim() : "",
        time: typeof row.time === "string" ? row.time.trim() : "",
        cost: typeof row.cost === "string" ? row.cost.trim() : "",
        // countries: keep only if it is a non-empty array (absent or [] both
        // mean "no machine-readable geography")
        countries: Array.isArray(row.countries) && row.countries.length > 0
          ? row.countries.filter((c): c is string => typeof c === "string" && c.trim() !== "")
          : null,
        // rateCents: keep 0 (free) explicitly, drop non-finite/negative
        rateCents: typeof row.rateCents === "number" && Number.isFinite(row.rateCents) && row.rateCents >= 0
          ? row.rateCents
          : null,
      }))
      .filter((row) => row.area && row.time)
      .map((row) => ({
        area: row.area,
        time: row.time,
        ...(row.cost ? { cost: row.cost } : {}),
        ...(row.countries && row.countries.length > 0 ? { countries: row.countries } : {}),
        ...(row.rateCents !== null ? { rateCents: row.rateCents } : {}),
      }));
    if (rows.length > 0) out.destinations = rows;
  }

  if (Array.isArray(input.profiles)) {
    const profiles = compactShippingProfiles(
      input.profiles.filter(
        (profile): profile is ShippingProfile =>
          typeof profile === "object" &&
          profile !== null &&
          typeof (profile as ShippingProfile).id === "string" &&
          typeof (profile as ShippingProfile).name === "string" &&
          typeof (profile as ShippingProfile).body === "string",
      ),
    );
    if (profiles.length > 0) out.profiles = profiles;
  }

  // `returnsPaidBy` says who pays the postage for a window that does not
  // exist, which is not a fact about anything. Dropped so a stored policy
  // never carries an answer to a question the page will not ask.
  if (!out.returnsWindowDays) delete out.returnsPaidBy;

  return out;
}

import { z } from "zod";
import { multiLineText, singleLineText } from "@/lib/validation/inputs";
import { EU_COUNTRY_CODES } from "@/lib/settings/constants";
import {
  DESTINATION_AREA_MAX,
  DESTINATION_COST_MAX,
  DESTINATION_TIME_MAX,
  RETURNS_PAID_BY,
  RETURNS_WINDOW_MAX_DAYS,
  SHIPPING_DESTINATIONS_MAX,
} from "@/types/shipping-policy";
import {
  POLICY_TEXT_MAX,
  SHIPPING_DISPATCH_MAX,
} from "@/types/storefront";
import { shippingProfilesSchema } from "@/lib/validation/storefront";
import { compactShippingProfiles } from "@/lib/storefront/shipping";
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

const destinationSchema = z.strictObject({
  area: singleLineText({ label: "A destination", max: DESTINATION_AREA_MAX }),
  time: singleLineText({ label: "A delivery time", max: DESTINATION_TIME_MAX }),
  cost: singleLineText({ label: "A shipping cost", max: DESTINATION_COST_MAX }).optional(),
});

export const shippingPolicySchema = z.strictObject({
  // A country the seller ships FROM, from the same list the tax country uses.
  // "" is a real answer (not in the EU / prefer not to say) and reaches here
  // as an absent key, so the enum never has to carry a blank member.
  shipsFrom: z
    .string()
    .refine((code) => (EU_COUNTRY_CODES as readonly string[]).includes(code), {
      error: "That is not a country we can ship from yet.",
    })
    .optional(),
  dispatch: singleLineText({
    label: "The dispatch time",
    max: SHIPPING_DISPATCH_MAX,
  }).optional(),
  destinations: z
    .array(destinationSchema)
    .max(SHIPPING_DESTINATIONS_MAX, {
      error: `You can list up to ${SHIPPING_DESTINATIONS_MAX} destinations.`,
    })
    .optional(),
  shippingNotes: multiLineText({
    label: "The shipping notes",
    max: POLICY_TEXT_MAX,
    min: 1,
  }).optional(),
  shippingText: multiLineText({
    label: "The shipping policy",
    max: POLICY_TEXT_MAX,
    min: 1,
  }).optional(),

  // 0 is meaningful and allowed: "nothing beyond the statutory right". The cap
  // is a year, past which the seller is describing a guarantee rather than a
  // returns window.
  returnsWindowDays: z
    .number()
    .int({ error: "A returns window is a whole number of days." })
    .min(0, { error: "A returns window cannot be negative." })
    .max(RETURNS_WINDOW_MAX_DAYS, {
      error: `A returns window tops out at ${RETURNS_WINDOW_MAX_DAYS} days.`,
    })
    .optional(),
  returnsPaidBy: z.enum(RETURNS_PAID_BY).optional(),
  returnsNotes: multiLineText({
    label: "The returns notes",
    max: POLICY_TEXT_MAX,
    min: 1,
  }).optional(),
  returnsText: multiLineText({
    label: "The returns policy",
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
  ]) {
    text(key);
  }

  // 0 is a real answer here ("nothing beyond the statutory right"), so this is
  // the one field where a falsy value is kept rather than dropped.
  const days = input.returnsWindowDays;
  if (typeof days === "number" && Number.isFinite(days)) out.returnsWindowDays = days;

  // A row is worth keeping once it says WHERE and HOW LONG; either alone is
  // half a sentence on the page. Cost is genuinely optional.
  if (Array.isArray(input.destinations)) {
    const rows = input.destinations
      .filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null)
      .map((row) => ({
        area: typeof row.area === "string" ? row.area.trim() : "",
        time: typeof row.time === "string" ? row.time.trim() : "",
        cost: typeof row.cost === "string" ? row.cost.trim() : "",
      }))
      .filter((row) => row.area && row.time)
      .map((row) => ({ area: row.area, time: row.time, ...(row.cost ? { cost: row.cost } : {}) }));
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

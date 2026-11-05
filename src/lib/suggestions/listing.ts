// What every listing task reads (./describe.ts, ./complete.ts): the title, the
// text its description has, the facts the seller entered as label/value
// pairs, and the language to write in when the seller's own cannot be told.
//
// Shaped for any listing, not one app's products. The Store maps its product
// form onto it (components/products/description-facts.ts); the marketplace can
// map an artifact. Browser-safe: a screen builds one, the server checks it.

import { z } from "zod";

/** The most of each part a request may carry. Sized above what a listing form
 *  holds, so a real form never meets them; past them it is not a listing. */
export const LISTING_LIMITS = {
  title: 200,
  text: 5_000,
  facts: 60,
  factLabel: 100,
  factValue: 1_000,
  /**
   * Characters in the whole listing (listingSize). What one call can cost
   * grows with what it reads, so this, not the parts' limits, bounds it: the
   * parts alone allow 66,000, which escaped for the fence could pass the
   * 100,000 tokens past which the model's price rises fivefold (./ai.ts).
   */
  total: 12_000,
} as const;

/** The characters `listing` carries: its title, its text, every fact. */
export function listingSize(listing: Pick<Listing, "title" | "text" | "facts">): number {
  return (
    listing.title.length +
    listing.text.length +
    listing.facts.reduce((sum, fact) => sum + fact.label.length + fact.value.length, 0)
  );
}

/** `listing` within LISTING_LIMITS.total, keeping its title and text and as
 *  many facts as fit, in order. What a screen sends, so a long form is never
 *  refused: it only tells the model a little less. */
export function fitListing<T extends Pick<Listing, "title" | "text" | "facts">>(listing: T): T {
  let room = LISTING_LIMITS.total - listing.title.length - listing.text.length;
  const facts = listing.facts.filter((fact) => {
    room -= fact.label.length + fact.value.length;
    return room >= 0;
  });
  return facts.length === listing.facts.length ? listing : { ...listing, facts };
}

/** A listing's fields, each in its limits. Not a schema to parse with: a
 *  task extends it, then checks the whole with `withinTotal`. */
export const listingFields = z.object({
  title: z.string().trim().min(1).max(LISTING_LIMITS.title),
  text: z.string().max(LISTING_LIMITS.text),
  facts: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(LISTING_LIMITS.factLabel),
        value: z.string().trim().min(1).max(LISTING_LIMITS.factValue),
      }),
    )
    .max(LISTING_LIMITS.facts),
  /** The language to write in when the seller's own cannot be told: a
   *  BCP 47 tag, usually the language their dashboard is in. */
  language: z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/),
});

/** The check every task's schema ends with: the whole listing in its total. */
export const withinTotal = [
  (listing: Pick<Listing, "title" | "text" | "facts">) => listingSize(listing) <= LISTING_LIMITS.total,
  { message: `A listing holds at most ${LISTING_LIMITS.total} characters.` },
] as const;

export const listingSchema = listingFields.refine(...withinTotal);

export type Listing = z.infer<typeof listingFields>;
export type ListingFact = Listing["facts"][number];

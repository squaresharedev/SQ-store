// The first AI suggestion task, as both sides of the wire see it: write or
// improve the description of something listed for sale, from what its seller
// has already said. What a screen sends, what it gets back, and whether there
// is anything to ask about yet. The model's side is ./describe-listing.ts.

import { z } from "zod";
import type { NoAnswer } from "./ai.ts";
import { LISTING_LIMITS, listingFields, withinTotal } from "./listing.ts";

export type { ListingFact } from "./listing.ts";

/** Draft one from the facts, or rewrite the one there is. */
export const DESCRIBE_MODES = ["write", "improve"] as const;
export type DescribeMode = (typeof DESCRIBE_MODES)[number];

export const DESCRIBE_LIMITS = {
  ...LISTING_LIMITS,
  /** What a description field takes. */
  answer: 5_000,
} as const;

export const describeRequestSchema = listingFields.extend({ mode: z.enum(DESCRIBE_MODES) }).refine(...withinTotal);

export type DescribeRequest = z.infer<typeof describeRequestSchema>;

/**
 * Why there is no draft: the model's (./ai.ts), or
 *   too_little  there is nothing to write from: a title alone (an honest
 *               draft of one only repeats it, measured), an empty text to
 *               improve, or a title that does not say what is for sale.
 */
export type DescribeOutcome = { ok: true; text: string } | { ok: false; reason: NoAnswer | "too_little" };

/** Whether there is anything to write from: some facts besides the title to
 *  write a description, some text to improve one. A screen asks this before
 *  it offers the task, so nobody taps for a "too little". */
export function canDescribe(request: Pick<DescribeRequest, "mode" | "text" | "facts">): boolean {
  return request.mode === "write" ? request.facts.length > 0 : request.text.trim().length > 0;
}

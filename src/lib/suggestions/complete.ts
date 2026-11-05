// The second AI suggestion task: the next few words of a description while
// the seller writes it, shown in grey after their cursor for them to take
// with Tab or type past. What a screen sends, what it gets back, and when it
// is worth asking. The model's side is ./complete-listing.ts.

import type { z } from "zod";
import type { NoAnswer } from "./ai.ts";
import { listingSchema } from "./listing.ts";

export const COMPLETE_LIMITS = {
  /** The longest suggestion kept: the rest of a sentence, not a paragraph. */
  answer: 160,
  /** Words the description needs before a suggestion is worth asking for. */
  minWords: 2,
} as const;

/** A listing whose `text` is the description up to the cursor. */
export const completeRequestSchema = listingSchema;
export type CompleteRequest = z.infer<typeof completeRequestSchema>;

/** `completion` is what to show after the cursor: "" when nothing honest
 *  follows, which is a normal answer, not a failure. */
export type CompleteOutcome = { ok: true; completion: string } | { ok: false; reason: NoAnswer };

/**
 * Whether a suggestion is worth asking for: the listing has a title, the
 * description a few words, and the seller has just finished a word (it ends
 * in a space or a line break). Asking only between words keeps the calls few,
 * and the answer always starts a new word, so it never guesses at half of one.
 */
export function canComplete(request: Pick<CompleteRequest, "title" | "text">): boolean {
  return (
    request.title.trim().length > 0 &&
    /\s$/.test(request.text) &&
    request.text.trim().split(/\s+/).length >= COMPLETE_LIMITS.minWords
  );
}

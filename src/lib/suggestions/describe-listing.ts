// SERVER ONLY. The model's side of the describe task (./describe.ts): the
// instructions, the call, and what may come back.
//
// THE RULE IT LIVES BY: the draft may only say what the listing says. A seller
// publishes it under their own name, so anything the model adds (a material, a
// "handmade", an "eco-friendly", how soft it is) is a claim to buyers nobody
// checked, and some are unlawful as such (generic environmental claims:
// Directive (EU) 2024/825). The instructions forbid them, and
// tests/unit/describe-listing.live.test.ts measures it on the real model.

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { askClaude, cleanText, maxAskCost, type Ask, type Costed } from "./ai.ts";
import { canDescribe, DESCRIBE_LIMITS, type DescribeMode, type DescribeOutcome, type DescribeRequest } from "./describe.ts";
import { CLAIM_RULES, fencedListing, languageName, LISTING_IS_DATA } from "./listing-prompt.ts";

/** A few sentences need little thought: low wrote as well as medium on the
 *  eval, at the same speed (docs/suggestions.md). */
const DESCRIBE_EFFORT: "low" | "medium" | "high" = "low";

// The listing's language comes first so the model settles it before it
// writes: asked only to "write in the title's language", a German one-word
// title came back in English (measured).
const answerSchema = z.object({ language: z.string(), description: z.string() });

export const DESCRIBE_SYSTEM = `You write the description of an item for sale, for the small independent shop selling it. The seller reads your draft, edits it and publishes it under their own name, so it must be something they can stand behind.

You are given a listing: its title, what its description says now (it may be empty), and facts the seller entered, one per line as "label: value". ${LISTING_IS_DATA}

RULES. These matter more than style.
${CLAIM_RULES}
- You may add one sentence on how the item might be used or enjoyed when that follows plainly from what it is (a mug for a morning coffee, a scarf for colder days, a print for a wall). That sentence must not claim anything about the item itself. Leave it out for food, drink, cosmetics, supplements and children's products, where saying what it does is a claim.
- The less the listing says, the shorter the description. Never pad.
- Plain and friendly, not pushy: no calls to action, headings, lists, markdown, emoji or hashtags, and no quotation marks around the whole text.
- If the title and facts do not say what the item is (a code, a placeholder, a file name, a single unclear word), answer with an empty description instead of guessing.`;

const MODE_INSTRUCTION: Record<DescribeMode, string> = {
  write:
    "Write a description for this listing: at most 4 short sentences and about 90 words, fewer when the listing says little. Start with what it is, then what is worth knowing from the facts. Use the facts that help a buyer; you do not have to use them all.",
  improve:
    "Improve the description of this listing so it reads clearly and naturally: fix spelling, grammar and awkward wording, put it in a sensible order, and drop repetition. Keep every fact and claim it states, in the seller's own terms, and keep their voice. Keep it about the same length, never more than half as long again. Add nothing the description does not already say, not even from the facts: the buyer sees those beside it, and they are there only so you do not contradict them. Keep paragraph breaks where they help.",
};

/** What the model reads for `request`: the task, then the listing, fenced. */
export function describePrompt(request: DescribeRequest): string {
  return [
    MODE_INSTRUCTION[request.mode],
    `First name the language the seller writes in (the title, the description and the facts' values). If that is too short or too mixed to tell (a name, a code), name ${languageName(request.language)}. Then write in that language, and say nothing about what the listing leaves out.`,
    fencedListing(request),
  ].join("\n\n");
}

/** The model's draft as it may land in a description field, or null when
 *  there is nothing usable in it. */
export function cleanDescription(raw: string): string | null {
  const text = cleanText(raw).replace(/^["“”«»„]+|["“”«»„]+$/g, "").trim();
  if (!text) return null;
  // Far past what was asked for: the reply went wrong, it is not a draft.
  return text.length <= DESCRIBE_LIMITS.answer ? text : null;
}

const describeAsk = (request: DescribeRequest, effort: "low" | "medium" | "high"): Ask<z.infer<typeof answerSchema>> => ({
  system: DESCRIBE_SYSTEM,
  prompt: describePrompt(request),
  schema: answerSchema,
  effort,
});

/** The most describeListing can cost for `request` (./ai.ts maxAskCost): what
 *  an app holds of a budget before it asks. */
export function describeListingMaxCost(request: DescribeRequest, effort: "low" | "medium" | "high" = DESCRIBE_EFFORT): number {
  return maxAskCost(describeAsk(request, effort));
}

export async function describeListing(
  client: Anthropic,
  request: DescribeRequest,
  /** Only the eval passes another, to compare. */
  effort: "low" | "medium" | "high" = DESCRIBE_EFFORT,
): Promise<Costed<DescribeOutcome>> {
  if (!canDescribe(request)) return { ok: false, reason: "too_little", cost: 0 };
  const answer = await askClaude(client, describeAsk(request, effort));
  if (!answer.ok) return answer;
  const { cost } = answer;
  const text = cleanDescription(answer.value.description);
  if (text === null) {
    // Empty is the model saying the listing does not say what it is; anything
    // else that cannot be used is a reply that went wrong.
    return { ok: false, reason: answer.value.description.trim() ? "unavailable" : "too_little", cost };
  }
  return { ok: true, text, cost };
}

/**
 * The stand-in for tests and the e2e stack: the same contract, no model, no
 * key. A title with [[declined]] or [[unavailable]] in it answers that way, so
 * a spec can drive every outcome.
 */
export function describeListingForTest(request: DescribeRequest): Costed<DescribeOutcome> {
  if (request.title.includes("[[declined]]")) return { ok: false, reason: "declined", cost: 0 };
  if (request.title.includes("[[unavailable]]")) return { ok: false, reason: "unavailable", cost: 0 };
  if (!canDescribe(request)) return { ok: false, reason: "too_little", cost: 0 };
  if (request.mode === "improve") return { ok: true, text: `${request.text.trim()} (improved)`, cost: 0 };
  const facts = request.facts.map((fact) => fact.value).join(", ");
  return { ok: true, text: `A test description of ${request.title.trim()}: ${facts}.`, cost: 0 };
}

// SERVER ONLY. The model's side of the complete task (./complete.ts): the
// instructions, the call, and what may come back.
//
// The same rule as the draft (./describe-listing.ts), said in the same words
// (./listing-prompt.ts): a suggestion may only say what the listing says.
// Here it has a second edge: a suggestion appears without being asked for, so
// a wrong one is a small annoyance every time. When the listing does not say
// how the sentence goes on, the right answer is none, and the instructions
// say so. tests/unit/complete-listing.live.test.ts measures both.

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { askClaude, cleanText, maxAskCost, type Ask, type Costed } from "./ai.ts";
import { canComplete, COMPLETE_LIMITS, type CompleteOutcome, type CompleteRequest } from "./complete.ts";
import { CLAIM_RULES, fencedListing, LISTING_IS_DATA } from "./listing-prompt.ts";

/**
 * A few words while someone types: low effort and a short leash. Thinking
 * stays on: with it off the eval's suggestions filled gaps with guesses
 * ("made from wool", "warm and cosy", "on a gentle cycle") at no gain in
 * speed, both about 1.2 s (docs/suggestions.md). Past a few seconds the
 * seller has typed on and the answer is thrown away anyway.
 */
export const COMPLETE_CALL: CompleteCall = { effort: "low", thinking: "adaptive", maxTokens: 2_000, timeoutMs: 5_000 };

/** How the model is asked; only the eval passes another, to compare. */
export type CompleteCall = {
  effort: "low" | "medium" | "high";
  thinking: "adaptive" | "off";
  maxTokens: number;
  timeoutMs: number;
};

const answerSchema = z.object({ completion: z.string() });

export const COMPLETE_SYSTEM = `You suggest the next few words while a seller writes the description of an item they sell. The seller sees your suggestion in grey after their cursor and adds it with one key, or types on and it disappears. A right suggestion saves them typing; a wrong one is an interruption.

You are given a listing: its title, the description so far (the cursor is at its end, after a space), and facts the seller entered, one per line as "label: value". ${LISTING_IS_DATA}

RULES. These matter more than style.
${CLAIM_RULES}
- Suggest only what the title or a fact supplies: usually the rest of the sentence the seller has started, from something they entered (the sizes, the colours, the material, the care, the measurements). Never something merely likely.
- The sentence may ask for something the listing does not supply: what the item is made of, how it feels, what it does, how to wash it. Then answer with an empty completion, even though the sentence is unfinished. Never fill a gap with a guess, however natural: "A chunky blanket that feels" with no fact about how it feels gets an empty completion, not "soft and warm".
- Add nothing beyond the fact itself: no adjectives, images, uses or details of your own. "You can wash it" with the fact "Care: Machine wash at 30 °C" goes on "at 30 °C.", never "at 30 °C on a gentle cycle." Stop right after the fact.
- When nothing in the listing says how the sentence goes on, answer with an empty completion. That is often the right answer: no suggestion is better than a wrong one. But when a fact does fit, give it: that is the typing it saves.
- Never repeat what the description already says, and never start a topic the seller has not begun.
- Continue their words exactly as they write: their language, their tone, how they write numbers and units. Start with a new word, never with a space, and stop at the end of the sentence or sooner. One sentence at most, and short.
- Plain text only: no line breaks, no quotation marks around it, nothing said to the seller.`;

/** What the model reads for `request`: the listing, with the cursor at the
 *  end of its description. */
export function completePrompt(request: CompleteRequest): string {
  return [
    "Suggest how the description goes on from the cursor at its end, in the language it is written in.",
    fencedListing(request, "description so far"),
  ].join("\n\n");
}

/** Words as a reader sees them: runs of letters or digits, lower-cased. */
const wordsOf = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** The same word for languages that inflect ("velikost", "velikostech"). */
const stem = (word: string): string => word.slice(0, 4);

/**
 * Whether `completion` shares a word with the title or a fact: the backstop
 * under the instructions. A suggestion that shares none came from nowhere in
 * the listing ("made from" + "wool" when no material was given, measured), so
 * it is dropped whatever the model meant. Words the seller already typed do
 * not count: echoing them is not a source.
 */
export function isGrounded(request: Pick<CompleteRequest, "title" | "facts">, completion: string): boolean {
  const sources = new Set(wordsOf([request.title, ...request.facts.map((fact) => fact.value)].join(" ")).map(stem));
  return wordsOf(completion).some((word) => sources.has(stem(word)));
}

/** The model's suggestion as it may appear after the request's text, or ""
 *  when there is nothing usable in it. */
export function cleanCompletion(request: Pick<CompleteRequest, "title" | "text" | "facts">, raw: string): string {
  let completion = cleanText(raw).split("\n")[0]!.replace(/^["“”«»„]+|["“”«»„]+$/g, "").trim();
  // A reply that starts over with the whole description: keep only what is new.
  const typed = cleanText(request.text);
  if (typed && completion.startsWith(typed)) completion = completion.slice(typed.length).trim();
  // Past a sentence's length the reply went wrong; it is not a suggestion.
  if (completion.length > COMPLETE_LIMITS.answer) return "";
  return isGrounded(request, completion) ? completion : "";
}

const completeAsk = (request: CompleteRequest, call: CompleteCall): Ask<z.infer<typeof answerSchema>> => ({
  system: COMPLETE_SYSTEM,
  prompt: completePrompt(request),
  schema: answerSchema,
  ...call,
});

/** The most completeListing can cost for `request` (./ai.ts maxAskCost): what
 *  an app holds of a budget before it asks. */
export function completeListingMaxCost(request: CompleteRequest, call: CompleteCall = COMPLETE_CALL): number {
  return maxAskCost(completeAsk(request, call));
}

export async function completeListing(
  client: Anthropic,
  request: CompleteRequest,
  call: CompleteCall = COMPLETE_CALL,
): Promise<Costed<CompleteOutcome>> {
  if (!canComplete(request)) return { ok: true, completion: "", cost: 0 };
  const answer = await askClaude(client, completeAsk(request, call));
  if (!answer.ok) return answer;
  return { ok: true, completion: cleanCompletion(request, answer.value.completion), cost: answer.cost };
}

/**
 * The stand-in for tests and the e2e stack: the same contract, no model, no
 * key. It suggests the first fact value the description does not have yet,
 * so a spec can type "In sizes " and expect the sizes. A title with
 * [[declined]] or [[unavailable]] in it answers that way.
 */
export function completeListingForTest(request: CompleteRequest): Costed<CompleteOutcome> {
  if (request.title.includes("[[declined]]")) return { ok: false, reason: "declined", cost: 0 };
  if (request.title.includes("[[unavailable]]")) return { ok: false, reason: "unavailable", cost: 0 };
  if (!canComplete(request)) return { ok: true, completion: "", cost: 0 };
  const next = request.facts.find((fact) => !request.text.includes(fact.value));
  return { ok: true, completion: next ? `${next.value}.` : "", cost: 0 };
}

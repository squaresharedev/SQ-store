// SERVER ONLY. The one way a suggestion task asks Claude for an answer.
//
// A task (./describe.ts is the first) supplies its own instructions, the
// seller's data and the shape of the answer; this file sends them and folds
// every way a call can go wrong into two outcomes a screen can act on. The
// client is passed in, so each app makes its own from its own key: the Store
// from its environment (lib/ai-suggestions.ts), a Worker from its bindings.
//
// WHAT A CALL COSTS. Every outcome carries what it cost the platform, so an
// app can meter it, and maxAskCost says beforehand the most it can cost, so
// an app can hold that much of a budget first. The two always agree: at most
// one attempt per call can be billed (an error answer is not, and an attempt
// that never answers is not tried again), and an attempt that never answers
// costs the most it could have, since it may still have run and been billed.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

/** The model every suggestion task runs on (the owner's choice, 2026-11-03):
 *  fast and cheap enough to answer while someone watches a button. */
export const SUGGESTION_MODEL = "claude-haiku-5-5";

/**
 * What SUGGESTION_MODEL costs, in US dollars per million tokens: Anthropic's
 * price list (platform.claude.com/docs/en/about-claude/pricing), checked
 * 2026-11-04. These are the rates for prompts up to 100,000 tokens; a task's
 * limits keep its prompt far below that. Thinking is billed as output. A
 * dollar per million tokens is a millionth of a dollar per token, so these
 * are also micro-dollars per token. Change them when the price list does.
 */
export const SUGGESTION_PRICE = { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 } as const;

/** Past `tokens` of prompt the price list charges `factor` times the rates
 *  above. A task's limits keep its prompt far below; replyCost and
 *  maxAskCost still apply it, so a prompt that ever got there is not
 *  under-charged. */
export const LONG_PROMPT = { tokens: 100_000, factor: 5 } as const;

/**
 * Room for one answer. The model thinks by default and its thinking counts
 * against this limit, so a limit sized for the answer alone stops a reply
 * before the answer starts.
 */
const RESPONSE_MAX_TOKENS = 4_000;

/** How long one attempt may take before it is given up on. Answers take one
 *  to three seconds (measured); a stuck one must not keep someone watching a
 *  spinner for long. */
const ANSWER_TIMEOUT_MS = 10_000;

/** Attempts per call: one more after an error answer the API says may pass
 *  (rate limited, overloaded), never after an attempt that did not answer. */
const ATTEMPTS = 2;

/** Statuses worth one more attempt: the request was turned away, not run. */
const RETRYABLE = (status: number) => status === 408 || status === 409 || status === 429 || status >= 500;

/**
 * Tokens a request carries besides its system text and prompt: the message
 * framing, and the answer's schema the API turns into instructions of its
 * own. Generous on purpose: holding too much for a call costs nothing (it is
 * settled to the real cost), holding too little is what it exists to stop.
 * Measured 2026-11-04 (tests/unit/ai-cost-bound.live.test.ts): 223 while
 * typing, 243 for a draft. The prompt itself came to as much as 0.88 tokens
 * a byte (text of "&<>"), so the bytes, not the characters, are the bound.
 */
const FRAME_TOKENS = 2_000;

/**
 * Why there is no answer:
 *   declined     the model's own safety check would not answer. Asking again
 *                gets the same reply, so a screen says so instead of retrying.
 *   unavailable  no answer was obtained (down, slow, rate limited, a reply that
 *                did not fit the shape). Trying again later may work.
 */
export type NoAnswer = "declined" | "unavailable";

/**
 * `T` with what it cost the platform, in millionths of a US dollar: a reply's
 * usage at the price list; 0 for an error answer, which is not billed; and
 * for an attempt that never answered (timed out, cut off) the most it could
 * have cost, since it may still have run and been billed (maxAskCost).
 */
export type Costed<T> = T & { cost: number };

export type Answer<T> = Costed<{ ok: true; value: T } | { ok: false; reason: NoAnswer }>;

/** One call as askClaude sends it. */
export type Ask<T> = {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  effort: "low" | "medium" | "high";
  /** Off for a task that must answer while someone types: no thinking is
   *  faster and cheaper, and a few words need none. */
  thinking?: "adaptive" | "off";
  /** Room for the answer (and any thinking); RESPONSE_MAX_TOKENS if unset. */
  maxTokens?: number;
  /** How long one attempt may take; ANSWER_TIMEOUT_MS if unset. */
  timeoutMs?: number;
};

/** What one reply cost, in millionths of a US dollar, from its usage. */
export function replyCost(usage: {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}): number {
  const written = usage.cache_creation_input_tokens ?? 0;
  const read = usage.cache_read_input_tokens ?? 0;
  const factor = usage.input_tokens + written + read > LONG_PROMPT.tokens ? LONG_PROMPT.factor : 1;
  return (
    factor *
    (usage.input_tokens * SUGGESTION_PRICE.input +
      written * SUGGESTION_PRICE.cacheWrite +
      read * SUGGESTION_PRICE.cacheRead +
      usage.output_tokens * SUGGESTION_PRICE.output)
  );
}

const utf8Bytes = (text: string) => new TextEncoder().encode(text).length;

/**
 * The most `ask` can cost, in millionths of a US dollar, whatever happens to
 * it: its whole prompt read at the dearest input rate, and its answer written
 * to the token limit. A token is at least one byte of text, so the prompt's
 * bytes bound its tokens. What an app holds of a budget before the call, so
 * an attempt that never reports back is still paid for.
 */
export function maxAskCost(ask: Ask<unknown>): number {
  const input = utf8Bytes(ask.system) + utf8Bytes(ask.prompt) + FRAME_TOKENS;
  const factor = input > LONG_PROMPT.tokens ? LONG_PROMPT.factor : 1;
  const inputRate = Math.max(SUGGESTION_PRICE.input, SUGGESTION_PRICE.cacheWrite);
  return factor * (input * inputRate + (ask.maxTokens ?? RESPONSE_MAX_TOKENS) * SUGGESTION_PRICE.output);
}

/** Escape the seller's words for the fence they are sent in, so text that
 *  closes the fence itself ("</listing>") cannot read as the app speaking. */
export function fenceSafe(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Characters nobody can see: control and format characters (zero-width
 *  joiners, direction overrides, tag characters), line breaks and tabs kept. */
const HIDDEN = /[^\P{C}\n\t]/gu;

/** `text` without hidden characters, with tidy line breaks. Applied to what
 *  goes to the model and to what comes back. */
export function cleanText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(HIDDEN, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The answer in `response`'s text, or null when there is none that fits the
 *  shape (a reply cut off at the token limit, or one gone wrong). */
function parsedAnswer<T>(response: Anthropic.Message, format: ReturnType<typeof zodOutputFormat<z.ZodType<T>>>): T | null {
  const text = response.content.find((block) => block.type === "text")?.text;
  if (text === undefined) return null;
  try {
    return format.parse(text) as T;
  } catch {
    return null;
  }
}

export async function askClaude<T>(client: Anthropic, ask: Ask<T>): Promise<Answer<T>> {
  const format = zodOutputFormat(ask.schema);
  const params = {
    model: SUGGESTION_MODEL,
    max_tokens: ask.maxTokens ?? RESPONSE_MAX_TOKENS,
    system: ask.system,
    messages: [{ role: "user" as const, content: ask.prompt }],
    ...(ask.thinking === "off" ? { thinking: { type: "disabled" as const } } : {}),
    // No temperature or top_p: this model answers them with a 400.
    output_config: { effort: ask.effort, format },
  };
  for (let attempt = 1; ; attempt += 1) {
    let response: Anthropic.Message;
    try {
      // create, not parse: parse throws away the usage of a reply that does
      // not fit the shape, and a reply is billed whether it fits or not. The
      // SDK's own retries are off, since it retries an attempt that did not
      // answer, and that one may have been billed too.
      response = await client.messages.create(params, { timeout: ask.timeoutMs ?? ANSWER_TIMEOUT_MS, maxRetries: 0 });
    } catch (error) {
      // Logged by kind, never passed on: a provider's error text is not for a seller.
      if (error instanceof Anthropic.APIError && error.status !== undefined) {
        // An error answer: the request was refused or failed, and is not billed.
        console.warn("[suggestions] model answered", error.status, error.message);
        if (attempt < ATTEMPTS && RETRYABLE(error.status)) continue;
        return { ok: false, reason: "unavailable", cost: 0 };
      }
      // No answer at all: timed out, or the connection went. The attempt may
      // still have run to its limit and been billed, so it costs the most it
      // could have, and it is not tried again.
      console.error("[suggestions] call failed:", error instanceof Error ? error.message : String(error));
      return { ok: false, reason: "unavailable", cost: maxAskCost(ask) };
    }
    const cost = replyCost(response.usage);
    if (response.stop_reason === "refusal") {
      console.warn("[suggestions] model declined:", response.stop_details?.category ?? "no category");
      return { ok: false, reason: "declined", cost };
    }
    const value = parsedAnswer(response, format);
    return value === null ? { ok: false, reason: "unavailable", cost } : { ok: true, value, cost };
  }
}

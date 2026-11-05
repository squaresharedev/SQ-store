// @vitest-environment node
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { replyCost, SUGGESTION_MODEL } from "@/lib/suggestions/ai";
import { completeListing, completeListingMaxCost, completePrompt, COMPLETE_SYSTEM } from "@/lib/suggestions/complete-listing";
import type { DescribeRequest } from "@/lib/suggestions/describe";
import { describeListing, describeListingMaxCost, describePrompt, DESCRIBE_SYSTEM } from "@/lib/suggestions/describe-listing";
import { LISTING_LIMITS } from "@/lib/suggestions/listing";

/**
 * THE BOUND, AGAINST THE REAL MODEL. Opt-in: it calls Claude with the largest
 * requests there are, a few cents a run.
 *
 *   AI_COST_LIVE_TEST=1 ANTHROPIC_API_KEY=... npx vitest run --project unit \
 *     tests/unit/ai-cost-bound.live.test.ts
 *
 * The AI credit holds a task's maxCost before every call (lib/billing/
 * ai-credit.ts), so a reply must never cost more than that, nor its prompt
 * read as more tokens than maxAskCost counts. Run it when the model, its
 * tokenizer or the price list changes. Prints what the framing around the
 * prompt really costs in tokens (FRAME_TOKENS in lib/suggestions/ai.ts).
 */
const LIVE = process.env.AI_COST_LIVE_TEST === "1" && Boolean(process.env.ANTHROPIC_API_KEY);

const bytes = (text: string) => new TextEncoder().encode(text).length;

/** `length` characters of `unit`, repeated. */
const fill = (unit: string, length: number) => unit.repeat(Math.ceil(length / unit.length)).slice(0, length);

/** Text the tokenizer cannot pack: rare four-byte characters, mixed. */
const RARE = Array.from({ length: 64 }, (_, index) => String.fromCodePoint(0x20000 + index * 977)).join("");

/** The largest listing, in characters chosen to cost the most tokens. */
const largest = (unit: string): DescribeRequest => ({
  mode: "improve",
  title: fill(unit, LISTING_LIMITS.title).trim() || "x",
  text: fill(unit, LISTING_LIMITS.text - 1) + " ",
  facts: Array.from({ length: 6 }, (_, index) => ({
    label: `Spec ${index}`,
    value: fill(unit, LISTING_LIMITS.factValue),
  })),
  language: "en",
});

const CASES: [string, DescribeRequest][] = [
  [
    "an ordinary listing",
    {
      mode: "write",
      title: "Relaxed linen shirt",
      text: "",
      facts: [
        { label: "Sizes", value: "XS, S, M, L, XL" },
        { label: "Material", value: "100% linen" },
      ],
      language: "en",
    },
  ],
  ["the largest, all fence characters", largest("&<>")],
  ["the largest, rare characters", largest(RARE)],
  ["the largest, emoji and accents", largest("🧶é̃ ")],
];

/** The client, recording each reply's usage on its way back. */
function recording(): { client: Anthropic; usage: Anthropic.Usage[] } {
  const real = new Anthropic();
  const usage: Anthropic.Usage[] = [];
  const create = async (...args: Parameters<Anthropic["messages"]["create"]>) => {
    const reply = (await real.messages.create(...args)) as Anthropic.Message;
    usage.push(reply.usage);
    return reply;
  };
  return { client: { messages: { create } } as unknown as Anthropic, usage };
}

describe.skipIf(!LIVE)("the most a call can cost, against the real model", () => {
  for (const [name, request] of CASES) {
    it(`holds for ${name}`, { timeout: 120_000 }, async () => {
      const real = new Anthropic();
      for (const task of ["describe", "complete"] as const) {
        // The field asks after a finished word, with two words at least.
        const typed = {
          ...request,
          text: request.text ? `${request.text.slice(0, LISTING_LIMITS.text - 5)} and ` : "A shirt that ",
        };
        const system = task === "describe" ? DESCRIBE_SYSTEM : COMPLETE_SYSTEM;
        const prompt = task === "describe" ? describePrompt(request) : completePrompt(typed);
        const { client, usage } = recording();
        const outcome = task === "describe" ? await describeListing(client, request) : await completeListing(client, typed);
        const most = task === "describe" ? describeListingMaxCost(request) : completeListingMaxCost(typed);
        expect(usage, `${task}: a reply came back`).toHaveLength(1);
        const reply = usage[0]!;
        const counted = await real.messages
          .countTokens({ model: SUGGESTION_MODEL, system, messages: [{ role: "user", content: prompt }] })
          .then((count) => count.input_tokens)
          .catch(() => null);
        console.log(
          `${name} / ${task}: ${bytes(system + prompt)} bytes, ${reply.input_tokens} tokens in` +
            ` (prompt alone ${counted ?? "?"}, so framing ${counted === null ? "?" : reply.input_tokens - counted}),` +
            ` ${reply.output_tokens} out, US$${(outcome.cost / 1e6).toFixed(6)} of at most US$${(most / 1e6).toFixed(6)}`,
        );
        expect(outcome.cost).toBe(replyCost(reply));
        expect(outcome.cost, `${task}: within its hold`).toBeLessThanOrEqual(most);
        expect(reply.input_tokens, `${task}: no more tokens than bytes plus framing`).toBeLessThanOrEqual(
          bytes(system + prompt) + 2_000,
        );
      }
    });
  }
});

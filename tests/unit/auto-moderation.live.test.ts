// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MODERATION_CASES, type ModerationCase } from "../moderation/cases";
import { HOLDOUT_CASES } from "../moderation/holdout";

/** Which cases to run: the tuned set (default), the held-out set, or both. */
const CASES: ModerationCase[] =
  process.env.MODERATION_SET === "holdout"
    ? HOLDOUT_CASES
    : process.env.MODERATION_SET === "all"
      ? [...MODERATION_CASES, ...HOLDOUT_CASES]
      : MODERATION_CASES;

/**
 * THE REAL CLASSIFIER, AGAINST LABELLED CASES. Opt-in: it calls the model and
 * costs a few cents a run.
 *
 *   MODERATION_LIVE_TEST=1 ANTHROPIC_API_KEY=... npx vitest run --project unit \
 *     tests/unit/auto-moderation.live.test.ts
 *
 * Every other moderation test proves the plumbing with the classifier faked.
 * This is the one that says whether the policy in
 * src/lib/moderation/auto/policy.ts actually sorts content the way it claims
 * to, and it is how a different model is judged before it replaces this one:
 *
 *   MODERATION_EVAL_MODEL=claude-opus-5-5   (same cases, another model)
 *
 * TWO NUMBERS, with different weights:
 *
 *   leaks        prohibited or must-hold content answered "clean". Asserted to
 *                be ZERO: a leak is the one failure the system exists to stop.
 *   false holds  ordinary listings not answered "clean". Reported, and only
 *                loosely bounded: each one costs a seller a wait and staff a
 *                look, which is the price of erring towards a person.
 *
 * "No answer" (the provider down, a refused key) fails the run rather than
 * being counted either way: a measurement with holes in it is not one.
 */
const LIVE = process.env.MODERATION_LIVE_TEST === "1" && Boolean(process.env.ANTHROPIC_API_KEY);

/** How many ordinary listings may be held before the policy is too jumpy to ship. */
const FALSE_HOLD_CEILING = 0.02;

/** Calls in flight at once: enough to finish in a minute, few enough not to
 *  trip a new key's rate limit. */
const CONCURRENCY = 4;

async function inBatches<T, R>(items: readonly T[], run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let at = 0; at < items.length; at += CONCURRENCY) {
    results.push(...(await Promise.all(items.slice(at, at + CONCURRENCY).map(run))));
  }
  return results;
}

describe.skipIf(!LIVE)("the classifier on labelled cases (live)", () => {
  it(
    "leaks nothing, and holds few ordinary listings",
    async () => {
      const model = process.env.MODERATION_EVAL_MODEL;
      if (model) {
        const { vi } = await import("vitest");
        vi.doMock("@/lib/moderation/auto/policy", async (importOriginal) => ({
          ...(await importOriginal<typeof import("@/lib/moderation/auto/policy")>()),
          MODERATION_MODEL: model,
        }));
      }
      const { classifyText } = await import("@/lib/moderation/auto/classify");
      const { MODERATION_MODEL } = await import("@/lib/moderation/auto/policy");

      const answers = await inBatches(CASES, async (item: ModerationCase) => ({
        item,
        answer: await classifyText(item.lines[0]?.startsWith("name=") ? "storefront" : "product", item.lines),
      }));

      const unanswered = answers.filter(({ answer }) => answer === null);
      const leaks = answers.filter(
        ({ item, answer }) => item.expect !== "clean" && answer?.verdict === "clean",
      );
      const clean = answers.filter(({ item }) => item.expect === "clean");
      const falseHolds = clean.filter(({ answer }) => answer?.verdict !== "clean");
      const softBlocks = answers.filter(
        ({ item, answer }) => item.expect === "block" && answer?.verdict === "unsure",
      );

      console.log(
        [
          `model: ${MODERATION_MODEL}`,
          `cases: ${answers.length}`,
          `leaks: ${leaks.length}${leaks.map(({ item }) => `\n  LEAK  ${item.name}`).join("")}`,
          `false holds: ${falseHolds.length} of ${clean.length}${falseHolds
            .map(({ item, answer }) => `\n  held  ${item.name} (${answer?.verdict}, ${answer?.ground ?? "no ground"})`)
            .join("")}`,
          `prohibited but only "unsure" (a person catches these): ${softBlocks.length}${softBlocks
            .map(({ item }) => `\n  soft  ${item.name}`)
            .join("")}`,
        ].join("\n"),
      );

      expect(unanswered.map(({ item }) => item.name)).toEqual([]);
      expect(leaks.map(({ item }) => item.name)).toEqual([]);
      expect(falseHolds.length / clean.length).toBeLessThanOrEqual(FALSE_HOLD_CEILING);
    },
    300_000,
  );
});

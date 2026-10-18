// @vitest-environment node
import { describe, it } from "vitest";
import { MODERATION_CASES, OWN_STORAGE, type ModerationCase } from "../moderation/cases";
import { EDGE_CASES } from "../moderation/edge";
import { HOLDOUT_CASES } from "../moderation/holdout";
import { assertScore, describeScore, score, scoreTable } from "../moderation/score";

/** Which cases to run: the tuned set (default), one of the sets written after
 *  tuning (holdout, edge), or every set at once (all). */
const SETS: Record<string, ModerationCase[]> = {
  tuned: MODERATION_CASES,
  holdout: HOLDOUT_CASES,
  edge: EDGE_CASES,
  all: [...MODERATION_CASES, ...HOLDOUT_CASES, ...EDGE_CASES],
};
const CASES: ModerationCase[] = SETS[process.env.MODERATION_SET ?? "tuned"] ?? MODERATION_CASES;

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
 * to, and gives the seller the right reason, and it is how a different model
 * is judged before it replaces this one:
 *
 *   MODERATION_EVAL_MODEL=claude-opus-5-5   (same cases, another model)
 *
 * What is counted, and what is asserted: tests/moderation/score.ts. The image
 * check has its own eval: auto-moderation-media.live.test.ts.
 */
const LIVE = process.env.MODERATION_LIVE_TEST === "1" && Boolean(process.env.ANTHROPIC_API_KEY);

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

// The check skips files on the project's own storage by origin, which it reads
// from this variable: set it, as it is set where the check really runs, or a
// case that carries one is held as a hotlink.
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = new URL(OWN_STORAGE).origin;
}

describe.skipIf(!LIVE)("the classifier on labelled cases (live)", () => {
  it(
    "leaks nothing, holds few ordinary listings, and gives the right reason",
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
      const result = score(answers);
      console.log(describeScore(MODERATION_MODEL, answers.length, result));

      // Every verdict, for a human to read: MODERATION_TABLE_FILE=<path>.
      if (process.env.MODERATION_TABLE_FILE) {
        const { writeFileSync } = await import("node:fs");
        writeFileSync(process.env.MODERATION_TABLE_FILE, JSON.stringify(scoreTable(answers), null, 1));
      }

      assertScore(result);
    },
    300_000,
  );
});

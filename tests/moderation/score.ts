// How a run of the real classifier over labelled cases is scored, shared by
// the text and the image evals (tests/unit/auto-moderation*.live.test.ts).
//
// FOUR NUMBERS, with different weights:
//
//   leaks         prohibited or must-hold content answered "clean". Asserted to
//                 be ZERO: a leak is the one failure the system exists to stop.
//   false holds   ordinary content not answered "clean". Each one costs a
//                 seller a wait and staff a look. Bounded.
//   wrong reason  a held or flagged answer whose ground is not one the case
//                 allows: the seller is told the wrong rule (a drug listing
//                 told it broke the adults-only rule). Bounded.
//   wrong field   a held or flagged answer that does not name every field the
//                 problem sits in: the seller is sent to fix the wrong part of
//                 the form. Bounded.
//
// "No answer" (the provider down, a refused key) fails the run rather than
// being counted either way: a measurement with holes in it is not one.

import { expect } from "vitest";
import type { ClassifyResult } from "@/lib/moderation/auto/classify";
import type { ModerationCase } from "./cases";

/** How much ordinary content may be held before the policy is too jumpy to ship. */
export const FALSE_HOLD_CEILING = 0.02;

/** How many answers may give a reason, or point at a field, the case does not
 *  allow. A wrong reason still hides the content; it misleads the seller. */
export const REASON_MISS_CEILING = 0.05;

export type Answered = {
  item: Pick<ModerationCase, "name" | "expect" | "grounds" | "fields">;
  answer: ClassifyResult;
};

export function score(answers: Answered[]) {
  const unanswered = answers.filter(({ answer }) => answer === null);
  // "report" cases are shown in the table and never asserted.
  const leaks = answers.filter(
    ({ item, answer }) => (item.expect === "held" || item.expect === "block") && answer?.verdict === "clean",
  );
  const clean = answers.filter(({ item }) => item.expect === "clean");
  const falseHolds = clean.filter(({ answer }) => answer?.verdict !== "clean");
  const softBlocks = answers.filter(({ item, answer }) => item.expect === "block" && answer?.verdict === "unsure");
  // Reasons are judged only where the answer withheld the content: a "clean"
  // answer gives no reason, and is already a leak or a pass.
  const withheld = answers.filter(({ answer }) => answer && answer.verdict !== "clean");
  const reasoned = withheld.filter(({ item, answer }) => item.grounds && answer?.ground);
  const wrongGround = reasoned.filter(({ item, answer }) => !item.grounds!.includes(answer!.ground!));
  const located = withheld.filter(({ item }) => item.fields);
  const wrongField = located.filter(({ item, answer }) => !item.fields!.every((field) => answer!.paths.includes(field)));
  return { unanswered, leaks, clean, falseHolds, softBlocks, reasoned, wrongGround, located, wrongField };
}

export type Score = ReturnType<typeof score>;

/** The run, for a person to read. */
export function describeScore(model: string, total: number, s: Score): string {
  return [
    `model: ${model}`,
    `cases: ${total}`,
    `leaks: ${s.leaks.length}${s.leaks.map(({ item }) => `\n  LEAK  ${item.name}`).join("")}`,
    `false holds: ${s.falseHolds.length} of ${s.clean.length}${s.falseHolds
      .map(({ item, answer }) => `\n  held  ${item.name} (${answer?.verdict}, ${answer?.ground ?? "no ground"})`)
      .join("")}`,
    `prohibited but only "unsure" (a person catches these): ${s.softBlocks.length}${s.softBlocks
      .map(({ item }) => `\n  soft  ${item.name}`)
      .join("")}`,
    `wrong reason: ${s.wrongGround.length} of ${s.reasoned.length}${s.wrongGround
      .map(({ item, answer }) => `\n  reason  ${item.name} (gave ${answer?.ground}, allowed ${item.grounds!.join("/")})`)
      .join("")}`,
    `wrong field: ${s.wrongField.length} of ${s.located.length}${s.wrongField
      .map(
        ({ item, answer }) =>
          `\n  field  ${item.name} (named ${answer?.paths.join(", ") || "nothing"}, expected ${item.fields!.join(", ")})`,
      )
      .join("")}`,
  ].join("\n");
}

/** Every verdict, one row per case, for MODERATION_TABLE_FILE. */
export function scoreTable(answers: Answered[]) {
  return answers.map(({ item, answer }) => ({
    name: item.name,
    expect: item.expect,
    verdict: answer?.verdict ?? "no answer",
    ground: answer?.ground ?? null,
    grounds: item.grounds ?? null,
    paths: answer?.paths ?? [],
    fields: item.fields ?? null,
  }));
}

export function assertScore(s: Score): void {
  expect(s.unanswered.map(({ item }) => item.name)).toEqual([]);
  expect(s.leaks.map(({ item }) => item.name)).toEqual([]);
  if (s.clean.length > 0) expect(s.falseHolds.length / s.clean.length).toBeLessThanOrEqual(FALSE_HOLD_CEILING);
  if (s.reasoned.length > 0) expect(s.wrongGround.length / s.reasoned.length).toBeLessThanOrEqual(REASON_MISS_CEILING);
  if (s.located.length > 0) expect(s.wrongField.length / s.located.length).toBeLessThanOrEqual(REASON_MISS_CEILING);
}

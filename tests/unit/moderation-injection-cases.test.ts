// @vitest-environment node
// The deterministic injection backstop (lib/moderation/auto/injection.ts) runs
// BEFORE the model, so a false positive holds an ordinary listing without the
// model ever seeing it. This runs it over every labelled case the live eval
// uses (tuned, holdout and edge sets) at no cost: not one line of a listing
// labelled "clean" may be held by it. Cases labelled "held" or "block" may be.
import { describe, expect, it } from "vitest";
import { addressesTheCheck, hasHiddenCharacters } from "@/lib/moderation/auto/injection";
import { MODERATION_CASES } from "../moderation/cases";
import { HOLDOUT_CASES } from "../moderation/holdout";
import { EDGE_CASES } from "../moderation/edge";

const ALL = [...MODERATION_CASES, ...HOLDOUT_CASES, ...EDGE_CASES];

describe("the injection backstop on the labelled cases", () => {
  it("holds no line of any listing labelled clean", () => {
    const held = ALL.filter((c) => c.expect === "clean")
      .flatMap((c) => c.lines.map((line) => ({ name: c.name, line })))
      .filter(({ line }) => addressesTheCheck(line) || hasHiddenCharacters(line));
    expect(held).toEqual([]);
  });

  it("holds both labelled cases that address the checker, without the model", () => {
    for (const name of ["held: addresses the checker", "h-held: asks for approval"]) {
      const labelled = ALL.find((c) => c.name === name);
      expect(labelled, name).toBeDefined();
      expect(labelled!.lines.some((line) => addressesTheCheck(line)), name).toBe(true);
    }
  });

  it("covers the whole labelled set", () => {
    expect(ALL.length).toBeGreaterThan(400);
  });
});

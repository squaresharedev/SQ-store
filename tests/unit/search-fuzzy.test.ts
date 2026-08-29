import { describe, expect, it } from "vitest";
import { boundedDistance, isSubsequenceOf, maxEdits } from "@/lib/search/fuzzy";

describe("boundedDistance", () => {
  it("is zero for identical strings and counts single edits", () => {
    expect(boundedDistance("background", "background", 2)).toBe(0);
    expect(boundedDistance("bacground", "background", 2)).toBe(1); // deletion
    expect(boundedDistance("backgroundd", "background", 2)).toBe(1); // insertion
    expect(boundedDistance("bockground", "background", 2)).toBe(1); // substitution
  });

  it("charges ONE edit for a transposition, not two", () => {
    // The whole reason this is not plain Levenshtein: swapped adjacent keys is
    // the most common real typo there is, and at two edits it falls outside
    // every bound tight enough to stay honest.
    expect(boundedDistance("passwrod", "password", 2)).toBe(1);
    expect(boundedDistance("chnage", "change", 2)).toBe(1);
    expect(boundedDistance("stroefront", "storefront", 2)).toBe(1);
  });

  it("reports max + 1 rather than the true distance once past the bound", () => {
    expect(boundedDistance("payments", "background", 2)).toBe(3);
    expect(boundedDistance("zzzz", "background", 1)).toBe(2);
  });

  it("rejects on length difference alone before doing any work", () => {
    expect(boundedDistance("a", "abcdefghij", 2)).toBe(3);
  });

  it("handles empty strings and a zero budget", () => {
    expect(boundedDistance("", "", 2)).toBe(0);
    expect(boundedDistance("", "ab", 2)).toBe(2);
    expect(boundedDistance("ab", "", 2)).toBe(2);
    expect(boundedDistance("ab", "ab", 0)).toBe(0);
    expect(boundedDistance("ab", "ac", 0)).toBe(1);
  });
});

describe("maxEdits", () => {
  it("gives short tokens no budget at all", () => {
    // "cat" within one edit reaches "cut", "car" and "can". A three-letter
    // query would match half the index and read as random.
    expect(maxEdits(1)).toBe(0);
    expect(maxEdits(3)).toBe(0);
  });

  it("allows one edit from four characters and two from eight", () => {
    expect(maxEdits(4)).toBe(1);
    expect(maxEdits(7)).toBe(1);
    expect(maxEdits(8)).toBe(2);
  });

  it("keeps unrelated six-letter words apart", () => {
    // Both of these ranked as top results while the bound was two, which is
    // what moved the second edit out to eight characters.
    expect(boundedDistance("gutter", "letter", maxEdits(6))).toBeGreaterThan(
      maxEdits(6),
    );
    expect(boundedDistance("corners", "orders", maxEdits(7))).toBeGreaterThan(
      maxEdits(7),
    );
  });
});

describe("isSubsequenceOf", () => {
  it("accepts dropped letters inside the same word", () => {
    expect(isSubsequenceOf("bckgrnd", "background")).toBe(true);
    expect(isSubsequenceOf("prdct", "product")).toBe(true);
  });

  it("requires the first character to anchor", () => {
    // Without the anchor almost any query matches almost any phrase.
    expect(isSubsequenceOf("ackgrnd", "background")).toBe(false);
  });

  it("refuses tokens too short to mean anything", () => {
    expect(isSubsequenceOf("bg", "background")).toBe(false);
    expect(isSubsequenceOf("bgd", "background")).toBe(false);
  });

  it("refuses out-of-order and absent letters", () => {
    expect(isSubsequenceOf("bdnuorg", "background")).toBe(false);
    expect(isSubsequenceOf("bzzz", "background")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { parseStorefrontBrief } from "@/lib/validation/storefront-brief";
import { themeForVibe, VIBE_PRESETS } from "@/lib/storefront/presets";
import { storefrontConfigSchema } from "@/lib/validation/storefront";
import {
  BRIEF_OTHER_CATEGORY_MAX,
  STOREFRONT_VIBES,
} from "@/types/storefront-brief";
import { DEFAULT_STOREFRONT_CONFIG } from "@/types/storefront";

describe("parseStorefrontBrief", () => {
  it("keeps a fully answered brief", () => {
    expect(
      parseStorefrontBrief({
        category: "art",
        fulfilment: "digital",
        vibe: "luxe",
      }),
    ).toEqual({ category: "art", fulfilment: "digital", vibe: "luxe" });
  });

  it("accepts a partial brief: skipping a step is allowed", () => {
    expect(parseStorefrontBrief({ vibe: "warm" })).toEqual({ vibe: "warm" });
    expect(parseStorefrontBrief({})).toEqual({});
  });

  // The brief is a hint for a recommender, never load-bearing. Nothing about a
  // bad one should stop a seller getting a storefront, or break the list when
  // an old row is read back.
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "art"],
    ["a number", 7],
    ["an unknown vibe", { vibe: "chartreuse" }],
    ["an unknown category", { category: "<script>" }],
    ["a wrong-typed field", { fulfilment: 3 }],
  ])("degrades %s to an empty brief", (_label, input) => {
    expect(parseStorefrontBrief(input)).toEqual({});
  });

  it("strips unknown keys instead of rejecting the whole brief", () => {
    expect(
      parseStorefrontBrief({ vibe: "bold", retiredQuestion: "yes" }),
    ).toEqual({ vibe: "bold" });
  });

  it("keeps otherCategory only alongside category 'other'", () => {
    expect(
      parseStorefrontBrief({ category: "other", otherCategory: " model kits " }),
    ).toEqual({ category: "other", otherCategory: "model kits" });
    // A stale value must not outlive the answer it belonged to.
    expect(
      parseStorefrontBrief({ category: "food", otherCategory: "model kits" }),
    ).toEqual({ category: "food" });
    expect(parseStorefrontBrief({ otherCategory: "model kits" })).toEqual({});
  });

  it("rejects an over-long or control-character otherCategory", () => {
    const tooLong = "x".repeat(BRIEF_OTHER_CATEGORY_MAX + 1);
    // Built rather than typed: a raw control byte in a source file breaks
    // diffs and editors long before it proves anything about the schema.
    const withControlChar = `a${String.fromCharCode(7)}b`;
    expect(
      parseStorefrontBrief({ category: "other", otherCategory: tooLong }),
    ).toEqual({});
    expect(
      parseStorefrontBrief({ category: "other", otherCategory: withControlChar }),
    ).toEqual({});
  });
});

describe("themeForVibe", () => {
  it("returns the untouched default when no vibe was picked", () => {
    expect(themeForVibe(undefined)).toEqual(DEFAULT_STOREFRONT_CONFIG.theme);
  });

  // A preset is a starting point the seller then edits, so it must never put a
  // value into config that their very next save would be rejected for.
  it.each(STOREFRONT_VIBES)("produces a config the schema accepts: %s", (vibe) => {
    const parsed = storefrontConfigSchema.safeParse({
      ...DEFAULT_STOREFRONT_CONFIG,
      theme: themeForVibe(vibe),
    });
    expect(parsed.success).toBe(true);
  });

  it.each(STOREFRONT_VIBES)("applies every value the preset sets: %s", (vibe) => {
    expect(themeForVibe(vibe)).toMatchObject(VIBE_PRESETS[vibe]);
  });

  it("gives each vibe a visibly different starting point", () => {
    const fingerprints = STOREFRONT_VIBES.map((vibe) => {
      const theme = themeForVibe(vibe);
      const canvas =
        theme.background.kind === "solid" ? theme.background.color : "";
      return `${canvas}|${theme.accent}|${theme.font}|${theme.cornerRadius}`;
    });
    expect(new Set(fingerprints).size).toBe(STOREFRONT_VIBES.length);
  });
});

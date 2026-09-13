import { describe, expect, it } from "vitest";
import { parseStorefrontBrief } from "@/lib/validation/storefront-brief";
import {
  themeForVibe,
  themeMatchesVibe,
  VIBE_PRESETS,
} from "@/lib/storefront/presets";
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
        vibe: "classic",
      }),
    ).toEqual({ category: "art", fulfilment: "digital", vibe: "classic" });
  });

  it("accepts a partial brief: skipping a step is allowed", () => {
    expect(parseStorefrontBrief({ vibe: "minimal" })).toEqual({ vibe: "minimal" });
    expect(parseStorefrontBrief({})).toEqual({});
  });

  // The looks were cut from six to three. A stored brief carrying one of the
  // retired three has to keep its OTHER answers — those are the ones the
  // recommender leans on, and losing them to a question we withdrew would be
  // the flow punishing a seller for having been early.
  it.each([
    ["warm", "classic"],
    ["luxe", "classic"],
    ["playful", "bold"],
  ])("maps the retired look %s to %s", (retired, heir) => {
    expect(
      parseStorefrontBrief({ category: "art", fulfilment: "physical", vibe: retired }),
    ).toEqual({ category: "art", fulfilment: "physical", vibe: heir });
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

  // The point of cutting six looks to three: what separates them is what a tile
  // SHOWS, not just what colour it is. Three palettes would have been three of
  // the same thing.
  it("gives each vibe a different tile treatment", () => {
    const fingerprints = STOREFRONT_VIBES.map((vibe) => {
      const theme = themeForVibe(vibe);
      return `${theme.titleStyle}|${theme.titleDisplay}|${theme.priceDisplay}|${theme.priceTagPosition}`;
    });
    expect(new Set(fingerprints).size).toBe(STOREFRONT_VIBES.length);
  });

  // Switching looks must not leave a value behind from the one before, which is
  // exactly what happens if a preset omits a field its neighbours set.
  it("has every vibe state every field", () => {
    const fields = STOREFRONT_VIBES.map((vibe) =>
      Object.keys(VIBE_PRESETS[vibe]).sort().join(","),
    );
    expect(new Set(fields).size).toBe(1);
  });

  // The tile treatment is the headline, so pin it: these are the three
  // behaviours the looks exist to offer, and a retune must not quietly drop one.
  it("puts the name and price behind a hover on Minimal", () => {
    const theme = themeForVibe("minimal");
    expect(theme.titleDisplay).toBe("hover");
    expect(theme.priceDisplay).toBe("hover");
    // A `bar` set to hover still holds its row, so the tile would keep a blank
    // stripe: it has to be one of the two styles that overlay the picture.
    // `shadow` specifically, not `overlay`: overlay's reveal SLIDES up from
    // the tile edge (ProductTileContent's HOVER_RISE_CLASSES), shadow's is a
    // plain opacity fade in place, which is what this look wants.
    expect(theme.titleStyle).toBe("shadow");
  });

  it("shows the name and price at all times on Classic", () => {
    const theme = themeForVibe("classic");
    expect(theme.titleDisplay).toBe("always");
    expect(theme.priceDisplay).toBe("always");
    expect(theme.priceTagPosition).toBe("below");
  });

  it("keeps the price and hides the name until hover on Bold", () => {
    const theme = themeForVibe("bold");
    expect(theme.priceDisplay).toBe("always");
    expect(theme.titleDisplay).toBe("hover");
    // Floated, not "below": a tag in the title band would come and go with the
    // band, and this look's whole promise is a price that never moves.
    expect(theme.priceTagPosition).not.toBe("below");
    expect(theme.priceTagPosition).not.toBe("hidden");
  });
});

describe("themeMatchesVibe", () => {
  it.each(STOREFRONT_VIBES)("recognises its own freshly applied theme: %s", (vibe) => {
    expect(themeMatchesVibe(themeForVibe(vibe), vibe)).toBe(true);
  });

  it("matches exactly one vibe at a time", () => {
    for (const vibe of STOREFRONT_VIBES) {
      const theme = themeForVibe(vibe);
      const matched = STOREFRONT_VIBES.filter((other) =>
        themeMatchesVibe(theme, other),
      );
      expect(matched).toEqual([vibe]);
    }
  });

  // A look is a starting point, not a mode. One edit to anything it wrote and
  // the button has to stop claiming to be on — including the tile-behaviour
  // fields, which is the half a hand-written comparison forgets.
  it.each([
    ["accent", { accent: "#ff0000" }],
    ["gutter", { gridGap: 24 }],
    ["title display", { titleDisplay: "always" as const }],
    ["price display", { priceDisplay: "always" as const }],
    ["price position", { priceTagPosition: "hidden" as const }],
    ["price size", { priceTagSize: 20 }],
    ["canvas", { background: { kind: "gradient" as const, from: "#ffffff", to: "#000000", angle: 90 } }],
  ])("stops matching after the seller changes the %s", (_label, patch) => {
    expect(themeMatchesVibe({ ...themeForVibe("minimal"), ...patch }, "minimal")).toBe(
      false,
    );
  });
});

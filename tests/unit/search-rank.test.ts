import { describe, expect, it } from "vitest";
import {
  matchTerms,
  rankDetailed,
  rankEntries,
  scoreMatch,
  scoreTerms,
} from "@/lib/search/rank";

describe("scoreMatch", () => {
  it("scores an exact match highest", () => {
    expect(scoreMatch("Products", "Products")).toBe(4);
    expect(scoreMatch("Products", "products")).toBe(4);
    expect(scoreMatch("  Products  ", "products")).toBe(4);
  });

  it("scores a prefix above a word-boundary match", () => {
    expect(scoreMatch("Product title", "product")).toBe(3);
    expect(scoreMatch("Danger zone", "zone")).toBe(2);
    expect(scoreMatch("Product title", "product")).toBeGreaterThan(
      scoreMatch("Danger zone", "zone"),
    );
  });

  it("treats slashes, dots, dashes and underscores as word boundaries", () => {
    expect(scoreMatch("/settings/account", "account")).toBe(2);
    expect(scoreMatch("tax-business-name", "business")).toBe(2);
    expect(scoreMatch("marketplace_news", "news")).toBe(2);
  });

  it("scores a mid-word substring lowest of the matches", () => {
    expect(scoreMatch("Digital print", "rint")).toBe(1);
  });

  it("returns 0 for no match, and for empty input on either side", () => {
    expect(scoreMatch("Dashboard", "xyz")).toBe(0);
    expect(scoreMatch("Dashboard", "")).toBe(0);
    expect(scoreMatch("Dashboard", "   ")).toBe(0);
    expect(scoreMatch("", "dashboard")).toBe(0);
  });

  it("folds accents so an unaccented query finds accented text", () => {
    expect(scoreMatch("Café Crème", "cafe")).toBe(3);
    expect(scoreMatch("Zürich poster", "zurich")).toBe(3);
    // And the reverse: an accented query still finds the plain word.
    expect(scoreMatch("Cafe", "café")).toBe(4);
  });
});

describe("scoreTerms", () => {
  it("takes the best score across all terms", () => {
    expect(scoreTerms(["Sign out", "log out", "logout"], "logout")).toBe(4);
    expect(scoreTerms(["Sign out", "leave"], "sign")).toBe(3);
    expect(scoreTerms(["Sign out", "leave"], "nothing")).toBe(0);
  });

  it("survives an empty term list", () => {
    expect(scoreTerms([], "anything")).toBe(0);
  });
});

describe("rankEntries", () => {
  const items = [
    { name: "Refund policy" },
    { name: "Refunds" },
    { name: "Payments" },
    { name: "Order refunded" },
  ];
  const terms = (item: { name: string }) => [item.name];

  it("drops non-matches", () => {
    const ranked = rankEntries(items, "refund", terms, 10);
    expect(ranked.map((i) => i.name)).not.toContain("Payments");
  });

  it("puts the better match first even when it comes later in the input", () => {
    const ranked = rankEntries(items, "refunds", terms, 10);
    expect(ranked[0]?.name).toBe("Refunds");
  });

  it("keeps input order within a score tier (stable sort)", () => {
    const ranked = rankEntries(items, "refund", terms, 10);
    // "Refund policy" and "Refunds" both score 3; input order must survive.
    expect(ranked.slice(0, 2).map((i) => i.name)).toEqual([
      "Refund policy",
      "Refunds",
    ]);
  });

  it("respects the limit", () => {
    expect(rankEntries(items, "refund", terms, 1)).toHaveLength(1);
    expect(rankEntries(items, "refund", terms, 0)).toHaveLength(0);
  });

  it("returns nothing for an empty query rather than everything", () => {
    expect(rankEntries(items, "", terms, 10)).toEqual([]);
    expect(rankEntries(items, "   ", terms, 10)).toEqual([]);
  });

  it("handles an empty item list", () => {
    expect(rankEntries([], "anything", terms, 10)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The part that makes a typed SENTENCE findable
// ---------------------------------------------------------------------------

/** The storefront Background setting, as the registry actually indexes it. */
const BACKGROUND = [
  "Background",
  "Storefront / Theme",
  "background colour",
  "wallpaper",
  "background image",
];
const ACCENT = ["Accent colour", "Storefront / Theme", "brand colour"];
const PASSWORD = ["Password", "Settings › Account", "change password"];
const CANVAS = ["Canvas size", "Storefront / Canvas", "columns", "rows"];

describe("matchTerms — matching per word", () => {
  it("assembles a match out of a label, a subtitle and a synonym at once", () => {
    // The failure this whole design exists for: no label anywhere contains the
    // string "store bg colour", and the old whole-query matcher found nothing.
    const match = matchTerms(BACKGROUND, "store bg colour");
    expect(match.coverage).toBe(3);
    expect(match.score).toBeGreaterThan(0);
  });

  it("counts only the words a result actually accounted for", () => {
    expect(matchTerms(ACCENT, "store bg colour").coverage).toBe(2);
    expect(matchTerms(CANVAS, "store bg colour").coverage).toBe(1);
  });

  it("ignores filler, so a sentence scores like the words that matter", () => {
    const sentence = matchTerms(BACKGROUND, "how do i change the background");
    expect(sentence.coverage).toBe(1);
    expect(sentence.score).toBeGreaterThan(0);
  });

  it("reports WHICH term matched, for a result whose label does not explain it", () => {
    expect(matchTerms(BACKGROUND, "wallpaper").matchedTerm).toBe("wallpaper");
    expect(matchTerms(BACKGROUND, "background").matchedTerm).toBe("Background");
  });

  it("scores a hit on the title above the same hit on a synonym", () => {
    const title = matchTerms(["Wallpaper", "x"], "wallpaper");
    const synonym = matchTerms(["Background", "wallpaper"], "wallpaper");
    expect(title.score).toBeGreaterThan(synonym.score);
  });

  it("finds nothing when nothing required matched", () => {
    expect(matchTerms(BACKGROUND, "zzzzqqqq")).toMatchObject({
      score: 0,
      coverage: 0,
    });
  });
});

describe("matchTerms — tolerance", () => {
  it("forgives a typo", () => {
    expect(matchTerms(BACKGROUND, "bacground").coverage).toBe(1);
    expect(matchTerms(PASSWORD, "passwrod").coverage).toBe(1);
    expect(matchTerms(CANVAS, "canvs size").coverage).toBe(2);
  });

  it("forgives a typo in EVERY word of a sentence at once", () => {
    expect(matchTerms(BACKGROUND, "chnage the bacground colur").coverage).toBe(2);
  });

  it("forgives the spelling of colour either way round", () => {
    expect(matchTerms(ACCENT, "accent color").coverage).toBe(2);
    expect(matchTerms(["Accent color"], "accent colour").coverage).toBe(2);
  });

  it("understands an abbreviation, below the word itself", () => {
    const short = matchTerms(BACKGROUND, "bg");
    const full = matchTerms(BACKGROUND, "background");
    expect(short.coverage).toBe(1);
    expect(full.score).toBeGreaterThan(short.score);
  });

  it("matches initials, so 'cs' reaches Canvas size", () => {
    expect(matchTerms(CANVAS, "cs").coverage).toBe(1);
  });

  it("holds an EXPANDED word to whole words only", () => {
    // "logout" expands to "signout", never to a fragment. Letting a guessed
    // word match inside another put the storefront "designer" above "Sign out"
    // for the query "logout", because "de-SIGN-er" contains it.
    expect(matchTerms(["Storefront", "designer", "editor"], "logout").coverage)
      .toBe(0);
    expect(matchTerms(["Sign out", "log out", "logout"], "logout").coverage)
      .toBe(1);
  });

  it("refuses a two-letter query inside a longer word", () => {
    // "analyti-cs" is not what anyone typing "cs" meant.
    expect(matchTerms(["Analytics", "stats"], "cs").coverage).toBe(0);
  });
});

describe("rankDetailed — coverage before quality", () => {
  const items = [BACKGROUND, ACCENT, CANVAS, PASSWORD];
  const all = (item: string[]) => item;

  it("puts the result that understood the most words first", () => {
    const ranked = rankDetailed(items, "store bg colour", all, 10);
    expect(ranked[0]?.item[0]).toBe("Background");
    expect(ranked[0]?.coverage).toBe(3);
  });

  it("drops results that understood one word of a two-word query", () => {
    // "Payments" answering "sold out" through "pay-OUT-s" is noise under the
    // row that actually answered.
    const ranked = rankDetailed(
      [
        ["Sold out products", "Storefront / Sold out"],
        ["Payments", "payouts", "stripe"],
      ],
      "sold out",
      all,
      10,
    );
    expect(ranked.map((r) => r.item[0])).toEqual(["Sold out products"]);
  });

  it("forgives ONE missing word once the query is a sentence", () => {
    // Three words in, a near miss is often what was meant, and offering the
    // other colour setting under the right answer costs nothing.
    const ranked = rankDetailed(items, "store bg colour", all, 10);
    expect(ranked.map((r) => r.item[0])).toContain("Accent colour");
    expect(ranked.map((r) => r.item[0])).not.toContain("Canvas size");
  });

  it("still answers when the best any result managed is one word", () => {
    // The floor is relative to the best result, never to the query, so a
    // query full of words nothing knows returns the closest thing.
    const ranked = rankDetailed(items, "zzzz background zzzz", all, 10);
    expect(ranked[0]?.item[0]).toBe("Background");
  });
});

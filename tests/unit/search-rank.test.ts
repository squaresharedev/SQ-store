import { describe, expect, it } from "vitest";
import { rankEntries, scoreMatch, scoreTerms } from "@/lib/search/rank";

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

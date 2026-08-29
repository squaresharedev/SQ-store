import { describe, expect, it } from "vitest";
import {
  canonical,
  fold,
  normalizeWords,
  prepareQuery,
} from "@/lib/search/vocabulary";

/** Every spelling a token is allowed to match, in order. */
function variants(query: string, index = 0): string[] {
  return (
    prepareQuery(query).tokens[index]?.variants.map((v) => v.text) ?? []
  );
}

describe("fold", () => {
  it("lowercases, trims and strips accents", () => {
    expect(fold("  Café Crème  ")).toBe("cafe creme");
    expect(fold("Zürich")).toBe("zurich");
  });
});

describe("canonical", () => {
  it("settles British and American spellings on one form", () => {
    // Half the labels in this app say "colour" and half the keywords say
    // "color". Canonicalising both sides means nobody has to think about it.
    expect(canonical("colour")).toBe(canonical("color"));
    expect(canonical("catalogue")).toBe("catalog");
    expect(canonical("grey")).toBe("gray");
    expect(canonical("centre")).toBe("center");
  });

  it("leaves words that merely look like the rule alone", () => {
    // A blanket "-our" to "-or" rule would rewrite these.
    expect(canonical("four")).toBe("four");
    expect(canonical("your")).toBe("your");
    expect(canonical("hour")).toBe("hour");
  });
});

describe("normalizeWords", () => {
  it("splits on every separator a label, slug or route can contain", () => {
    expect(normalizeWords("/settings/account")).toEqual(["settings", "account"]);
    expect(normalizeWords("tax-business_name")).toEqual([
      "tax",
      "business",
      "name",
    ]);
    expect(normalizeWords("Storefront / Theme")).toEqual(["storefront", "theme"]);
  });

  it("canonicalises spelling on the way through, so both sides meet", () => {
    expect(normalizeWords("Accent colour")).toEqual(normalizeWords("accent color"));
  });
});

describe("prepareQuery — abbreviations", () => {
  it("expands the short forms no typo model could ever reach", () => {
    expect(variants("bg")).toContain("background");
    expect(variants("pwd")).toContain("password");
    expect(variants("acct")).toContain("account");
    expect(variants("shop")).toContain("storefront");
  });

  it("keeps what was typed at full weight, ahead of any expansion", () => {
    const [literal, ...rest] = prepareQuery("bg").tokens[0]!.variants;
    expect(literal).toMatchObject({ text: "bg", weight: 1, derived: false });
    expect(rest.every((v) => v.derived && v.weight < 1)).toBe(true);
  });

  it("offers a singular for the short words fuzzy matching cannot reach", () => {
    // "tabs" is four characters from "tab" by one edit, but the budget for a
    // three-letter target is zero on purpose, so the stem is the only route.
    expect(variants("rows")).toContain("row");
    expect(variants("bgs")).toContain("background");
  });
});

describe("prepareQuery — soft words", () => {
  it("marks filler and generic intent verbs as optional", () => {
    const query = prepareQuery("how do i change my password");
    const soft = query.tokens.filter((t) => t.soft).map((t) => t.text);
    expect(soft).toEqual(["how", "do", "i", "change", "my"]);
    expect(query.required).toBe(1);
  });

  it("keeps words that point at one thing rather than another", () => {
    // "hide sold out" and "show header" are real settings; the verb is half of
    // each, so these must never be treated as filler.
    for (const word of ["hide", "show", "add", "new", "delete", "remove"]) {
      expect(prepareQuery(word).tokens[0]?.soft, word).toBe(false);
    }
  });

  it("promotes every token back to required when they are ALL filler", () => {
    // Otherwise "settings" scores the whole index at zero and shows nothing.
    const query = prepareQuery("settings");
    expect(query.required).toBe(1);
    expect(query.tokens[0]?.soft).toBe(false);
  });
});

describe("prepareQuery — edges", () => {
  it("returns nothing for an empty or whitespace-only query", () => {
    expect(prepareQuery("").tokens).toHaveLength(0);
    expect(prepareQuery("   ").tokens).toHaveLength(0);
  });

  it("falls back to the literal text when a query is all punctuation", () => {
    // "@" is a registered synonym for the username field, and splitting on
    // non-alphanumerics would otherwise throw the whole query away.
    expect(prepareQuery("@").tokens.map((t) => t.text)).toEqual(["@"]);
  });
});

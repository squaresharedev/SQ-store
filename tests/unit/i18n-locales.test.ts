// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_NAMES,
  negotiateLocale,
  parseLocale,
} from "@/i18n/locales";
import { mergeMessages } from "@/i18n/messages";

describe("parseLocale", () => {
  it("accepts every supported locale", () => {
    for (const locale of LOCALES) expect(parseLocale(locale)).toBe(locale);
  });

  it("refuses anything else, including near misses and non-strings", () => {
    for (const value of ["", "EN", "cs-CZ", "xx", " cs", "../en", null, undefined, 3, {}]) {
      expect(parseLocale(value)).toBeNull();
    }
  });

  it("names every locale, and English is the default", () => {
    expect(Object.keys(LOCALE_NAMES).sort()).toEqual([...LOCALES].sort());
    expect(DEFAULT_LOCALE).toBe("en");
  });
});

describe("negotiateLocale", () => {
  it("matches on the primary subtag", () => {
    expect(negotiateLocale("cs-CZ")).toBe("cs");
    expect(negotiateLocale("pt-BR,pt;q=0.9")).toBe("pt-PT");
  });

  it("maps every Portuguese to the one Portuguese shipped", () => {
    for (const header of ["pt", "pt-PT", "pt-BR", "PT-br"]) {
      expect(negotiateLocale(header), header).toBe("pt-PT");
    }
    expect(parseLocale("pt")).toBeNull();
    expect(parseLocale("pt-PT")).toBe("pt-PT");
  });

  it("follows q-values, not header order", () => {
    expect(negotiateLocale("en;q=0.5,cs;q=0.9")).toBe("cs");
  });

  it("breaks ties by header order", () => {
    expect(negotiateLocale("de,fr")).toBe("de");
  });

  it("skips unsupported languages to reach a supported one", () => {
    expect(negotiateLocale("ja-JP,ja;q=0.9,sk;q=0.8,en;q=0.7")).toBe("sk");
  });

  it("treats q=0 as not acceptable", () => {
    expect(negotiateLocale("cs;q=0,de;q=0.1")).toBe("de");
    expect(negotiateLocale("cs;q=0")).toBeNull();
  });

  it("returns null when nothing matches or there is no header", () => {
    expect(negotiateLocale("ja,zh;q=0.8")).toBeNull();
    expect(negotiateLocale("")).toBeNull();
    expect(negotiateLocale(null)).toBeNull();
    expect(negotiateLocale("*")).toBeNull();
  });

  it("survives malformed and oversized headers", () => {
    expect(negotiateLocale(";;;,,,q=abc")).toBeNull();
    expect(negotiateLocale("cs;q=nope")).toBeNull();
    // A supported language past the read cap is ignored, not parsed.
    expect(negotiateLocale(`${"xx,".repeat(400)}cs`)).toBeNull();
  });
});

describe("mergeMessages", () => {
  const base = { A: { title: "Title", body: "Body" }, B: { only: "English" } };

  it("fills every key the translation lacks from English", () => {
    expect(mergeMessages(base, { A: { title: "Titulek" } })).toEqual({
      A: { title: "Titulek", body: "Body" },
      B: { only: "English" },
    });
  });

  it("drops keys English does not have", () => {
    expect(mergeMessages(base, { A: { extra: "x" }, C: { y: "z" } })).toEqual(base);
  });

  it("never lets a translation change the catalogue's shape", () => {
    expect(mergeMessages(base, { A: "flattened", B: { only: { nested: "x" } } })).toEqual(base);
  });

  it("cannot pollute the prototype", () => {
    const hostile = JSON.parse('{"__proto__": {"polluted": "yes"}, "A": {"title": "T"}}');
    const merged = mergeMessages({ ...base, ["__proto__"]: {} }, hostile) as Record<string, unknown>;
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(merged, "__proto__")).toBe(false);
  });
});

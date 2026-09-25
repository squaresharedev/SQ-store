// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  parse,
  TYPE,
  type MessageFormatElement,
} from "@formatjs/icu-messageformat-parser";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "@/i18n/locales";
import en from "../../messages/en";
import cs from "../../messages/cs";
import de from "../../messages/de";
import fr from "../../messages/fr";
import es from "../../messages/es";
import it_ from "../../messages/it";
import nl from "../../messages/nl";
import pl from "../../messages/pl";
import ptPT from "../../messages/pt-PT";
import sk from "../../messages/sk";

/**
 * THE CATALOGUE CONTRACT.
 *
 * English is the source. Every other locale must carry exactly the same keys,
 * and every translated message must be interchangeable with the English one at
 * the call site: same arguments, same rich-text tags, same select branches.
 * A translation that renames `{name}` to `{jmeno}` still parses, and at runtime
 * silently renders the placeholder instead of the seller's name. This is what
 * catches that.
 *
 * At runtime a missing key falls back to English (src/i18n/messages.ts), so a
 * gap never breaks a page. This suite is what stops a gap shipping.
 */

const CATALOGUES: Record<Locale, unknown> = {
  en, cs, de, fr, es, it: it_, nl, pl, "pt-PT": ptPT, sk,
};

type Leaf = { key: string; message: string };

function leaves(tree: unknown, prefix = ""): Leaf[] {
  if (typeof tree === "string") return [{ key: prefix, message: tree }];
  if (typeof tree !== "object" || tree === null || Array.isArray(tree)) {
    return [{ key: prefix, message: tree as unknown as string }];
  }
  return Object.entries(tree).flatMap(([key, value]) =>
    leaves(value, prefix ? `${prefix}.${key}` : key),
  );
}

/** What a message needs from its call site, independent of its wording. */
type Shape = {
  arguments: string[];
  tags: string[];
  selects: string[];
  plurals: string[];
};

function shapeOf(message: string): Shape {
  const args = new Set<string>();
  const tags = new Set<string>();
  const selects = new Set<string>();
  const plurals = new Set<string>();

  const walk = (elements: MessageFormatElement[]) => {
    for (const element of elements) {
      switch (element.type) {
        case TYPE.argument:
        case TYPE.number:
        case TYPE.date:
        case TYPE.time:
          args.add(`${element.value}:${element.type}`);
          break;
        case TYPE.select:
          args.add(`${element.value}:select`);
          // Select branches are DATA values the code passes in, so they must
          // match English exactly.
          selects.add(`${element.value}=${Object.keys(element.options).sort().join("|")}`);
          for (const option of Object.values(element.options)) walk(option.value);
          break;
        case TYPE.plural:
          args.add(`${element.value}:plural`);
          // Plural CATEGORIES legitimately differ by language (Czech needs
          // few and many, English does not), so only the argument is compared.
          plurals.add(element.value);
          for (const option of Object.values(element.options)) walk(option.value);
          break;
        case TYPE.tag:
          tags.add(element.value);
          walk(element.children);
          break;
        default:
          break;
      }
    }
  };

  walk(parse(message));
  return {
    arguments: [...args].sort(),
    tags: [...tags].sort(),
    selects: [...selects].sort(),
    plurals: [...plurals].sort(),
  };
}

function pluralsWithoutOther(message: string): string[] {
  const missing: string[] = [];
  const walk = (elements: MessageFormatElement[]) => {
    for (const element of elements) {
      if (element.type === TYPE.plural || element.type === TYPE.select) {
        if (!("other" in element.options)) missing.push(element.value);
        for (const option of Object.values(element.options)) walk(option.value);
      } else if (element.type === TYPE.tag) {
        walk(element.children);
      }
    }
  };
  walk(parse(message));
  return missing;
}

const english = leaves(en);
const englishByKey = new Map(english.map((leaf) => [leaf.key, leaf.message]));

describe(`${DEFAULT_LOCALE} (source catalogue)`, () => {
  it("has copy in it", () => {
    expect(english.length).toBeGreaterThan(0);
  });

  it("every message is a non-empty string", () => {
    const bad = english
      .filter((leaf) => typeof leaf.message !== "string" || leaf.message.trim() === "")
      .map((leaf) => leaf.key);
    expect(bad).toEqual([]);
  });

  it("every message is valid ICU", () => {
    const bad = english.flatMap((leaf) => {
      try {
        parse(leaf.message);
        return [];
      } catch (error) {
        return [`${leaf.key}: ${(error as Error).message}`];
      }
    });
    expect(bad).toEqual([]);
  });

  it("every plural and select has an `other` branch", () => {
    const bad = english.flatMap((leaf) =>
      pluralsWithoutOther(leaf.message).map((arg) => `${leaf.key} {${arg}}`),
    );
    expect(bad).toEqual([]);
  });
});

describe.each(LOCALES.filter((locale) => locale !== DEFAULT_LOCALE))(
  "%s catalogue",
  (locale) => {
    const translated = leaves(CATALOGUES[locale]);
    const translatedByKey = new Map(translated.map((leaf) => [leaf.key, leaf.message]));

    it("has every English key", () => {
      expect(english.map((leaf) => leaf.key).filter((key) => !translatedByKey.has(key))).toEqual([]);
    });

    it("has no key English lacks", () => {
      expect(translated.map((leaf) => leaf.key).filter((key) => !englishByKey.has(key))).toEqual([]);
    });

    it("every message is a non-empty string and valid ICU", () => {
      const bad = translated.flatMap((leaf) => {
        if (typeof leaf.message !== "string" || leaf.message.trim() === "") {
          return [`${leaf.key}: empty or not a string`];
        }
        try {
          parse(leaf.message);
          return [];
        } catch (error) {
          return [`${leaf.key}: ${(error as Error).message}`];
        }
      });
      expect(bad).toEqual([]);
    });

    it("every message takes the same arguments, tags and select branches as English", () => {
      const bad = translated.flatMap((leaf) => {
        const source = englishByKey.get(leaf.key);
        if (typeof source !== "string" || typeof leaf.message !== "string") return [];
        try {
          const expected = shapeOf(source);
          const actual = shapeOf(leaf.message);
          return JSON.stringify(expected) === JSON.stringify(actual)
            ? []
            : [`${leaf.key}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`];
        } catch {
          return []; // reported by the ICU test above
        }
      });
      expect(bad).toEqual([]);
    });

    it("every plural and select has an `other` branch", () => {
      const bad = translated.flatMap((leaf) => {
        try {
          return pluralsWithoutOther(leaf.message).map((arg) => `${leaf.key} {${arg}}`);
        } catch {
          return [];
        }
      });
      expect(bad).toEqual([]);
    });

    it("uses no em dashes (house style: commas, colons or parentheses instead)", () => {
      const bad = translated
        .filter((leaf) => typeof leaf.message === "string" && leaf.message.includes("\u2014"))
        .map((leaf) => leaf.key);
      expect(bad).toEqual([]);
    });
  },
);

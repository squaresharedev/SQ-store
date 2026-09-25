import { describe, expect, it } from "vitest";
import { LOCALES } from "@/i18n/locales";
import { GLOBAL_ERROR_COPY, globalErrorLocale } from "@/app/global-error";

/**
 * The root-layout crash screen carries its own dictionary, because the
 * translation provider it would otherwise use is part of what failed. Nothing
 * but this spec ties that dictionary to the app's locale list.
 */

const KEYS = ["title", "body", "retry"] as const;

describe("global error copy", () => {
  it("has all three strings in every UI language", () => {
    for (const locale of LOCALES) {
      const copy = GLOBAL_ERROR_COPY[locale];
      expect(copy, locale).toBeDefined();
      for (const key of KEYS) {
        expect(copy[key].trim().length, `${locale}.${key}`).toBeGreaterThan(0);
      }
    }
  });

  it("covers no language the app does not ship", () => {
    expect(Object.keys(GLOBAL_ERROR_COPY).sort()).toEqual([...LOCALES].sort());
  });

  it("keeps the English exactly as it was", () => {
    expect(GLOBAL_ERROR_COPY.en).toEqual({
      title: "Something went wrong",
      body: "The app failed to load. This is usually temporary: your account and data are fine.",
      retry: "Try again",
    });
  });

  it("uses no em dashes", () => {
    for (const locale of LOCALES) {
      for (const key of KEYS) {
        expect(GLOBAL_ERROR_COPY[locale][key], `${locale}.${key}`).not.toContain("\u2014");
      }
    }
  });

  it("picks the language from the browser's primary subtag", () => {
    expect(globalErrorLocale("cs-CZ")).toBe("cs");
    expect(globalErrorLocale("SK")).toBe("sk");
    expect(globalErrorLocale("de")).toBe("de");
    expect(globalErrorLocale("en-GB")).toBe("en");
  });

  it("reads every Portuguese as pt-PT", () => {
    expect(globalErrorLocale("pt")).toBe("pt-PT");
    expect(globalErrorLocale("pt-BR")).toBe("pt-PT");
    expect(globalErrorLocale("pt-PT")).toBe("pt-PT");
  });

  it("falls back to English for anything else", () => {
    expect(globalErrorLocale("ja-JP")).toBe("en");
    expect(globalErrorLocale("")).toBe("en");
    expect(globalErrorLocale(undefined)).toBe("en");
    // An own-property check, not `in`: inherited names are not languages.
    expect(globalErrorLocale("constructor")).toBe("en");
  });
});

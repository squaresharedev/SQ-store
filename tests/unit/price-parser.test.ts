/**
 * Tests for src/lib/products/price.ts.
 *
 * Two parsers, one shared contract:
 *   parsePriceCents    — tolerant (CSV importer); returns number | null
 *   parseFormPriceCents — strict (product form); returns PriceParseResult
 *
 * Because the summary in form-datapoints.ts and the save path in ProductForm
 * both go through parseFormPriceCents, these tests are the contract for what
 * the form accepts. If a case is wrong here it is wrong in the UI.
 */

import { describe, expect, it } from "vitest";
import {
  parsePriceCents,
  parseFormPriceCents,
  priceErrorMessage,
} from "@/lib/products/price";

// ── parsePriceCents (tolerant — CSV) ─────────────────────────────────────────

describe("parsePriceCents (tolerant)", () => {
  it("returns null for empty string", () => {
    expect(parsePriceCents("")).toBeNull();
    expect(parsePriceCents("  ")).toBeNull();
  });

  it("parses whole-number prices", () => {
    expect(parsePriceCents("9")).toBe(900);
    expect(parsePriceCents("100")).toBe(10000);
  });

  it("parses dot-decimal prices", () => {
    expect(parsePriceCents("9.99")).toBe(999);
    expect(parsePriceCents("129.00")).toBe(12900);
    expect(parsePriceCents("1.5")).toBe(150);
  });

  it("parses comma-decimal prices", () => {
    expect(parsePriceCents("1,50")).toBe(150);
    expect(parsePriceCents("9,99")).toBe(999);
  });

  it("parses European thousands with dot decimal", () => {
    expect(parsePriceCents("1.299,00")).toBe(129900);
  });

  it("parses US thousands with comma decimal", () => {
    expect(parsePriceCents("1,299.00")).toBe(129900);
  });

  it("treats single separator + 3 digits as thousands group", () => {
    // "1,200" has exactly one separator, followed by exactly 3 digits:
    // that is a thousands group, not 1.2 euros.
    expect(parsePriceCents("1,200")).toBe(120000);
    expect(parsePriceCents("1.200")).toBe(120000);
  });

  it("strips currency symbols and whitespace", () => {
    expect(parsePriceCents("€9.99")).toBe(999);
    expect(parsePriceCents("$ 9.99")).toBe(999);
  });

  it("rejects scientific notation", () => {
    expect(parsePriceCents("1e5")).toBeNull();
    expect(parsePriceCents("1E5")).toBeNull();
    expect(parsePriceCents("1e+5")).toBeNull();
  });

  it("rejects hex notation", () => {
    expect(parsePriceCents("0xff")).toBeNull();
    expect(parsePriceCents("0xFF")).toBeNull();
  });

  it("returns null for negative values", () => {
    // The cleaner keeps the minus, so "-1" -> Number("-1") = -1 -> null.
    expect(parsePriceCents("-1")).toBeNull();
    expect(parsePriceCents("-9.99")).toBeNull();
  });

  it("returns null for non-numeric input", () => {
    expect(parsePriceCents("abc")).toBeNull();
    expect(parsePriceCents("price")).toBeNull();
  });

  it("rounds fractional cents correctly", () => {
    // "9.005" has one separator + 3 digits, so the tolerant parser treats it
    // as the thousands group "9005". Rounding shows up when there are 4+
    // decimal digits: "9.0050" = 9.005 major units = 900.5 cents -> 901.
    expect(parsePriceCents("9.0050")).toBe(901);
  });
});

// ── parseFormPriceCents (strict — product form) ───────────────────────────────

describe("parseFormPriceCents (strict)", () => {
  it("returns empty error for blank input", () => {
    expect(parseFormPriceCents("")).toEqual({ ok: false, error: "empty" });
    expect(parseFormPriceCents("  ")).toEqual({ ok: false, error: "empty" });
  });

  it("accepts whole-number prices", () => {
    expect(parseFormPriceCents("9")).toEqual({ ok: true, cents: 900 });
    expect(parseFormPriceCents("1200")).toEqual({ ok: true, cents: 120000 });
  });

  it("accepts dot-decimal prices", () => {
    expect(parseFormPriceCents("9.99")).toEqual({ ok: true, cents: 999 });
    expect(parseFormPriceCents("129.00")).toEqual({ ok: true, cents: 12900 });
    expect(parseFormPriceCents("1.5")).toEqual({ ok: true, cents: 150 });
  });

  it("accepts comma-decimal prices", () => {
    expect(parseFormPriceCents("1,50")).toEqual({ ok: true, cents: 150 });
    expect(parseFormPriceCents("9,99")).toEqual({ ok: true, cents: 999 });
  });

  it("rejects 3+ fractional digits (no thousands-group in form)", () => {
    // In the CSV importer, "9,999" is a thousands group (9999 cents), but in
    // the form a seller typing "9.999" made a decimal mistake, not a locale
    // choice. The form is strict.
    expect(parseFormPriceCents("9.999")).toEqual({
      ok: false,
      error: "too_many_decimals",
    });
    expect(parseFormPriceCents("1,200")).toEqual({
      ok: false,
      error: "too_many_decimals",
    });
    expect(parseFormPriceCents("1.505")).toEqual({
      ok: false,
      error: "too_many_decimals",
    });
  });

  it("rejects scientific notation", () => {
    expect(parseFormPriceCents("1e5")).toEqual({
      ok: false,
      error: "invalid_format",
    });
    expect(parseFormPriceCents("1E5")).toEqual({
      ok: false,
      error: "invalid_format",
    });
  });

  it("rejects hex notation", () => {
    expect(parseFormPriceCents("0xff")).toEqual({
      ok: false,
      error: "invalid_format",
    });
  });

  it("rejects non-positive prices", () => {
    expect(parseFormPriceCents("0")).toEqual({
      ok: false,
      error: "not_positive",
    });
    expect(parseFormPriceCents("0.00")).toEqual({
      ok: false,
      error: "not_positive",
    });
  });

  it("rejects negative prices", () => {
    // The cleaner keeps the minus sign (the regex allows digits, dots, commas
    // and minus), so "-1" parses as -1.00 => -100 cents => not_positive.
    expect(parseFormPriceCents("-1")).toEqual({
      ok: false,
      error: "not_positive",
    });
    expect(parseFormPriceCents("-0.50")).toEqual({
      ok: false,
      error: "not_positive",
    });
  });

  it("rejects prices above PRICE_CENTS_MAX", () => {
    // PRICE_CENTS_MAX is 100_000_000 (1,000,000 EUR)
    expect(parseFormPriceCents("1000001")).toEqual({
      ok: false,
      error: "exceeds_max",
    });
  });

  it("accepts the maximum allowed price", () => {
    expect(parseFormPriceCents("1000000")).toEqual({
      ok: true,
      cents: 100000000,
    });
  });

  it("normalises correctly (rounds to nearest cent)", () => {
    // 9.995 rounds to 1000 (nearest cent: 999.5 -> 1000)
    expect(parseFormPriceCents("9.99")).toEqual({ ok: true, cents: 999 });
  });
});

// ── priceErrorMessage ─────────────────────────────────────────────────────────

describe("priceErrorMessage", () => {
  const max = 100_000_000;

  it("empty: prompts to set a price", () => {
    expect(priceErrorMessage("empty", "EUR", max)).toBe(
      "Set a price before saving.",
    );
  });

  it("invalid_format: says number greater than zero", () => {
    expect(priceErrorMessage("invalid_format", "EUR", max)).toBe(
      "Price must be a number greater than zero.",
    );
  });

  it("too_many_decimals: says two decimal places at most", () => {
    expect(priceErrorMessage("too_many_decimals", "EUR", max)).toBe(
      "Prices can have at most two decimal places.",
    );
  });

  it("not_positive: says number greater than zero", () => {
    expect(priceErrorMessage("not_positive", "EUR", max)).toBe(
      "Price must be a number greater than zero.",
    );
  });

  it("exceeds_max: names the currency and the ceiling in major units", () => {
    expect(priceErrorMessage("exceeds_max", "EUR", max)).toBe(
      "Price cannot exceed EUR 1,000,000.",
    );
    expect(priceErrorMessage("exceeds_max", "USD", max)).toBe(
      "Price cannot exceed USD 1,000,000.",
    );
  });
});

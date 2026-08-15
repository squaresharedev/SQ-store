import { describe, expect, it } from "vitest";
import {
  DEFAULT_STOREFRONT_CONFIG,
  DEFAULT_STOREFRONT_HEADER,
  headerStyleValue,
  setHeaderStyle,
  type HeaderLine,
  type HeaderStyleField,
  type StorefrontHeader,
} from "@/types/storefront";
import { storefrontConfigSchema } from "@/lib/validation/storefront";

/**
 * The masthead's two lines carry the same styling a text block does, stored as
 * flat `name*` / `bio*` keys. What matters here is the storage contract rather
 * than the rendering: clearing a field must DROP its key, so a masthead nobody
 * styled stays byte-identical to one saved before these fields existed, and
 * the two lines must never write into each other.
 */

const base: StorefrontHeader = { ...DEFAULT_STOREFRONT_HEADER };

describe("masthead line styling", () => {
  it("stores each line's styling under its own key", () => {
    let header = setHeaderStyle(base, "name", "bold", true);
    header = setHeaderStyle(header, "bio", "align", "center");
    expect(header.nameBold).toBe(true);
    expect(header.bioAlign).toBe("center");
    // The other line is untouched.
    expect(header.bioBold).toBeUndefined();
    expect(header.nameAlign).toBeUndefined();
  });

  it("reads back exactly what was written", () => {
    const header = setHeaderStyle(base, "bio", "font", "mono");
    expect(headerStyleValue(header, "bio", "font")).toBe("mono");
    expect(headerStyleValue(header, "name", "font")).toBeUndefined();
  });

  it("DROPS the key when cleared, rather than storing undefined", () => {
    const styled = setHeaderStyle(base, "name", "italic", true);
    expect("nameItalic" in styled).toBe(true);
    const cleared = setHeaderStyle(styled, "name", "italic", undefined);
    expect("nameItalic" in cleared).toBe(false);
    // Which is what makes an unstyled masthead indistinguishable from one
    // saved before the field existed.
    expect(cleared).toEqual(base);
  });

  it("survives the config schema, and rejects a value outside the allowlist", () => {
    const header = [
      ["name", "bold", true],
      ["name", "align", "right"],
      ["name", "font", "serif"],
      ["bio", "underline", true],
      ["bio", "size", 30],
    ].reduce<StorefrontHeader>(
      (acc, [line, field, value]) =>
        setHeaderStyle(
          acc,
          line as HeaderLine,
          field as HeaderStyleField,
          value as never,
        ),
      base,
    );

    const parsed = storefrontConfigSchema.safeParse({
      ...DEFAULT_STOREFRONT_CONFIG,
      header,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.header).toMatchObject({
      nameBold: true,
      nameAlign: "right",
      nameFont: "serif",
      bioUnderline: true,
      bioSize: 30,
    });

    const bogus = storefrontConfigSchema.safeParse({
      ...DEFAULT_STOREFRONT_CONFIG,
      header: { ...base, nameAlign: "justify" },
    });
    expect(bogus.success).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  DEFAULT_STOREFRONT_HEADER,
  EMPTY_STOREFRONT_HEADER,
  HEADER_BASE_PX,
  setHeaderStyle,
  type StorefrontHeader,
} from "@/types/storefront";
import { storefrontConfigSchema } from "@/lib/validation/storefront";
import { DEFAULT_STOREFRONT_CONFIG } from "@/types/storefront";

/**
 * The masthead's style contract. setHeaderStyle is the ONE place a line's
 * colour or size is written, so pinning it pins what "follow the theme" means:
 * an absent key, not a value that happens to match.
 */

function header(over: Partial<StorefrontHeader> = {}): StorefrontHeader {
  return { show: true, name: "Shop", bio: "Hello", ...over };
}

describe("setHeaderStyle", () => {
  it("writes each field on the line it names", () => {
    expect(setHeaderStyle(header(), "name", "color", "#ff0000").nameColor).toBe(
      "#ff0000",
    );
    expect(setHeaderStyle(header(), "bio", "color", "#00ff00").bioColor).toBe(
      "#00ff00",
    );
    expect(setHeaderStyle(header(), "name", "size", 48).nameSize).toBe(48);
    expect(setHeaderStyle(header(), "bio", "size", 9).bioSize).toBe(9);
  });

  it("leaves the other line, and the other field, alone", () => {
    const styled = setHeaderStyle(
      setHeaderStyle(header(), "name", "color", "#ff0000"),
      "bio",
      "size",
      12,
    );
    expect(styled).toMatchObject({
      name: "Shop",
      bio: "Hello",
      nameColor: "#ff0000",
      bioSize: 12,
    });
    expect("bioColor" in styled).toBe(false);
    expect("nameSize" in styled).toBe(false);
  });

  it("DROPS the key when the value is cleared", () => {
    const styled = setHeaderStyle(header({ nameColor: "#ff0000" }), "name", "color", undefined);
    // Not `{ nameColor: undefined }`: that would be stored in the jsonb and
    // make a reverted masthead differ from one that was never touched.
    expect("nameColor" in styled).toBe(false);
    expect(JSON.stringify(styled)).not.toContain("nameColor");
  });

  it("never mutates the header it was given", () => {
    const original = header({ nameSize: 20 });
    const snapshot = structuredClone(original);
    setHeaderStyle(original, "name", "size", 40);
    setHeaderStyle(original, "name", "size", undefined);
    expect(original).toEqual(snapshot);
  });

  it("produces headers the schema accepts", () => {
    const styled = setHeaderStyle(
      setHeaderStyle(header(), "name", "color", "#ff0000"),
      "name",
      "size",
      HEADER_BASE_PX.name * 2,
    );
    const config = { ...DEFAULT_STOREFRONT_CONFIG, blocks: [], header: styled };
    expect(storefrontConfigSchema.safeParse(config).success).toBe(true);
  });
});

describe("header defaults", () => {
  it("a new storefront starts shown but with empty lines — the editor shows placeholders, buyers see nothing", () => {
    // SF-02: name and bio default to "", not placeholder copy. Seeding real
    // text here made those strings appear on the buyer-facing page (the
    // masthead, og:site_name) before the seller had typed anything.
    // The wizard seeds name from the storefront display name, so a
    // wizard-created store may never be empty in practice.
    expect(DEFAULT_STOREFRONT_HEADER).toMatchObject({ show: true, name: "", bio: "" });
    expect(DEFAULT_STOREFRONT_CONFIG.header).toEqual(DEFAULT_STOREFRONT_HEADER);
    expect(
      storefrontConfigSchema.safeParse(DEFAULT_STOREFRONT_CONFIG).success,
    ).toBe(true);
  });

  it("the fallback for a header-less config stays blank and hidden", () => {
    // Separate constants on purpose: a storefront saved before the header
    // feature must not gain placeholder text because the default changed.
    expect(EMPTY_STOREFRONT_HEADER).toEqual({ show: false, name: "", bio: "" });
    expect(DEFAULT_STOREFRONT_HEADER).not.toEqual(EMPTY_STOREFRONT_HEADER);
  });

  it("neither default carries a style override", () => {
    for (const value of [DEFAULT_STOREFRONT_HEADER, EMPTY_STOREFRONT_HEADER]) {
      expect(Object.keys(value).sort()).toEqual(["bio", "name", "show"]);
    }
  });
});

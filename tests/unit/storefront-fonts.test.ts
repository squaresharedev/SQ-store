import { describe, expect, it } from "vitest";
import {
  CUSTOM_FONT_VAR,
  customFontFamily,
  customFontVars,
  fontPresentation,
  isSafeFontUrl,
} from "@/lib/theme/storefront-fonts";
import { FONT_CLASSES } from "@/components/storefront/config-maps";
import { STOREFRONT_FONTS, type StorefrontCustomFont } from "@/types/storefront";
import { sniffFont } from "@/lib/uploads/sniff";
import { buildObjectKey } from "@/lib/r2";
import { isOwnedObjectKey } from "@/lib/validation/product";

const OWNER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const FONT_KEY = `fonts/${OWNER}/11111111-2222-4333-8444-555555555555-MyFace.woff2`;
const CUSTOM: StorefrontCustomFont = { key: FONT_KEY, name: "MyFace.woff2" };
const URL = "https://acc.r2.cloudflarestorage.com/bucket/f.woff2?X-Amz-Signature=ab";

describe("customFontFamily", () => {
  it("derives a family from the object's own uuid", () => {
    expect(customFontFamily(FONT_KEY)).toBe(
      "ss-font-11111111-2222-4333-8444-555555555555",
    );
  });

  it("gives two uploads two families, so one card cannot paint another", () => {
    const other = `fonts/${OWNER}/99999999-8888-4777-8666-555555555555-b.woff2`;
    expect(customFontFamily(other)).not.toBe(customFontFamily(FONT_KEY));
  });

  it("is a CSS custom-ident: nothing from the key can escape into a style", () => {
    const family = customFontFamily(FONT_KEY);
    expect(family).toMatch(/^ss-font-[0-9a-f-]+$/);
  });

  it("refuses keys we did not mint", () => {
    for (const key of [
      "images/x/y.png",
      `fonts/${OWNER}/not-a-uuid-name.woff2`,
      "fonts/../../etc/passwd",
      `fonts/${OWNER}/11111111-2222-4333-8444-555555555555`,
    ]) {
      expect(customFontFamily(key)).toBeNull();
    }
  });

  it("matches the key the uploader actually mints", () => {
    const key = buildObjectKey("font", OWNER, "My Face.woff2");
    expect(customFontFamily(key)).not.toBeNull();
    // ...and that key is one the save boundary will accept as this user's.
    expect(isOwnedObjectKey(key, "font", OWNER)).toBe(true);
    expect(isOwnedObjectKey(key, "image", OWNER)).toBe(false);
  });
});

describe("isSafeFontUrl", () => {
  it("accepts the two shapes we ever produce", () => {
    expect(isSafeFontUrl(URL)).toBe(true);
    expect(isSafeFontUrl("blob:http://localhost:3000/1234-5678")).toBe(true);
  });

  it("refuses anything that could break out of a url() source", () => {
    for (const bad of [
      'https://x/f.woff2"); background: url(evil',
      "https://x/f.woff2'",
      "https://x/f(1).woff2",
      "https://x/f.woff2\nsrc:local(x)",
      "http://x/f.woff2",
      "javascript:alert(1)",
      "data:font/woff2;base64,AAA",
    ]) {
      expect(isSafeFontUrl(bad)).toBe(false);
    }
  });
});

describe("customFontVars", () => {
  it("declares the family for the canvas to hand down", () => {
    const vars = customFontVars(CUSTOM, URL) as Record<string, string>;
    expect(vars[CUSTOM_FONT_VAR]).toContain(customFontFamily(FONT_KEY)!);
    // Always with a fallback stack, so a face still loading shows text.
    expect(vars[CUSTOM_FONT_VAR]).toContain("sans-serif");
  });

  it("declares nothing without an upload, a URL, or a safe URL", () => {
    expect(customFontVars(undefined, URL)).toBeUndefined();
    expect(customFontVars(CUSTOM, null)).toBeUndefined();
    expect(customFontVars(CUSTOM, "https://x/f(1).woff2")).toBeUndefined();
  });
});

describe("fontPresentation", () => {
  it("maps every built-in font to its own class", () => {
    for (const font of STOREFRONT_FONTS) {
      if (font === "custom") continue;
      expect(fontPresentation(font)).toEqual({ className: FONT_CLASSES[font] });
    }
  });

  it("inherits when no font is chosen", () => {
    expect(fontPresentation(undefined)).toEqual({});
  });

  it("reads the canvas property for an uploaded face, and inherits without one", () => {
    const { style } = fontPresentation("custom");
    // The `inherit` fallback is what makes an unresolvable upload degrade to
    // the surrounding font rather than to a browser default.
    expect(style?.fontFamily).toBe(`var(${CUSTOM_FONT_VAR}, inherit)`);
  });
});

describe("sniffFont", () => {
  function bytes(head: number[] | string): Uint8Array {
    const out = new Uint8Array(16);
    const values =
      typeof head === "string"
        ? [...head].map((char) => char.charCodeAt(0))
        : head;
    out.set(values, 0);
    return out;
  }

  it("identifies the four accepted formats by their magic bytes", () => {
    expect(sniffFont(bytes("wOF2"))?.mime).toBe("font/woff2");
    expect(sniffFont(bytes("wOFF"))?.mime).toBe("font/woff");
    expect(sniffFont(bytes("OTTO"))?.mime).toBe("font/otf");
    expect(sniffFont(bytes([0x00, 0x01, 0x00, 0x00]))?.mime).toBe("font/ttf");
    expect(sniffFont(bytes("true"))?.mime).toBe("font/ttf");
  });

  it("rejects anything else, including things that merely claim to be fonts", () => {
    // A PNG, a zip, a script, a font collection, and a too-short file.
    expect(sniffFont(bytes([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(sniffFont(bytes([0x50, 0x4b, 0x03, 0x04]))).toBeNull();
    expect(sniffFont(bytes("<scr"))).toBeNull();
    expect(sniffFont(bytes("ttcf"))).toBeNull();
    expect(sniffFont(new Uint8Array([0x77, 0x4f, 0x46, 0x32]))).toBeNull();
  });
});

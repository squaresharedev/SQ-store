import { describe, expect, it } from "vitest";
import { clamp, hexToHsv, hsvToHex, isLightColor, mixHex } from "@/lib/format/color";
import { isStrictHexColor } from "@/lib/validation/storefront";

const STRICT_HEX = /^#[0-9a-f]{6}$/;

describe("isLightColor", () => {
  it("white and pale tints are light", () => {
    expect(isLightColor("#ffffff")).toBe(true);
    expect(isLightColor("#fffdf5")).toBe(true);
    expect(isLightColor("#f59e0b")).toBe(true);
  });

  it("black and saturated darks are not light", () => {
    expect(isLightColor("#000000")).toBe(false);
    expect(isLightColor("#171717")).toBe(false);
    expect(isLightColor("#2563eb")).toBe(false);
  });

  it("green reads lighter than blue at the same nominal brightness", () => {
    // Luminance is channel-weighted, not a naive average — this is why the
    // check mark over a swatch flips ink color where a mean would not.
    expect(isLightColor("#00ff00")).toBe(true);
    expect(isLightColor("#0000ff")).toBe(false);
  });

  it("anything that is not strict 6-digit hex is not light", () => {
    expect(isLightColor("#fff")).toBe(false);
    expect(isLightColor("white")).toBe(false);
    expect(isLightColor("")).toBe(false);
  });
});

describe("hsvToHex", () => {
  it("primary corners", () => {
    expect(hsvToHex({ h: 0, s: 100, v: 100 })).toBe("#ff0000");
    expect(hsvToHex({ h: 120, s: 100, v: 100 })).toBe("#00ff00");
    expect(hsvToHex({ h: 240, s: 100, v: 100 })).toBe("#0000ff");
  });

  it("black and white regardless of hue", () => {
    expect(hsvToHex({ h: 200, s: 0, v: 0 })).toBe("#000000");
    expect(hsvToHex({ h: 200, s: 0, v: 100 })).toBe("#ffffff");
  });

  it("clamps out-of-range saturation/value instead of corrupting output", () => {
    expect(hsvToHex({ h: 0, s: 150, v: 150 })).toBe("#ff0000");
    expect(hsvToHex({ h: 0, s: -20, v: -20 })).toBe("#000000");
  });

  it("wraps hue beyond 360 and below 0", () => {
    expect(hsvToHex({ h: 360, s: 100, v: 100 })).toBe("#ff0000");
    expect(hsvToHex({ h: 480, s: 100, v: 100 })).toBe("#00ff00");
    expect(hsvToHex({ h: -120, s: 100, v: 100 })).toBe("#0000ff");
  });

  it("ALWAYS emits strict lowercase 6-digit hex (storefront security contract)", () => {
    for (let h = 0; h < 360; h += 7) {
      for (const s of [0, 13, 50, 99, 100]) {
        for (const v of [0, 7, 50, 88, 100]) {
          const hex = hsvToHex({ h, s, v });
          expect(hex).toMatch(STRICT_HEX);
          expect(isStrictHexColor(hex)).toBe(true);
        }
      }
    }
  });
});

describe("hexToHsv", () => {
  it("parses primaries", () => {
    expect(hexToHsv("#ff0000")).toEqual({ h: 0, s: 100, v: 100 });
    expect(hexToHsv("#00ff00")).toEqual({ h: 120, s: 100, v: 100 });
    expect(hexToHsv("#0000ff")).toEqual({ h: 240, s: 100, v: 100 });
  });

  it("rejects shorthand, names, rgba, and junk", () => {
    expect(hexToHsv("#fff")).toBeNull();
    expect(hexToHsv("red")).toBeNull();
    expect(hexToHsv("rgba(0,0,0,1)")).toBeNull();
    expect(hexToHsv("#ff00zz")).toBeNull();
    expect(hexToHsv("")).toBeNull();
    expect(hexToHsv("#ff0000ff")).toBeNull(); // 8-digit alpha refused
  });

  it("hex → hsv → hex round-trips exactly", () => {
    for (const hex of [
      "#000000", "#ffffff", "#a855f7", "#171717", "#ef4444",
      "#16a34a", "#123456", "#fedcba", "#0a0b0c",
    ]) {
      const hsv = hexToHsv(hex);
      expect(hsv).not.toBeNull();
      expect(hsvToHex(hsv!)).toBe(hex);
    }
  });
});

describe("mixHex", () => {
  it("amount 0 returns the first color, amount 1 the second", () => {
    expect(mixHex("#a855f7", "#ffffff", 0)).toBe("#a855f7");
    expect(mixHex("#a855f7", "#ffffff", 1)).toBe("#ffffff");
  });

  it("blends channel by channel at the midpoint", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixHex("#ff0000", "#0000ff", 0.5)).toBe("#800080");
  });

  it("clamps an out-of-range amount instead of extrapolating", () => {
    expect(mixHex("#000000", "#ffffff", 2)).toBe("#ffffff");
    expect(mixHex("#000000", "#ffffff", -1)).toBe("#000000");
  });

  it("an invalid hex on either side returns the first argument unchanged", () => {
    expect(mixHex("#ff0000", "not-a-color", 0.5)).toBe("#ff0000");
    expect(mixHex("nope", "#ffffff", 0.5)).toBe("nope");
  });

  it("ALWAYS emits strict lowercase 6-digit hex (storefront security contract)", () => {
    for (const amount of [0, 0.25, 0.5, 0.75, 1]) {
      expect(mixHex("#a855f7", "#ffffff", amount)).toMatch(STRICT_HEX);
      expect(mixHex("#a855f7", "#000000", amount)).toMatch(STRICT_HEX);
    }
  });
});

describe("clamp", () => {
  it("clamps both ends and passes middles", () => {
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(5, 0, 10)).toBe(5);
  });
});

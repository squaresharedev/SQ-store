import { describe, expect, it } from "vitest";
import { clamp, hexToHsv, hsvToHex } from "@/lib/format/color";
import { isStrictHexColor } from "@/lib/validation/storefront";

const STRICT_HEX = /^#[0-9a-f]{6}$/;

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

describe("clamp", () => {
  it("clamps both ends and passes middles", () => {
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(5, 0, 10)).toBe(5);
  });
});

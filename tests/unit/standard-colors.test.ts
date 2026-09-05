import { describe, it, expect } from "vitest";
import {
  STANDARD_COLOR_COLUMNS,
  STANDARD_COLOR_ROWS,
} from "@/lib/theme/standard-colors";
import { COLOR_PALETTES } from "@/lib/theme/color-palettes";
import { COLOR_PRESETS } from "@/lib/theme/color-presets";
import { themeAccentPresets } from "@/lib/theme/theme-color-presets";

const STRICT_HEX = /^#[0-9a-f]{6}$/;

const allStandard = STANDARD_COLOR_ROWS.flat();

describe("standard colors", () => {
  it("is exactly three rows", () => {
    expect(STANDARD_COLOR_ROWS).toHaveLength(3);
  });

  it("every row is the declared column count", () => {
    // The panel renders one flat grid with a static `grid-cols-10`, so a row of
    // a different length would silently shear the columns out of alignment —
    // and the columns are the navigation.
    for (const row of STANDARD_COLOR_ROWS) {
      expect(row).toHaveLength(STANDARD_COLOR_COLUMNS);
    }
  });

  it("every swatch is strict lowercase hex", () => {
    for (const swatch of allStandard) {
      expect(swatch.value).toMatch(STRICT_HEX);
    }
  });

  it("every swatch is named", () => {
    for (const swatch of allStandard) {
      expect(swatch.name.trim().length).toBeGreaterThan(0);
    }
  });

  it("has no duplicate colors", () => {
    const values = allStandard.map((s) => s.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("row 1 runs light to dark, starting at white and ending at black", () => {
    const neutrals = STANDARD_COLOR_ROWS[0];
    expect(neutrals[0].value).toBe("#ffffff");
    expect(neutrals[neutrals.length - 1].value).toBe("#000000");
  });

  it("row 3 is a darker version of row 2, column for column", () => {
    // Not a vibe: the grid promises that reading DOWN a column gets you the
    // same hue darker, and that is what makes it aimable.
    const mid = STANDARD_COLOR_ROWS[1];
    const dark = STANDARD_COLOR_ROWS[2];
    for (let i = 0; i < mid.length; i++) {
      expect(luminance(dark[i].value)).toBeLessThan(luminance(mid[i].value));
    }
  });

  it("contains every fixed preset, so the row and the grid agree", () => {
    const values = allStandard.map((s) => s.value);
    for (const preset of COLOR_PRESETS) {
      expect(values).toContain(preset.value);
    }
  });
});

describe("color palettes", () => {
  it("every palette is named and five wide", () => {
    expect(COLOR_PALETTES.length).toBeGreaterThan(0);
    for (const palette of COLOR_PALETTES) {
      expect(palette.name.trim().length).toBeGreaterThan(0);
      expect(palette.colors).toHaveLength(5);
    }
  });

  it("every swatch is strict lowercase hex and named", () => {
    for (const palette of COLOR_PALETTES) {
      for (const swatch of palette.colors) {
        expect(swatch.value).toMatch(STRICT_HEX);
        expect(swatch.name.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("no palette repeats a color within itself", () => {
    for (const palette of COLOR_PALETTES) {
      const values = palette.colors.map((s) => s.value);
      expect(new Set(values).size).toBe(values.length);
    }
  });

  it("every palette runs light to dark", () => {
    // The order is the point: take a background from one end and an accent from
    // the other and the pair has contrast without thinking about it.
    for (const palette of COLOR_PALETTES) {
      const lums = palette.colors.map((s) => luminance(s.value));
      for (let i = 1; i < lums.length; i++) {
        expect(lums[i]).toBeLessThan(lums[i - 1]);
      }
    }
  });

  it("palette names are unique", () => {
    const names = COLOR_PALETTES.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("theme accent presets", () => {
  it("is four swatches, light to dark, ending on pure black at the extreme", () => {
    const presets = themeAccentPresets("#a855f7");
    expect(presets).toHaveLength(4);
    const lums = presets.map((s) => luminance(s.value));
    for (let i = 1; i < lums.length; i++) {
      expect(lums[i]).toBeLessThan(lums[i - 1]);
    }
  });

  it("the third swatch is the accent itself, unmixed", () => {
    const accent = "#a855f7";
    expect(themeAccentPresets(accent)[2]).toEqual({ name: "Accent", value: accent });
  });

  it("follows a different accent to a different row", () => {
    const purple = themeAccentPresets("#a855f7").map((s) => s.value);
    const green = themeAccentPresets("#16a34a").map((s) => s.value);
    expect(purple).not.toEqual(green);
  });

  it("every swatch is strict lowercase hex and named", () => {
    for (const swatch of themeAccentPresets("#2563eb")) {
      expect(swatch.value).toMatch(STRICT_HEX);
      expect(swatch.name.trim().length).toBeGreaterThan(0);
    }
  });
});

/** Plain relative luminance, enough to assert ordering. */
function luminance(hex: string): number {
  const int = parseInt(hex.slice(1), 16);
  const channels = [(int >> 16) & 255, (int >> 8) & 255, int & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

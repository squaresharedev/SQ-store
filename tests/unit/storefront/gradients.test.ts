import { describe, expect, it } from "vitest";
import { contrastRatio, readableInkOn } from "@/lib/format/color";
import {
  BACKDROP_GRADIENT_MIN_CONTRAST,
  gradientCss,
  gradientLine,
  inkReadsAcross,
  paletteGradients,
  readyGradientId,
  sameGradient,
} from "@/lib/storefront/gradients";
import {
  LEGACY_BACKGROUND_GRADIENTS,
  resolveBackgroundStyle,
} from "@/components/storefront/background-presets";
import { NEW_STOREFRONT_THEME, type StorefrontPalette } from "@/types/storefront";

const NEW_PALETTE = NEW_STOREFRONT_THEME.palette!;
/** A dark storefront: light words on a near-black board, an orange accent. */
const DARK: StorefrontPalette = {
  background: "#18181b",
  text: "#fafafa",
  accent: "#f97316",
  surface: "#27272a",
  muted: "#3f3f46",
};
/** A bright one, where the accent is light enough to carry dark words. */
const PEACH: StorefrontPalette = {
  background: "#fff7ed",
  text: "#1c1917",
  accent: "#fdba74",
  surface: "#ffffff",
  muted: "#fed7aa",
};

describe("gradientCss", () => {
  it("spells a two-stop gradient exactly as the background always did", () => {
    expect(gradientCss({ from: "#fef3c7", to: "#f97316", angle: 135 })).toBe(
      "linear-gradient(135deg, #fef3c7, #f97316)",
    );
  });
  it("adds the middle only when via is present", () => {
    expect(gradientCss({ from: "#fef3c7", via: "#fbbf24", to: "#f97316", angle: 0 })).toBe(
      "linear-gradient(0deg, #fef3c7, #fbbf24, #f97316)",
    );
  });
  it("refuses anything but strict hex, so no CSS can ride in on a stop", () => {
    expect(gradientCss({ from: "red", to: "#f97316", angle: 90 })).toBeNull();
    expect(gradientCss({ from: "#fef3c7", via: "#fff) , url(x", to: "#f97316", angle: 90 })).toBeNull();
    expect(gradientCss({ from: "#fef3c7", to: "#f97316", angle: Number.NaN })).toBeNull();
  });
});

describe("resolveBackgroundStyle (gradient)", () => {
  it("keeps every legacy preset's CSS byte for byte", () => {
    for (const legacy of Object.values(LEGACY_BACKGROUND_GRADIENTS)) {
      expect(resolveBackgroundStyle({ kind: "gradient", ...legacy })).toEqual({
        backgroundImage: `linear-gradient(${legacy.angle}deg, ${legacy.from}, ${legacy.to})`,
      });
    }
  });
  it("draws the third stop when one is stored", () => {
    expect(
      resolveBackgroundStyle({ kind: "gradient", from: "#ffffff", via: "#eeeeee", to: "#dddddd", angle: 160 }),
    ).toEqual({ backgroundImage: "linear-gradient(160deg, #ffffff, #eeeeee, #dddddd)" });
  });
});

describe("gradientLine", () => {
  it("runs the way CSS angles do in a square box", () => {
    expect(gradientLine(180)).toEqual({ x1: 50, y1: 0, x2: 50, y2: 100 });
    expect(gradientLine(90)).toEqual({ x1: 0, y1: 50, x2: 100, y2: 50 });
    expect(gradientLine(0)).toEqual({ x1: 50, y1: 100, x2: 50, y2: 0 });
  });
  it("lands the corners on the ends at a diagonal", () => {
    expect(gradientLine(135)).toEqual({ x1: 0, y1: 0, x2: 100, y2: 100 });
  });
});

describe("paletteGradients", () => {
  for (const [name, palette] of [["new storefront", NEW_PALETTE], ["dark", DARK], ["peach", PEACH]] as const) {
    it(`offers backdrops the board's words read on, each from the background (${name})`, () => {
      const offered = paletteGradients(palette, "backdrop");
      expect(offered.length).toBeGreaterThan(0);
      expect(offered.length).toBeLessThanOrEqual(5);
      for (const { fill } of offered) {
        expect(fill.from).toBe(palette.background);
        const ink = readableInkOn(fill.from);
        for (const stop of [fill.from, fill.via, fill.to].filter(Boolean) as string[]) {
          expect(contrastRatio(ink, stop)).toBeGreaterThanOrEqual(BACKDROP_GRADIENT_MIN_CONTRAST);
        }
      }
    });
    it(`offers at most five fills, none flat, none twice (${name})`, () => {
      const offered = paletteGradients(palette, "fill");
      expect(offered.length).toBeGreaterThan(0);
      expect(offered.length).toBeLessThanOrEqual(5);
      for (const [index, { fill }] of offered.entries()) {
        expect(new Set([fill.from, fill.via, fill.to].filter(Boolean)).size).toBeGreaterThan(1);
        expect(offered.slice(index + 1).some((other) => sameGradient(other.fill, fill))).toBe(false);
      }
    });
  }

  it("leaves out a backdrop the words would vanish on", () => {
    // Dark words on cream, and a near-black accent: "wash" would sink the words.
    const ids = paletteGradients(NEW_PALETTE, "backdrop").map((ready) => ready.id);
    expect(ids).not.toContain("wash");
    expect(inkReadsAcross({ from: NEW_PALETTE.background, to: NEW_PALETTE.accent, angle: 160 })).toBe(false);
    // ...and offers it where the accent is light enough to carry them.
    expect(paletteGradients(PEACH, "backdrop").map((ready) => ready.id)).toContain("wash");
  });

  it("drops a middle stop that only repeats an end", () => {
    // The new palette's accent IS its text colour, so "dusk" (muted, accent,
    // text) is a two-colour gradient.
    const dusk = paletteGradients(NEW_PALETTE, "fill").find((ready) => ready.id === "dusk");
    expect(dusk?.fill.via).toBeUndefined();
  });

  it("leaves out a fill whose colours a buyer could not tell apart", () => {
    // Near-black accent beside near-black words: "deep" would be a muddy solid.
    const grey: StorefrontPalette = { background: "#f4f4f5", text: "#171717", accent: "#0a0a0a", surface: "#ffffff", muted: "#d9d9da" };
    expect(paletteGradients(grey, "fill").map((ready) => ready.id)).not.toContain("deep");
    // ...while a page-wide backdrop may be faint on purpose.
    expect(paletteGradients(grey, "backdrop").map((ready) => ready.id)).toContain("light");
  });

  it("names the ready-made a stored gradient is, colour for colour", () => {
    const offered = paletteGradients(DARK, "fill");
    const first = offered[0];
    expect(readyGradientId({ ...first.fill, from: first.fill.from.toUpperCase() }, offered)).toBe(first.id);
    expect(readyGradientId({ ...first.fill, angle: first.fill.angle + 5 }, offered)).toBeNull();
    expect(readyGradientId(undefined, offered)).toBeNull();
  });
});

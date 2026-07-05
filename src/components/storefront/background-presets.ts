import type { CSSProperties } from "react";
import type { PatternPreset, StorefrontBackground } from "@/types/storefront";

// The ONLY place background CSS is defined. The config stores structured,
// validated data (hex colors, an integer angle, or a pattern KEY); this module
// turns it into known-safe CSS. The designer preview and the future embed must
// both resolve through here so they render identically.
//
// Raw color values are permitted in THIS file alone (like globals.css @theme):
// these are the pattern/token definitions for storefront canvases, not
// component-level literals. Patterns overlay a subtle neutral texture so a
// seller's tiles keep contrast on top of the chosen base color.

interface PatternDef {
  label: string;
  /** backgroundImage (+ size/position) applied over the base color. */
  style: CSSProperties;
}

export const PATTERN_STYLES: Record<PatternPreset, PatternDef> = {
  dots: {
    label: "Dots",
    style: {
      backgroundImage: "radial-gradient(rgba(0,0,0,0.14) 1.5px, transparent 1.6px)",
      backgroundSize: "16px 16px",
    },
  },
  grid: {
    label: "Grid",
    style: {
      backgroundImage:
        "linear-gradient(rgba(0,0,0,0.09) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.09) 1px, transparent 1px)",
      backgroundSize: "24px 24px",
    },
  },
  graph: {
    label: "Graph",
    style: {
      backgroundImage:
        "linear-gradient(rgba(0,0,0,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.06) 1px, transparent 1px)",
      backgroundSize: "10px 10px",
    },
  },
  diagonal: {
    label: "Diagonal",
    style: {
      backgroundImage:
        "repeating-linear-gradient(45deg, rgba(0,0,0,0.07) 0, rgba(0,0,0,0.07) 1px, transparent 1px, transparent 12px)",
    },
  },
  crosshatch: {
    label: "Crosshatch",
    style: {
      backgroundImage:
        "repeating-linear-gradient(45deg, rgba(0,0,0,0.06) 0, rgba(0,0,0,0.06) 1px, transparent 1px, transparent 10px), repeating-linear-gradient(-45deg, rgba(0,0,0,0.06) 0, rgba(0,0,0,0.06) 1px, transparent 1px, transparent 10px)",
    },
  },
  checker: {
    label: "Checker",
    style: {
      backgroundImage:
        "repeating-conic-gradient(rgba(0,0,0,0.05) 0% 25%, transparent 0% 50%)",
      backgroundSize: "28px 28px",
    },
  },
};

/**
 * Legacy v1 preset keys (stored as a bare string) → an equivalent gradient, so
 * old saved storefronts upgrade cleanly to the structured background model.
 */
export const LEGACY_BACKGROUND_GRADIENTS: Record<
  string,
  { from: string; to: string; angle: number }
> = {
  linen: { from: "#fafaf9", to: "#f3efe7", angle: 180 },
  mist: { from: "#f8fafc", to: "#e7edf4", angle: 180 },
  blush: { from: "#fdf2f8", to: "#fbe3ef", angle: 160 },
  sage: { from: "#f3faf3", to: "#dfeede", angle: 160 },
  sky: { from: "#f0f9ff", to: "#dcebfb", angle: 160 },
  lilac: { from: "#faf5ff", to: "#ebe6fa", angle: 160 },
  sand: { from: "#fffbeb", to: "#faeec9", angle: 160 },
  ink: { from: "#18181b", to: "#27272a", angle: 160 },
};

/**
 * Resolve a structured `theme.background` into a style object. All inputs are
 * schema-validated (strict hex, integer angle, allowlisted pattern key), so the
 * produced CSS is always safe to place in a style attribute.
 */
export function resolveBackgroundStyle(
  background: StorefrontBackground,
): CSSProperties {
  switch (background.kind) {
    case "solid":
      return { backgroundColor: background.color };
    case "gradient":
      return {
        backgroundImage: `linear-gradient(${background.angle}deg, ${background.from}, ${background.to})`,
      };
    case "pattern":
      return {
        backgroundColor: background.color,
        ...PATTERN_STYLES[background.preset].style,
      };
  }
}

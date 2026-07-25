import type { CSSProperties } from "react";
import type { StorefrontBackground } from "@/types/storefront";

// The ONLY place background CSS is defined. The config stores structured,
// validated data (hex colors, an integer angle, or an image object key); this
// module turns it into known-safe CSS. The designer preview and the future
// embed must both resolve through here so they render identically.
//
// Raw color values are permitted in THIS file alone (like globals.css @theme):
// these are token definitions for storefront canvases, not component-level
// literals.

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

/** Neutral base behind image backgrounds (gaps while panning/zooming, and the
 *  fallback when no display URL is available, e.g. static list previews). */
const IMAGE_BACKGROUND_BASE = "#f5f5f5";

/**
 * Resolve a structured `theme.background` into a style object. All inputs are
 * schema-validated (strict hex, integer angle, shape-checked object key), so
 * the produced CSS is always safe to place in a style attribute.
 *
 * The image kind stores only an object KEY; callers pass the display URL
 * separately (`imageUrl`), signed server-side or a local object URL for a
 * just-uploaded file. It is never user-typed text: without one the image
 * background degrades to the neutral base color.
 */
export function resolveBackgroundStyle(
  background: StorefrontBackground,
  imageUrl?: string | null,
): CSSProperties {
  switch (background.kind) {
    case "solid":
      return { backgroundColor: background.color };
    case "gradient":
      return {
        backgroundImage: `linear-gradient(${background.angle}deg, ${background.from}, ${background.to})`,
      };
    case "image": {
      if (!imageUrl) return { backgroundColor: IMAGE_BACKGROUND_BASE };
      // Quotes cannot appear in signed R2 / blob: URLs, but escape defensively
      // so the url() literal can never be broken out of.
      const safeUrl = imageUrl.replace(/["\\]/g, encodeURIComponent);
      return {
        backgroundColor: IMAGE_BACKGROUND_BASE,
        backgroundImage: `url("${safeUrl}")`,
        backgroundSize: `${background.scale}% auto`,
        backgroundPosition: `${background.x}% ${background.y}%`,
        backgroundRepeat: "no-repeat",
      };
    }
  }
}

import type { CSSProperties } from "react";
import { isLightColor } from "@/lib/format/color";
import type {
  ProductPageConfig,
  ProductPagePriceNote,
  ProductPageShippingNote,
  StorefrontTheme,
} from "@/types/storefront";

// Enum-to-presentation lookups for the product page, in the same spirit as
// components/storefront/config-maps.ts: every stored value is a closed token,
// and this file is the only place a token becomes a class or a style. Nothing
// here reads free-form CSS out of the config, because the config cannot hold
// any.

// CONTAINER queries, not viewport ones: the page root is an `@container`, so
// the editor's phone-width preview frame stacks exactly as a phone would while
// the public page (whose container is the viewport) behaves as usual. @3xl is
// 48rem of the page's own width.

// The three layout class maps that lived here are gone with the layout
// option: the page has one arrangement, written where it is used.

export const PRICE_NOTE_LABELS: Record<ProductPagePriceNote, string> = {
  "incl-vat": "incl. VAT",
  "excl-vat": "excl. tax",
  none: "",
};

export const SHIPPING_NOTE_LABELS: Record<ProductPageShippingNote, string> = {
  "plus-shipping": "plus shipping",
  "free-shipping": "free shipping",
  none: "",
};

export const DARK_INK = "#171717";
export const LIGHT_INK = "#ffffff";

/** The ink that reads on a given fill. */
export function readableOn(hex: string): string {
  return isLightColor(hex) ? DARK_INK : LIGHT_INK;
}

/**
 * The page's text colour: whichever ink reads on the storefront background (an
 * image background gets light ink, the usual choice over a photo).
 *
 * DERIVED, never chosen. The page sits directly on the storefront background,
 * so the only question is which of two inks is legible on it, and lightness
 * answers that. The manual override this used to accept could only ever pick
 * something harder to read than the automatic answer.
 *
 * `productPage` is still taken so callers keep one call shape; it no longer
 * carries anything this reads.
 */
export function resolveInk(theme: StorefrontTheme, _productPage?: ProductPageConfig): string {
  switch (theme.background.kind) {
    case "solid":
      return readableOn(theme.background.color);
    case "gradient":
      return readableOn(theme.background.from);
    case "image":
      return LIGHT_INK;
  }
}

/** Corner radius for the page's large surfaces (card, images). The tile
 *  radius runs to 100 (a circle); a page never wants more than a soft card. */
export function surfaceRadius(cornerRadius: number): number {
  return Math.min(Math.max(cornerRadius, 0), 24);
}

/** Corner radius for controls (buttons, swatches, thumbnails). */
export function controlRadius(cornerRadius: number): number {
  return Math.min(Math.max(cornerRadius, 0), 16);
}

/**
 * Inline style for the buy button.
 *
 * "accent" is the only one the page asks for now; "outline" survives because
 * the editor draws an outlined ghost when no purchase link is set yet, and
 * "ink" because both are one line each and the switch is exhaustive.
 */
export function ctaStyle(
  style: "accent" | "ink" | "outline",
  accent: string,
  ink: string,
  cornerRadius: number,
): CSSProperties {
  const radius = `${controlRadius(cornerRadius)}px`;
  switch (style) {
    case "accent":
      return { backgroundColor: accent, color: readableOn(accent), borderRadius: radius };
    case "ink":
      return { backgroundColor: ink, color: readableOn(ink), borderRadius: radius };
    case "outline":
      return {
        backgroundColor: "transparent",
        color: ink,
        borderRadius: radius,
        boxShadow: `inset 0 0 0 2px ${ink}`,
      };
  }
}

/** Translucent chip fill that sits on either ink. */
export function chipStyle(ink: string, cornerRadius: number): CSSProperties {
  return {
    backgroundColor: ink === LIGHT_INK ? "rgba(255,255,255,0.14)" : "rgba(23,23,23,0.06)",
    color: ink,
    borderRadius: `${controlRadius(cornerRadius)}px`,
  };
}

/** Hairline colour that reads on either ink. */
export function ruleColor(ink: string): string {
  return ink === LIGHT_INK ? "rgba(255,255,255,0.22)" : "rgba(23,23,23,0.12)";
}

/** The first sentence of a policy, for the trust line under the button. */
export function firstSentence(text: string | undefined, max = 110): string | null {
  if (!text) return null;
  const firstLine = text.split(/\r?\n/).find((line) => line.trim()) ?? "";
  const match = /^[^.!?]*[.!?]?/.exec(firstLine.trim());
  const sentence = (match?.[0] ?? firstLine).trim();
  if (!sentence) return null;
  return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence;
}

/** Plain text to paragraphs: blank lines split, single newlines stay. */
export function paragraphs(text: string): string[] {
  return text
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

import type { CSSProperties } from "react";
import { isLightColor } from "@/lib/format/color";
import {
  PRODUCT_PAGE_CTA_RADIUS_MAX,
  type ProductPageConfig,
  type ProductPagePriceNote,
  type ProductPageShippingNote,
  type StorefrontTheme,
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
 * A hex standing in for the storefront's background, whatever kind it is.
 *
 * Needed wherever a single colour has to represent the backdrop: the ink
 * decision below, and the inherit dot on the page's own background control,
 * which has to show a seller what following the storefront currently gets
 * them. A gradient answers with the colour it starts from; an IMAGE answers
 * with dark, matching the light ink a photo backdrop has always been given —
 * a photograph averages to something no swatch can honestly show, and
 * assuming it is busy is the safe direction for a legibility decision.
 */
export function storefrontBackdropHex(theme: Pick<StorefrontTheme, "background">): string {
  switch (theme.background.kind) {
    case "solid":
      return theme.background.color;
    case "gradient":
      return theme.background.from;
    case "image":
      return DARK_INK;
  }
}

/**
 * The page's text colour: whichever ink reads on whatever the page sits on.
 *
 * DERIVED, never chosen — and that is what lets the backdrop BE chosen. The
 * page's own `backgroundColor` wins when it has one, else the storefront's
 * background answers; either way the only question is which of two inks is
 * legible, and lightness answers it. The manual text-colour override this used
 * to accept could only ever pick something harder to read than the automatic
 * answer, which is why it is gone and is not coming back with this.
 */
export function resolveInk(
  theme: Pick<StorefrontTheme, "background">,
  productPage?: Pick<ProductPageConfig, "backgroundColor">,
): string {
  // One path for all four backdrops: an image resolves to dark above, which
  // is exactly how it earns the light ink it has always been given.
  return readableOn(productPage?.backgroundColor ?? storefrontBackdropHex(theme));
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
 * WHAT THE BUY BUTTON ACTUALLY PAINTS, resolved in one place.
 *
 * Four of the five values are stored optional, and absent means "follow the
 * storefront" (ProductPageConfig says why). Something has to turn that into
 * concrete pixels, and it must be the same something everywhere: the buyer's
 * page, the editor's artboard, the panel's own inherit dots and the JSON an
 * agent reads back all ask this function, so none of them can describe the
 * button differently from the one a buyer sees.
 *
 * The label's ink is not a stored field at all — it is whichever of the two
 * inks reads on the fill, so a seller cannot pick a yellow button with white
 * words on it.
 */
export type CtaAppearance = {
  /** The button's fill. */
  fill: string;
  /** The label's ink, derived from `fill`. */
  text: string;
  /** Corner roundness in px. */
  radius: number;
  /** Outline thickness in px; 0 = no outline. */
  borderWidth: number;
  /** Outline colour. Meaningless while `borderWidth` is 0, and resolved
   *  regardless so the panel's inherit dot has something to show. */
  borderColor: string;
};

export function resolveCta(
  productPage: Pick<
    ProductPageConfig,
    "ctaColor" | "ctaRadius" | "ctaBorderWidth" | "ctaBorderColor"
  >,
  theme: Pick<StorefrontTheme, "accent" | "cornerRadius">,
): CtaAppearance {
  const fill = productPage.ctaColor ?? theme.accent;
  const text = readableOn(fill);
  return {
    fill,
    text,
    // A chosen roundness is the seller's own number, only bounded; an
    // INHERITED one goes through controlRadius first, because the tile
    // roundness it comes from runs all the way to a circle and a button has
    // no such shape to take.
    radius:
      productPage.ctaRadius === undefined
        ? controlRadius(theme.cornerRadius)
        : Math.min(Math.max(productPage.ctaRadius, 0), PRODUCT_PAGE_CTA_RADIUS_MAX),
    borderWidth: productPage.ctaBorderWidth ?? 0,
    // The label's own ink by default: an outline the same colour as the words
    // reads as one deliberate object rather than as a second decision the
    // seller forgot to make.
    borderColor: productPage.ctaBorderColor ?? text,
  };
}

/** Inline style for the buy button. The outline is drawn INSIDE the box (an
 *  inset shadow, like the price tag's) so turning it on never resizes the
 *  button or shifts the words inside it. */
export function ctaStyle(cta: CtaAppearance): CSSProperties {
  return {
    backgroundColor: cta.fill,
    color: cta.text,
    borderRadius: `${cta.radius}px`,
    ...(cta.borderWidth > 0
      ? { boxShadow: `inset 0 0 0 ${cta.borderWidth}px ${cta.borderColor}` }
      : {}),
  };
}

/**
 * The editor's ghost button: what a page with nowhere to send a buyer draws.
 *
 * Deliberately NOT the seller's colours. It is the absence of a destination
 * being reported, so it takes the page's ink and the button's shape and
 * nothing else — a fully styled button that does nothing would look finished.
 */
export function ctaGhostStyle(cta: CtaAppearance, ink: string): CSSProperties {
  return {
    backgroundColor: "transparent",
    color: ink,
    borderRadius: `${cta.radius}px`,
    boxShadow: `inset 0 0 0 2px ${ink}`,
  };
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

/** A barely-there fill in the page's own ink: the chosen chip, a hovered menu
 *  row. Grey by construction — the ink over the backdrop — so it belongs to
 *  whatever the seller picked without introducing a colour of its own. */
export function subtleFill(ink: string): string {
  return ink === LIGHT_INK ? "rgba(255,255,255,0.14)" : "rgba(23,23,23,0.06)";
}

/**
 * THE STOREFRONT, EXPRESSED AS THE APP'S OWN DESIGN TOKENS.
 *
 * The product page's dropdown is the dashboard's dropdown: the same
 * `fieldBaseClass`, `overlaySurfaceClass` and `overlayItemClass` every menu in
 * the app wears (components/ui/control-styles.ts). Those classes are written
 * entirely in semantic tokens — `bg-popover`, `border-input`, `hover:bg-accent`
 * — and a token is a CSS variable, so re-pointing the variables on a wrapper
 * re-skins the shared control without forking it. This function is that
 * re-pointing, and it is the only place the product page says what a menu
 * looks like.
 *
 * IT FOLLOWS THE PAGE'S BACKGROUND, which is what `ink` already answers for:
 * resolveInk reads the page's own colour (or the storefront's, or "dark" for a
 * photo) and returns the one that reads on it. So a dark shop opens a dark
 * menu and a light shop a light one — never a white card punched into a black
 * page.
 *
 * WHITE, GREY AND BLACK, and nothing else. The two inks are the only literals;
 * every grey is one of them at low alpha over the other, so the ramp cannot
 * drift into a colour and there is no second palette to keep in step.
 *
 * `--radius-sm` carries the seller's own corner radius, so the trigger and the
 * panel round together and match the chips and the buy button beside them.
 * This is the one place the app's sharp-panel brand rule is deliberately not
 * ours to keep: the surface belongs to the seller's shop, not to the dashboard.
 */
export function storefrontOverlayVars(ink: string, cornerRadius: number): CSSProperties {
  const onDark = ink === LIGHT_INK;
  const surface = onDark ? DARK_INK : LIGHT_INK;
  return {
    // The panel and its text.
    "--popover": surface,
    "--popover-foreground": ink,
    "--foreground": ink,
    // Hairlines: the field's border and the panel's edge, one value so they
    // cannot disagree.
    "--border": ruleColor(ink),
    "--input": ruleColor(ink),
    // The hovered/active row.
    "--accent": subtleFill(ink),
    "--accent-foreground": ink,
    // Secondary text inside the panel. The ink again, just quieter.
    "--muted-foreground": onDark ? "rgba(255,255,255,0.65)" : "rgba(23,23,23,0.60)",
    // The trigger sits ON the page, so it shows whatever is behind it — a
    // gradient, a photograph — rather than punching a panel-coloured hole. It
    // is also what the focus ring offsets against.
    "--background": "transparent",
    "--ring": ink,
    "--radius-sm": `${controlRadius(cornerRadius)}px`,
  } as CSSProperties;
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

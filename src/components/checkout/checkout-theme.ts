import type { CSSProperties } from "react";
import { resolveBackgroundStyle } from "@/components/storefront/background-presets";
import {
  controlRadius,
  readableOn,
  resolveCta,
  resolveInk,
  ruleColor,
  storefrontBackdropHex,
  surfaceRadius,
  type CtaAppearance,
} from "@/components/product-page/product-page-maps";
import type { CheckoutStorefront } from "@/types/checkout";

/**
 * WHAT THE CHECKOUT PAINTS, resolved in one place: the checkout page, the
 * thank-you page and the editor's artboards all ask this, so none of them can
 * disagree about a colour. (When Stripe's payment fields arrive they are
 * themed from this same object, so the card fields wear it too.)
 *
 * INHERITANCE runs checkout → product page → storefront, and every step is a
 * value the seller already chose somewhere:
 *   - the SURFACE a buyer reads and types on is always a solid colour: the
 *     checkout's own, else the product page's, else the one colour that stands
 *     for the storefront's background. A form over a photograph is a form
 *     nobody can read, so a photo-backed store gets a calm solid page and
 *     keeps its photograph for the showcase panel instead;
 *   - the SHOWCASE panel wears the storefront's whole background, gradient or
 *     photograph included, because that panel is looked at, not read;
 *   - the pay button IS the product page's buy button (resolveCta), so "Buy
 *     now" and "Pay" are one action in one colour.
 * Inks are derived from whatever they sit on, never chosen.
 */
export type CheckoutTheme = {
  /** The page and form surface (a hex). */
  surface: string;
  /** Text on the surface. */
  ink: string;
  /** Hairlines on the surface. */
  rule: string;
  /** Large surfaces: panels, photos. */
  surfaceRadius: number;
  /** The storefront's corner radius, for controls (storefrontOverlayVars
   *  bounds it). */
  cornerRadius: number;
  /** Controls: fields, chips, thumbnails. */
  controlRadius: number;
  /** The pay button. */
  cta: CtaAppearance;
  /** The showcase panel's own backdrop, and the ink that reads on it. */
  panelStyle: CSSProperties;
  panelInk: string;
  panelRule: string;
  /** Whether the panel would be indistinguishable from the page around it,
   *  in which case it takes a hairline edge instead. */
  panelMatchesSurface: boolean;
};

export function resolveCheckoutTheme(storefront: CheckoutStorefront): CheckoutTheme {
  const { theme, productPage, checkoutPage } = storefront;
  const storefrontHex = storefrontBackdropHex(theme);
  const surface = checkoutPage.backgroundColor ?? productPage.backgroundColor ?? storefrontHex;
  const ink = readableOn(surface);
  const panelInk = resolveInk(theme);
  return {
    surface,
    ink,
    rule: ruleColor(ink),
    surfaceRadius: surfaceRadius(theme.cornerRadius),
    cornerRadius: theme.cornerRadius,
    controlRadius: controlRadius(theme.cornerRadius),
    cta: resolveCta(productPage, theme),
    panelStyle: resolveBackgroundStyle(theme.background, storefront.backgroundImageUrl),
    panelInk,
    panelRule: ruleColor(panelInk),
    panelMatchesSurface:
      theme.background.kind === "solid" && theme.background.color.toLowerCase() === surface.toLowerCase(),
  };
}

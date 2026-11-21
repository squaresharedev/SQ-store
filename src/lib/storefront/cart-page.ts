import { DEFAULT_CART_PAGE_CONFIG, type CartPageConfig, type StorefrontConfig } from "@/types/storefront";

// Pure helpers for the cart's config. Client-safe: the designer, the buyer's
// pages and the cart routes all answer "what does an absent field mean" here,
// as lib/storefront/checkout-page.ts does for the checkout.

/** The cart's options for a config. Every member is optional and absent means
 *  the default, so this is the stored member or the (empty) defaults. */
export function resolveCartPage(config: Pick<StorefrontConfig, "cartPage">): CartPageConfig {
  return config.cartPage ?? DEFAULT_CART_PAGE_CONFIG;
}

/** Whether buyers on this storefront get a cart: on unless switched off. Our
 *  checkout must also be offered (lib/checkout/availability.ts); this is only
 *  the seller's switch. */
export function cartSwitchedOn(config: Pick<StorefrontConfig, "cartPage">): boolean {
  return resolveCartPage(config).enabled !== false;
}

/** A cart switched off: what a surface draws where buyers have no cart (the
 *  designer before the cart is launched, a preview with no config). */
export const CART_SWITCHED_OFF: CartPageConfig = { enabled: false };

/** Whether a cart config is all defaults, so it stays absent from the saved
 *  jsonb. Absent keys are the defaults; `undefined` ones count as absent. */
export function isDefaultCartPage(config: CartPageConfig): boolean {
  return Object.values(config).every((value) => value === undefined);
}

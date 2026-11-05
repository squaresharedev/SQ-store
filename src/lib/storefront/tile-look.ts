import { resolveCta, type CtaAppearance } from "@/components/product-page/product-page-maps";
import { isProductPageSectionShown, resolveProductPage } from "@/lib/storefront/product-page";
import {
  DEFAULT_PRODUCT_PAGE_STAR_COLOR,
  type StorefrontConfig,
  type StorefrontTheme,
} from "@/types/storefront";

/**
 * WHAT A CARD BORROWS FROM THE PRODUCT PAGE, resolved once per board.
 *
 * A card's buy button is the product page's button in small (its words, its
 * colour, its roundness), and a card's stars are the page's stars, so a buyer
 * who taps one sees the same thing get bigger rather than a second design.
 * Every board asks this one function (the designer, the buyer's page, the
 * embed and the assistant's preview), so none of them can draw a card button
 * the page does not have.
 */
export type TileLook = {
  /** The product page button's words (ctaLabel), the seller's own. */
  buyLabel: string;
  /** Its fill, ink, roundness and outline (resolveCta). */
  buy: CtaAppearance;
  /** The page's star colour. */
  starColor: string;
  /** Whether the page shows reviews at all. A card shows no stars without
   *  it: a rating a buyer could not go and read would be a claim, not a
   *  summary. */
  reviewsShown: boolean;
};

export function resolveTileLook(
  config: Pick<StorefrontConfig, "productPage"> & { theme: StorefrontTheme },
): TileLook {
  const productPage = resolveProductPage(config);
  return {
    buyLabel: productPage.ctaLabel,
    buy: resolveCta(productPage, config.theme),
    starColor: productPage.starColor ?? DEFAULT_PRODUCT_PAGE_STAR_COLOR,
    reviewsShown: isProductPageSectionShown(productPage, "reviews"),
  };
}

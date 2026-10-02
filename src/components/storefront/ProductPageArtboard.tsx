"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { CheckoutNodeIcon } from "./page-node-icons";
import { ArtboardFrame } from "./ArtboardFrame";
import type { PreviewDevice } from "./DeviceSizeSwitch";
import { usePreviewProduct } from "./usePreviewProduct";
import { ProductPageView } from "@/components/product-page/ProductPageView";
import { PRODUCT_PAGE_HOTSPOTS, isProductPageHotspot } from "@/lib/storefront/setting-ref";
import type { Product } from "@/types/product";
import type { ProductPageData } from "@/types/product-page";
import type { SellerShippingPolicy } from "@/types/shipping-policy";
import type {
  ProductPageConfig,
  StorefrontHeader,
  StorefrontSeller,
  StorefrontTheme,
} from "@/types/storefront";

/**
 * ONE PRODUCT'S PAGE, as an artboard on the storefront canvas (the frame, the
 * scaling and click-to-setting are ArtboardFrame's; see there).
 *
 * A product page is not a different place, it is what a tile leads to, which
 * is why it is an artboard beside the board rather than a mode the editor
 * switches into. And a product page leads somewhere in turn: its chrome
 * carries a CHECKOUT node that puts the checkout and thank-you artboards out
 * beside it, chained on, so the seller can design the whole way from tile to
 * thank-you in one view.
 */
export function ProductPageArtboard({
  product,
  soldOut,
  storefrontId,
  storefrontName,
  theme,
  header,
  productPage,
  shippingPolicy,
  seller,
  backgroundImageUrl,
  customFontUrl,
  pagePhotoUrl,
  onClose,
  widths,
  initialDevice,
  checkoutOpen = false,
  onToggleCheckout,
}: {
  /** The product this page is for; from the editor's catalogue snapshot. */
  product: Product;
  /** The tile's manual sold-out flag, which is live in the editor. */
  soldOut: boolean;
  storefrontId: string;
  storefrontName: string;
  theme: StorefrontTheme;
  header: StorefrontHeader;
  productPage: ProductPageConfig;
  shippingPolicy: SellerShippingPolicy;
  seller: StorefrontSeller;
  backgroundImageUrl: string | null;
  customFontUrl: string | null;
  /** Display URL of this page's own photo backdrop, when it has one. */
  pagePhotoUrl: string | null;
  onClose: () => void;
  widths: Record<PreviewDevice, number>;
  initialDevice: PreviewDevice;
  /** Whether this product's checkout is out on the canvas. */
  checkoutOpen?: boolean;
  /** Put this product's checkout out beside the page, or take it back. */
  onToggleCheckout?: () => void;
}) {
  const t = useTranslations("Storefront.artboard");
  const previewed = usePreviewProduct(product, productPage.showStock, soldOut);

  const page: ProductPageData = {
    storefront: {
      id: storefrontId,
      name: storefrontName,
      theme,
      header,
      productPage,
      shippingPolicy,
      seller,
      backgroundImageUrl,
      customFontUrl,
      pagePhotoUrl,
    },
    product: previewed,
    productUrl: "",
  };

  return (
    <ArtboardFrame
      artboardId={product.id}
      title={product.title}
      kindLabel={t("productPageLabel")}
      closeLabel={t("closeAriaLabel", { title: product.title })}
      onClose={onClose}
      widths={widths}
      initialDevice={initialDevice}
      resolveHotspot={(name) => (isProductPageHotspot(name) ? PRODUCT_PAGE_HOTSPOTS[name] : null)}
      actions={
        onToggleCheckout && (
          <button
            type="button"
            onClick={onToggleCheckout}
            aria-pressed={checkoutOpen}
            aria-label={t("openCheckoutAriaLabel", { title: product.title })}
            title={t("openCheckoutAriaLabel", { title: product.title })}
            className={cn(
              "flex h-7 shrink-0 items-center gap-1.5 rounded-sm border px-2 font-inter text-xs font-medium transition-colors duration-base ease-standard",
              checkoutOpen
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-background text-muted-foreground hover:text-foreground",
            )}
            data-checkout-node={checkoutOpen ? "open" : "closed"}
          >
            <CheckoutNodeIcon className="size-3.5" strokeWidth={2} aria-hidden="true" />
            {t("openCheckout")}
          </button>
        )
      }
    >
      <ProductPageView page={page} mode="preview" />
    </ArtboardFrame>
  );
}

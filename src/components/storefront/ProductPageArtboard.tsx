"use client";

import { useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { iconNudgeRightClass } from "@/components/ui/control-styles";
import { cn } from "@/lib/utils";
import { ArtboardFrame } from "./ArtboardFrame";
import type { PreviewDevice } from "./DeviceSizeSwitch";
import { usePreviewProduct } from "./usePreviewProduct";
import { usePreviewReviews } from "./usePreviewReviews";
import { isProductPageSectionShown } from "@/lib/storefront/product-page";
import { ProductPageView } from "@/components/product-page/ProductPageView";
import { BadgeMoveProvider } from "@/components/product-page/BadgeDrag";
import { useActionErrorToast } from "@/components/ui/ActionErrorNotice";
import { useToast } from "@/components/ui/Toast";
import { canPlaceBadge, withBadgePlacement } from "@/lib/products/badges";
import { moveProductBadge } from "@/lib/products/badge-actions";
import { useSampleMode } from "@/lib/storefront/sample-mode";
import { badgeLabelKey } from "@/lib/validation/product";
import { PRODUCT_PAGE_HOTSPOTS, isProductPageHotspot } from "@/lib/storefront/setting-ref";
import { BADGES_ON_PHOTO_MAX, type BadgePlacement, type Product, type ProductBadge } from "@/types/product";
import type { PagePhotoView, ProductPageData } from "@/types/product-page";
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
  pagePhoto,
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
  pagePhoto: PagePhotoView | null;
  onClose: () => void;
  widths: Record<PreviewDevice, number>;
  initialDevice: PreviewDevice;
  /** Whether this product's checkout is out on the canvas. */
  checkoutOpen?: boolean;
  /** Put this product's checkout out beside the page, or take it back. */
  onToggleCheckout?: () => void;
}) {
  const t = useTranslations("Storefront.artboard");
  const tBadges = useTranslations("Products.badgesField");
  const toast = useToast();
  const showActionError = useActionErrorToast();
  const sample = useSampleMode();
  const loaded = usePreviewProduct(product, productPage.showStock, soldOut);
  // The product's real reviews, read only while the section is switched on.
  const reviews = usePreviewReviews(
    product.id,
    isProductPageSectionShown(productPage, "reviews"),
  );

  // THE BADGES, MOVABLE HERE. A badge dragged to another place on this page
  // moves at once and is saved behind it (the product's own field, the same
  // one the product form's drag writes); a refused save puts it back. The
  // sample storefront's products exist only in code, so there it only moves.
  const [movedBadges, setMovedBadges] = useState<ProductBadge[] | null>(null);
  const badges = movedBadges ?? loaded.details.badges ?? [];
  const previewed = movedBadges
    ? { ...loaded, details: { ...loaded.details, badges: movedBadges } }
    : loaded;
  const byLabel = (label: string) => badges.find((badge) => badgeLabelKey(badge.label) === badgeLabelKey(label));

  function canPlace(label: string, placement: BadgePlacement) {
    const badge = byLabel(label);
    return badge ? canPlaceBadge(badges, badge, placement) : false;
  }

  const badgeCopy = useMemo(
    () => ({ hint: tBadges("preview.hint"), beside: tBadges("beside") }),
    [tBadges],
  );

  async function placeBadge(label: string, placement: BadgePlacement) {
    const before = badges;
    setMovedBadges(withBadgePlacement(before, label, placement));
    if (sample) return;
    const result = await moveProductBadge(product.id, label, placement).catch(() => null);
    if (result?.ok) {
      setMovedBadges(result.badges);
      return;
    }
    setMovedBadges(before);
    if (result) showActionError(result.error);
  }

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
      pagePhoto,
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
              // A trailing arrow, nudged on hover: this opens something.
              "group/btn flex h-7 shrink-0 items-center gap-1.5 rounded-sm border px-2 font-inter text-xs font-medium transition-colors duration-base ease-standard",
              checkoutOpen
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-background text-muted-foreground hover:text-foreground",
            )}
            data-checkout-node={checkoutOpen ? "open" : "closed"}
          >
            {t("openCheckout")}
            <ArrowRight className={cn("size-3.5", iconNudgeRightClass)} strokeWidth={2} aria-hidden="true" />
          </button>
        )
      }
    >
      <BadgeMoveProvider
        canPlace={canPlace}
        onPlace={placeBadge}
        onRefused={() => toast.error(tBadges("photoFull", { max: BADGES_ON_PHOTO_MAX }))}
        copy={badgeCopy}
      >
        <ProductPageView page={page} mode="preview" reviews={reviews} />
      </BadgeMoveProvider>
    </ArtboardFrame>
  );
}

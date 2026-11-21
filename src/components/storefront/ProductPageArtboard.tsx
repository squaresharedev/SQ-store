"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ArtboardFrame } from "./ArtboardFrame";
import type { PreviewDevice } from "./DeviceSizeSwitch";
import { useProductAddOnsEditor } from "./ProductAddOnsEditor";
import { usePreviewAddOns, usePreviewProduct } from "./usePreviewProduct";
import { usePreviewReviews } from "./usePreviewReviews";
import { isProductPageSectionShown } from "@/lib/storefront/product-page";
import { ProductPageView } from "@/components/product-page/ProductPageView";
import { BadgeDropZone, BadgeMoveProvider } from "@/components/product-page/BadgeDrag";
import { CartEditProvider } from "@/components/checkout/EditableTextProviders";
import { sampleCartProducts, sampleCartView, sampleFromPageProduct, sampleFromProduct } from "@/lib/cart/sample";
import { freeOverCentsIn } from "@/lib/shipping/rates";
import { useActionErrorToast } from "@/components/ui/ActionErrorNotice";
import { useToast } from "@/components/ui/Toast";
import { canPlaceBadge, withBadgePlacement } from "@/lib/products/badges";
import { moveProductBadge } from "@/lib/products/badge-actions";
import { useSampleMode } from "@/lib/storefront/sample-mode";
import { badgeLabelKey } from "@/lib/validation/product";
import { productPagePath } from "@/lib/storefront/product-page-url";
import { PRODUCT_PAGE_HOTSPOTS, isProductPageHotspot } from "@/lib/storefront/setting-ref";
import { BADGES_ON_PHOTO_MAX, type BadgePlacement, type Product, type ProductBadge } from "@/types/product";
import type { PagePhotoView, ProductPageData } from "@/types/product-page";
import type { SellerShippingPolicy } from "@/types/shipping-policy";
import type {
  CartPageConfig,
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
 * switches into. And a product page leads somewhere in turn: the checkout and
 * thank-you artboards come out beside it, chained on (see DesignerCanvas), so
 * the seller can design the whole way from tile to thank-you in one view.
 *
 * THE CART OPENS ON IT, as it opens for a buyer, FULL: a sample of the
 * seller's own products (this one, then the board's others a card puts
 * straight in the cart, with "Goes well with" from this product's own picks;
 * lib/cart/sample.ts). Its steppers, remove and Add to cart all play on the
 * page; its heading and note are typed straight onto it; a click anywhere
 * else on it opens the Cart settings. Whether it is open is the designer's
 * (it opens it from the Cart settings), so only one page has it open.
 */
export function ProductPageArtboard({
  product,
  soldOut,
  storefrontId,
  storefrontName,
  theme,
  header,
  productPage,
  cartPage,
  shippingPolicy,
  seller,
  backgroundImageUrl,
  customFontUrl,
  pagePhoto,
  onClose,
  widths,
  initialDevice,
  boardProducts = [],
  cartOpen = false,
  onCartOpenChange,
  onCartPageChange,
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
  /** The cart's design; its buttons show while it is on. */
  cartPage?: CartPageConfig;
  shippingPolicy: SellerShippingPolicy;
  seller: StorefrontSeller;
  backgroundImageUrl: string | null;
  customFontUrl: string | null;
  /** Display URL of this page's own photo backdrop, when it has one. */
  pagePhoto: PagePhotoView | null;
  onClose: () => void;
  widths: Record<PreviewDevice, number>;
  initialDevice: PreviewDevice;
  /** The board's products, in board order: what the sample cart is made of. */
  boardProducts?: readonly Product[];
  /** Whether this page's cart is open; held by the designer. */
  cartOpen?: boolean;
  onCartOpenChange?: (open: boolean) => void;
  /** Writes the cart's words typed onto it. */
  onCartPageChange?: (next: CartPageConfig) => void;
}) {
  const t = useTranslations("Storefront.artboard");
  const tBadges = useTranslations("Products.badgesField");
  const toast = useToast();
  const showActionError = useActionErrorToast();
  const sample = useSampleMode();
  const loaded = usePreviewProduct(product, productPage.showStock, soldOut);
  // What a buyer would be offered beside it (and what was chosen but is not),
  // from the same preview load, until the seller changes it in the panel
  // beside this page. A tile's add-ons each have a page on this storefront
  // (lib/products/purchasable.ts), which their details link to.
  const previewAddOns = usePreviewAddOns(product.id, productPage.showStock);
  const addOnsEditor = useProductAddOnsEditor();
  const shownAddOns = addOnsEditor?.edits[product.id] ?? previewAddOns;
  const addOns = useMemo(
    () => shownAddOns.cards.map((card) => ({ ...card, pagePath: productPagePath(storefrontId, card.id) })),
    [shownAddOns.cards, storefrontId],
  );
  // THE SAMPLE CART. Keyed by what it is made of rather than by the page's
  // product object (rebuilt on many renders), so steps the seller took in it
  // last until the sample itself changes.
  const cartShown = cartPage !== undefined && cartPage.enabled !== false;
  const imageUrl = loaded.images[0]?.url;
  const imageAlt = loaded.images[0]?.alt;
  const sampleCart = useMemo(() => {
    if (!cartShown) return null;
    const onScreen = {
      id: loaded.id,
      title: loaded.title,
      priceCents: loaded.priceCents,
      regularPriceCents: loaded.sale?.regularPriceCents ?? null,
      currency: loaded.currency,
      image: imageUrl ? { url: imageUrl, alt: imageAlt ?? loaded.title } : null,
    };
    const board = boardProducts.map((entry) => ({ ...sampleFromProduct(entry), addable: entry.quickAdd !== undefined }));
    const { lines, suggestions } = sampleCartProducts(onScreen, board, shownAddOns.cards.map(sampleFromPageProduct));
    return sampleCartView(lines, {
      state: "full",
      suggestions,
      freeOverCents: freeOverCentsIn(shippingPolicy, onScreen.currency),
      href: (productId) => productPagePath(storefrontId, productId),
    });
  }, [
    cartShown,
    loaded.id,
    loaded.title,
    loaded.priceCents,
    loaded.sale?.regularPriceCents,
    loaded.currency,
    imageUrl,
    imageAlt,
    boardProducts,
    shownAddOns.cards,
    shippingPolicy,
    storefrontId,
  ]);

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
      ...(cartPage && cartPage.enabled !== false ? { cart: cartPage } : {}),
    },
    product: previewed,
    productUrl: "",
    addOns,
    hiddenAddOns: shownAddOns.hidden,
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
      resolveHotspot={(name) => {
        // The section clicked on THIS page is the one the panel should choose for.
        if (name === "addOns") addOnsEditor?.aim(product.id);
        if (!isProductPageHotspot(name)) return null;
        const ref = PRODUCT_PAGE_HOTSPOTS[name];
        // The cart clicked on THIS page is the one to keep open.
        return ref.kind === "cartPage" ? { ...ref, on: product.id } : ref;
      }}
    >
      <BadgeMoveProvider
        canPlace={canPlace}
        onPlace={placeBadge}
        onRefused={() => toast.error(tBadges("photoFull", { max: BADGES_ON_PHOTO_MAX }))}
        copy={badgeCopy}
      >
        <CartEditProvider cartPage={cartPage ?? {}} onChange={(next) => onCartPageChange?.(next)}>
          <ProductPageView
            page={page}
            mode="preview"
            reviews={reviews}
            wrapBadges={(kind, node) => (
              <BadgeDropZone kind={kind}>{node || null}</BadgeDropZone>
            )}
            previewCart={
              sampleCart
                ? {
                    view: sampleCart,
                    open: cartOpen,
                    onOpenChange: (open) => onCartOpenChange?.(open),
                    drawer: "inline",
                  }
                : undefined
            }
          />
        </CartEditProvider>
      </BadgeMoveProvider>
    </ArtboardFrame>
  );
}

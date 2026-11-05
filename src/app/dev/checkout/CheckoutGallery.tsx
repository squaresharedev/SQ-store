"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { CheckoutEditProvider } from "@/components/checkout/EditableText";
import { CheckoutView } from "@/components/checkout/CheckoutView";
import { OrderStatusView } from "@/components/checkout/OrderStatusView";
import { ProductPageView } from "@/components/product-page/ProductPageView";
import { CheckoutPageSection } from "@/components/storefront/CheckoutPageSection";
import { AddOnsDesignFields } from "@/components/storefront/AddOnsDesignFields";
import { ReviewsDesignFields } from "@/components/storefront/ReviewsDesignFields";
import { sampleOrder } from "@/components/storefront/CheckoutArtboards";
import type { CheckoutStorefront } from "@/types/checkout";
import { pagePhotoView } from "@/lib/storefront/product-page";
import { DEFAULT_PRODUCT_PAGE_CONFIG, type CheckoutPageConfig, type ProductPageConfig } from "@/types/storefront";
import {
  HARNESS_SELLER,
  HARNESS_SHIPPING,
  HARNESS_THEME,
  harnessAddOns,
  harnessHiddenAddOns,
  harnessMoreAddOns,
  HARNESS_REVIEWS,
  harnessProduct,
} from "./fixtures";

/** A common phone's viewport height, for `scroll` mode. */
const PHONE_HEIGHT = 844;

/** The dev gallery: the Checkout panel on the left, the page it designs on
 *  the right, at the width the query asked for. */
export function CheckoutGallery({
  width,
  digital,
  sale,
  view,
  quantity,
  scroll,
  buyer,
  initialCheckoutPage,
  initialPhotoUrls,
  addOns = "none",
  reviews = false,
  cornerRadius = 0,
}: {
  /** The frame's width in px; null fills the room beside the panel. */
  width: number | null;
  /** Offer "Add to your order" cards, all of them taken: two, two and two
   *  chosen but hidden (the product page only), or four (posted only). */
  addOns?: "none" | "two" | "hidden" | "four";
  /** Give the product page's product reviews, and its rating under the title. */
  reviews?: boolean;
  /** The storefront's corner roundness. */
  cornerRadius?: number;
  digital: boolean;
  /** Sell the product at a sale price, so the page announces a reduction. */
  sale: boolean;
  view: "checkout" | "thanks" | "product";
  quantity: number;
  /** Draw the page inside a phone-height window it scrolls in. */
  scroll: boolean;
  /** Draw the thank-you page in the buyer's mode. */
  buyer: boolean;
  initialCheckoutPage: CheckoutPageConfig;
  /** Display URLs by object key, for a design that starts with a photo. */
  initialPhotoUrls: Record<string, string>;
}) {
  const [checkoutPage, setCheckoutPage] = useState<CheckoutPageConfig>(initialCheckoutPage);
  const [productPage, setProductPage] = useState<ProductPageConfig>(DEFAULT_PRODUCT_PAGE_CONFIG);
  const [playKey, setPlayKey] = useState(0);
  const [pagePhotoUrls, setPagePhotoUrls] = useState(initialPhotoUrls);
  const shownPhoto = view === "checkout" ? checkoutPage.backgroundImage : checkoutPage.thanksBackgroundImage;
  const storefront: CheckoutStorefront = {
    id: "00000000-0000-4000-8000-000000000000",
    name: "Clay House",
    theme: { ...HARNESS_THEME, cornerRadius },
    header: { show: true, name: "Clay House", bio: "" },
    productPage,
    checkoutPage,
    shippingPolicy: HARNESS_SHIPPING,
    seller: HARNESS_SELLER,
    backgroundImageUrl: null,
    customFontUrl: null,
    pagePhoto: pagePhotoView(shownPhoto, shownPhoto && pagePhotoUrls[shownPhoto.key]),
  };
  const item = harnessProduct(digital, sale ? "proven" : null);
  const cards =
    addOns === "none"
      ? []
      : [...harnessAddOns(digital), ...(addOns === "four" && !digital ? harnessMoreAddOns() : [])];
  const hidden = addOns === "hidden" ? harnessHiddenAddOns() : [];
  const picks = cards.map((card) => ({
    productId: card.id,
    optionIds: card.optionGroups.flatMap((group) => (group.options[0] ? [group.options[0].id] : [])),
  }));

  return (
    <div className="flex min-h-screen items-start gap-6 bg-muted/40 p-6">
      <aside className="sticky top-6 w-80 shrink-0 space-y-2 border bg-background p-3" data-dev-checkout-panel="">
        {view === "product" ? (
          reviews ? (
            <ReviewsDesignFields productPage={productPage} onProductPageChange={setProductPage} />
          ) : (
            <AddOnsDesignFields productPage={productPage} onProductPageChange={setProductPage} />
          )
        ) : (
          <CheckoutPageSection
            checkoutPage={checkoutPage}
            onCheckoutPageChange={setCheckoutPage}
            productPage={productPage}
            theme={HARNESS_THEME}
            pagePhotoUrls={pagePhotoUrls}
            onPagePhotoUrl={(key, url) => setPagePhotoUrls((current) => ({ ...current, [key]: url }))}
            summoned={null}
            onPlayCelebration={() => setPlayKey((key) => key + 1)}
          />
        )}
      </aside>
      {/* Scrolls on its own: the body clips what overflows it, so a frame wider
          than the room beside the panel would otherwise just be cut off. */}
      <div className="min-w-0 flex-1 overflow-x-auto" data-dev-checkout-scroller="">
      <div
        className={cn("border bg-background", width === null ? "w-full" : "shrink-0", scroll ? "overflow-y-auto" : "overflow-hidden")}
        // `scroll`: a phone-sized window the page scrolls inside, as the editor
        // on a phone shows an artboard, so anything pinned to the bottom pins
        // to THIS window's bottom and can be caught covering the page.
        style={{ width: width ?? undefined, height: scroll ? PHONE_HEIGHT : undefined }}
        data-dev-checkout-frame={scroll ? "scroll" : "page"}
      >
        {/* Editable in place exactly as on the artboard. */}
        <CheckoutEditProvider checkoutPage={checkoutPage} onChange={setCheckoutPage}>
          {view === "product" ? (
            <ProductPageView
              page={{
                storefront: { ...storefront, checkout: true },
                product: item,
                productUrl: "",
                addOns: cards,
                hiddenAddOns: hidden,
              }}
              mode="preview"
              initialQuantity={quantity}
              reviews={reviews ? HARNESS_REVIEWS : null}
            />
          ) : view === "checkout" ? (
            <CheckoutView
              page={{ storefront, product: item, addOns: cards }}
              mode="preview"
              initialQuantity={quantity}
              initialAddOns={picks}
            />
          ) : (
            <OrderStatusView
              key={playKey}
              page={{
                storefront,
                order: {
                  ...sampleOrder(item, HARNESS_SHIPPING, "Aoife"),
                  quantity,
                  amountCents:
                    item.priceCents * quantity + cards.reduce((total, card) => total + card.priceCents, 0),
                  destination: digital ? null : { city: "Galway", country: "IE" },
                  addOns: cards.map((card) => ({
                    id: card.id,
                    productTitle: card.title,
                    photo: card.images[0] ?? null,
                    quantity: 1,
                    selection: card.optionGroups.flatMap((group) =>
                      group.options[0] ? [{ label: group.name, value: group.options[0].name }] : [],
                    ),
                    digitalFormat: card.digitalFormat,
                  })),
                },
              }}
              // `buyer`: the thank-you as a buyer's browser draws it, with the
              // confetti over the whole screen rather than inside the frame.
              mode={buyer ? "public" : "preview"}
              placed
            />
          )}
        </CheckoutEditProvider>
      </div>
      </div>
    </div>
  );
}

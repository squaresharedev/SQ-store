"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { CheckoutEditProvider } from "@/components/checkout/EditableText";
import { CheckoutView } from "@/components/checkout/CheckoutView";
import { OrderStatusView } from "@/components/checkout/OrderStatusView";
import { CheckoutPageSection } from "@/components/storefront/CheckoutPageSection";
import { sampleOrder } from "@/components/storefront/CheckoutArtboards";
import type { CheckoutStorefront } from "@/types/checkout";
import { pagePhotoView } from "@/lib/storefront/product-page";
import { DEFAULT_PRODUCT_PAGE_CONFIG, type CheckoutPageConfig } from "@/types/storefront";
import {
  HARNESS_SELLER,
  HARNESS_SHIPPING,
  HARNESS_THEME,
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
}: {
  width: number;
  digital: boolean;
  /** Sell the product at a sale price, so the page announces a reduction. */
  sale: boolean;
  view: "checkout" | "thanks";
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
  const [playKey, setPlayKey] = useState(0);
  const [pagePhotoUrls, setPagePhotoUrls] = useState(initialPhotoUrls);
  const shownPhoto = view === "checkout" ? checkoutPage.backgroundImage : checkoutPage.thanksBackgroundImage;
  const storefront: CheckoutStorefront = {
    id: "00000000-0000-4000-8000-000000000000",
    name: "Clay House",
    theme: HARNESS_THEME,
    header: { show: true, name: "Clay House", bio: "" },
    productPage: DEFAULT_PRODUCT_PAGE_CONFIG,
    checkoutPage,
    shippingPolicy: HARNESS_SHIPPING,
    seller: HARNESS_SELLER,
    backgroundImageUrl: null,
    customFontUrl: null,
    pagePhoto: pagePhotoView(shownPhoto, shownPhoto && pagePhotoUrls[shownPhoto.key]),
  };
  const item = harnessProduct(digital, sale ? "proven" : null);

  return (
    <div className="flex min-h-screen items-start gap-6 bg-muted/40 p-6">
      <aside className="sticky top-6 w-80 shrink-0 space-y-2 border bg-background p-3" data-dev-checkout-panel="">
        <CheckoutPageSection
          checkoutPage={checkoutPage}
          onCheckoutPageChange={setCheckoutPage}
          productPage={DEFAULT_PRODUCT_PAGE_CONFIG}
          theme={HARNESS_THEME}
          pagePhotoUrls={pagePhotoUrls}
          onPagePhotoUrl={(key, url) => setPagePhotoUrls((current) => ({ ...current, [key]: url }))}
          summoned={null}
          onPlayCelebration={() => setPlayKey((key) => key + 1)}
        />
      </aside>
      <div
        className={cn("shrink-0 border bg-background", scroll ? "overflow-y-auto" : "overflow-hidden")}
        // `scroll`: a phone-sized window the page scrolls inside, as the editor
        // on a phone shows an artboard, so anything pinned to the bottom pins
        // to THIS window's bottom and can be caught covering the page.
        style={{ width, height: scroll ? PHONE_HEIGHT : undefined }}
        data-dev-checkout-frame={scroll ? "scroll" : "page"}
      >
        {/* Editable in place exactly as on the artboard. */}
        <CheckoutEditProvider checkoutPage={checkoutPage} onChange={setCheckoutPage}>
          {view === "checkout" ? (
            <CheckoutView page={{ storefront, product: item }} mode="preview" initialQuantity={quantity} />
          ) : (
            <OrderStatusView
              key={playKey}
              page={{
                storefront,
                order: {
                  ...sampleOrder(item, HARNESS_SHIPPING, "Aoife"),
                  quantity,
                  amountCents: item.priceCents * quantity,
                  destination: digital ? null : { city: "Galway", country: "IE" },
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
  );
}

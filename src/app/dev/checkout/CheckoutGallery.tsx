"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { CheckoutEditProvider } from "@/components/checkout/EditableText";
import { CheckoutView } from "@/components/checkout/CheckoutView";
import { OrderStatusView } from "@/components/checkout/OrderStatusView";
import { CheckoutPageSection } from "@/components/storefront/CheckoutPageSection";
import { sampleOrder } from "@/components/storefront/CheckoutArtboards";
import type { CheckoutStorefront } from "@/types/checkout";
import type { ProductPageProduct } from "@/types/product";
import type { SellerShippingPolicy } from "@/types/shipping-policy";
import {
  DEFAULT_PRODUCT_PAGE_CONFIG,
  DEFAULT_STOREFRONT_CONFIG,
  type CheckoutPageConfig,
} from "@/types/storefront";

/** A common phone's viewport height, for `scroll` mode. */
const PHONE_HEIGHT = 844;

const THEME = {
  ...DEFAULT_STOREFRONT_CONFIG.theme,
  background: { kind: "solid" as const, color: "#f6f1e7" },
  accent: "#1f4d3a",
  cornerRadius: 12,
};

const SHIPPING: SellerShippingPolicy = {
  shipsFrom: "IE",
  dispatch: "Ships within 1-3 business days",
  destinations: [
    { area: "Ireland", time: "1-2 business days", countries: ["IE"], rateCents: 450 },
    { area: "Everywhere else", time: "5-8 business days", countries: ["*"], rateCents: 1200 },
  ],
  ratesCurrency: "EUR",
  freeOverCents: 8000,
  returnsWindowDays: 30,
  returnsPaidBy: "buyer",
};

const SELLER = {
  businessName: "Clay House",
  address: "4 Quay Street, Galway, H91 X2Y3, Ireland",
  email: "hello@clayhouse.example",
  country: "IE",
  vatId: "IE1234567FA",
};

function product(digital: boolean): ProductPageProduct {
  return {
    id: "5a3e1d20-0c4f-4b6e-9a61-1f0d2c3b4a03",
    title: digital ? "Glaze recipes zine" : "Stoneware vase",
    description: "",
    priceCents: digital ? 1200 : 2400,
    currency: "EUR",
    purchaseUrl: null,
    shippingProfileId: null,
    images: [{ url: "/sample-storefront/succulent.webp", alt: "A stoneware vase" }],
    optionGroups: digital
      ? []
      : [
          {
            id: "g-colour",
            name: "Colour",
            display: "swatch",
            options: [
              { id: "o-sage", name: "Sage", swatch: "#9caf88", available: true },
              { id: "o-clay", name: "Clay", swatch: "#c26a4a", available: true },
            ],
          },
          {
            id: "g-size",
            name: "Size",
            display: "chip",
            options: [
              { id: "o-small", name: "Small", available: true },
              { id: "o-large", name: "Large", available: true },
            ],
          },
        ],
    details: {},
    documents: [],
    isDigital: digital,
    digitalFormat: digital ? "PDF" : null,
    stock: null,
    soldOut: false,
    maxQuantity: 5,
  };
}

/** The dev gallery: the Checkout panel on the left, the page it designs on
 *  the right, at the width the query asked for. */
export function CheckoutGallery({
  width,
  digital,
  view,
  quantity,
  scroll,
  buyer,
  initialCheckoutPage,
}: {
  width: number;
  digital: boolean;
  view: "checkout" | "thanks";
  quantity: number;
  /** Draw the page inside a phone-height window it scrolls in. */
  scroll: boolean;
  /** Draw the thank-you page in the buyer's mode. */
  buyer: boolean;
  initialCheckoutPage: CheckoutPageConfig;
}) {
  const [checkoutPage, setCheckoutPage] = useState<CheckoutPageConfig>(initialCheckoutPage);
  const [playKey, setPlayKey] = useState(0);
  const storefront: CheckoutStorefront = {
    id: "00000000-0000-4000-8000-000000000000",
    name: "Clay House",
    theme: THEME,
    header: { show: true, name: "Clay House", bio: "" },
    productPage: DEFAULT_PRODUCT_PAGE_CONFIG,
    checkoutPage,
    shippingPolicy: SHIPPING,
    seller: SELLER,
    backgroundImageUrl: null,
    customFontUrl: null,
  };
  const item = product(digital);

  return (
    <div className="flex min-h-screen items-start gap-6 bg-muted/40 p-6">
      <aside className="sticky top-6 w-80 shrink-0 space-y-2 border bg-background p-3" data-dev-checkout-panel="">
        <CheckoutPageSection
          checkoutPage={checkoutPage}
          onCheckoutPageChange={setCheckoutPage}
          productPage={DEFAULT_PRODUCT_PAGE_CONFIG}
          theme={THEME}
          live={false}
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
            <CheckoutView page={{ storefront, product: item }} mode="preview" unwired initialQuantity={quantity} />
          ) : (
            <OrderStatusView
              key={playKey}
              page={{
                storefront,
                order: {
                  ...sampleOrder(item, SHIPPING, "Aoife"),
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

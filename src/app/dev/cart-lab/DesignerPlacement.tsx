"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ProductPageView } from "@/components/product-page/ProductPageView";
import { ArtboardFrame } from "@/components/storefront/ArtboardFrame";
import { CartPreviewProvider } from "@/components/cart/CartContext";
import { CartPanelSurface } from "@/components/cart/CartPanelSurface";
import { CART_PANEL_WIDTH_PX, CART_PREVIEW_SCREEN_PX } from "@/components/cart/cart-look";
import type { CartPanelTheme } from "@/components/cart/CartPanel";
import { sampleCartView, type SampleCartProduct } from "@/lib/cart/sample";
import {
  DEFAULT_PRODUCT_PAGE_CONFIG,
  DEFAULT_STOREFRONT_CONFIG,
  type CartPageConfig,
  type StorefrontTheme,
} from "@/types/storefront";
import { HARNESS_SELLER, HARNESS_SHIPPING, harnessProduct } from "../checkout/fixtures";
import { LAB_SHOPS, LAB_STOREFRONT_ID } from "./fixtures";
import { lookOf, type CartLabState } from "./lab-model";

/** The designer's own artboard widths (DesignerCanvas): a product page's
 *  desktop and phone widths. */
const PAGE_WIDTHS = { desktop: 1280, mobile: 384 } as const;
/** A cart artboard is the panel at the width it opens at. */
const CART_WIDTHS = { desktop: CART_PANEL_WIDTH_PX, mobile: PAGE_WIDTHS.mobile } as const;

/** The product page on screen, then the seller's other products: the sample
 *  cart is made of these (lib/cart/sample.ts). */
function sampleProducts(): SampleCartProduct[] {
  const vase = harnessProduct(false);
  const photo = (name: string, alt: string) => ({ url: `/sample-storefront/${name}.webp`, alt });
  return [
    { id: vase.id, title: vase.title, priceCents: vase.priceCents, currency: "EUR", image: vase.images[0] ?? null },
    { id: "5a000000-0000-4000-8000-0000000000d1", title: "Walnut speaker", priceCents: 8900, currency: "EUR", image: photo("speaker", "Walnut speaker") },
    {
      id: "5a000000-0000-4000-8000-0000000000d2",
      title: "Studio headphones",
      priceCents: 5600,
      regularPriceCents: 7000,
      currency: "EUR",
      image: photo("headphones", "Studio headphones"),
    },
    { id: "5a000000-0000-4000-8000-0000000000d3", title: "Wireless mouse", priceCents: 3900, currency: "EUR", image: photo("mouse", "Wireless mouse") },
    { id: "5a000000-0000-4000-8000-0000000000d4", title: "Field watch", priceCents: 12900, currency: "EUR", image: photo("watch", "Field watch") },
  ];
}

const SAMPLE_PRODUCTS = sampleProducts();

/**
 * The canvas, shrunk to fit the box it is drawn in (a desktop artboard is
 * wider than the lab's preview, and far wider than a tile), the way the
 * designer's own zoom fits the stage. Never enlarged. Pressing still works:
 * it is a transform.
 */
function FitToWidth({ children }: { children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ scale: 1, height: 0 });
  useEffect(() => {
    const box = outer.current;
    const content = inner.current;
    if (!box || !content) return;
    const observer = new ResizeObserver(() => {
      const scale = Math.min(1, box.clientWidth / Math.max(1, content.scrollWidth));
      setFit({ scale, height: content.scrollHeight * scale });
    });
    observer.observe(box);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={outer} className="w-full overflow-hidden" style={{ height: fit.height || undefined }}>
      <div ref={inner} className="mx-auto w-max origin-top-left" style={{ transform: `scale(${fit.scale})` }}>
        {children}
      </div>
    </div>
  );
}

/**
 * THE CART ON THE STOREFRONT DESIGNER, two ways, drawn with the designer's own
 * pieces (ArtboardFrame, the real product page in preview) on a stand-in of
 * its canvas:
 *
 *   above   the cart is an artboard of its own, stacked ABOVE the product
 *           page it opens over (a layer of the page, not the next step), at
 *           the panel's own width and one screen tall;
 *   onPage  the cart opens ON the product page artboard, inside its frame,
 *           as it opens for a buyer: press the page's cart button or Add to
 *           cart (which plays the seller's "After adding").
 *
 * Either way the cart is full: a sample made of the seller's own products.
 */
export function DesignerPlacement({ state, interactive }: { state: CartLabState; interactive: boolean }) {
  const shop = LAB_SHOPS.find((entry) => entry.id === state.shop) ?? LAB_SHOPS[0];
  const theme: StorefrontTheme = {
    ...DEFAULT_STOREFRONT_CONFIG.theme,
    background: { kind: "solid", color: shop.background },
    accent: shop.accent,
    cornerRadius: shop.cornerRadius,
  };
  const panelTheme: CartPanelTheme = { ink: shop.ink, cornerRadius: shop.cornerRadius, cta: shop.cta };
  const config: CartPageConfig = {
    ...(state.mainButton === "addToCart" ? { mainButton: "addToCart" as const } : {}),
    ...(state.afterAdd === "note" ? { afterAdd: "note" as const } : {}),
    ...(state.deliveryBar ? {} : { deliveryBar: false as const }),
    ...(state.suggest ? {} : { suggestions: false as const }),
  };
  const view = useMemo(
    () => sampleCartView(SAMPLE_PRODUCTS, { state: state.sample, freeOverCents: HARNESS_SHIPPING.freeOverCents }),
    [state.sample],
  );
  const product = harnessProduct(false);
  const look = lookOf(state);

  const page = (drawer: "inline" | "none") => (
    <ArtboardFrame
      key={`page-${state.device}`}
      artboardId="lab-product-page"
      title={product.title}
      kindLabel=" · Product page"
      closeLabel="Close"
      onClose={() => {}}
      widths={PAGE_WIDTHS}
      initialDevice={state.device}
      resolveHotspot={() => null}
    >
      <ProductPageView
        // A fresh page when what it starts from changes.
        key={`${drawer}-${state.open}-${state.sample}-${state.afterAdd}-${state.mainButton}`}
        page={{
          storefront: {
            id: LAB_STOREFRONT_ID,
            name: "Clay House",
            theme,
            header: { show: true, name: "Clay House", bio: "" },
            productPage: DEFAULT_PRODUCT_PAGE_CONFIG,
            shippingPolicy: HARNESS_SHIPPING,
            seller: HARNESS_SELLER,
            backgroundImageUrl: null,
            customFontUrl: null,
            pagePhoto: null,
            checkout: true,
            cart: config,
          },
          product,
          productUrl: "",
          addOns: [],
          hiddenAddOns: [],
        }}
        mode="preview"
        previewCart={{ view, open: drawer === "inline" && state.open, drawer }}
      />
    </ArtboardFrame>
  );

  return (
    <div
      className="w-full overflow-hidden bg-muted px-6 py-8"
      // The tiles are pictures; the playground can be pressed.
      style={interactive ? undefined : { pointerEvents: "none" }}
      data-cart-lab-designer={state.placement}
    >
      <FitToWidth>
      {state.placement === "above" ? (
        <div className="flex flex-col items-end">
          <ArtboardFrame
            key={`cart-${state.device}`}
            artboardId="lab-cart"
            title={product.title}
            kindLabel=" · Cart"
            closeLabel="Close"
            onClose={() => {}}
            widths={CART_WIDTHS}
            initialDevice={state.device}
            resolveHotspot={() => null}
          >
            <CartPreviewProvider storefrontId={LAB_STOREFRONT_ID} config={config} view={view} look={look}>
              <CartPanelSurface theme={panelTheme} style={{ height: CART_PREVIEW_SCREEN_PX }} />
            </CartPreviewProvider>
          </ArtboardFrame>
          {/* What joins them: the page's cart button opens this. */}
          <span className="mr-10 h-10 w-px border-l border-dashed border-foreground/40" aria-hidden="true" />
          {page("none")}
        </div>
      ) : (
        page("inline")
      )}
      </FitToWidth>
    </div>
  );
}

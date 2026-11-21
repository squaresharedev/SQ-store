"use client";

import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { overlayCloseButtonClass, overlaySurfaceClass, modalTitleClass } from "@/components/ui/control-styles";
import { ruleColor, storefrontOverlayVars } from "@/components/product-page/product-page-maps";
import { OptionProvider } from "@/components/product-page/OptionContext";
import { ProductCta } from "@/components/product-page/ProductCta";
import { CartPreviewProvider } from "@/components/cart/CartContext";
import { CartButton } from "@/components/cart/CartButton";
import { CartContents, CartSummary, type CartPanelTheme } from "@/components/cart/CartPanel";
import { AddToCartButton } from "@/components/cart/AddToCartButton";
import { CartAddedNote } from "@/components/cart/CartAddedNote";
import { CartPageBody } from "@/components/cart/CartPageBody";
import { ProductTileContent } from "@/components/storefront/ProductTileContent";
import { QuickAddTile } from "@/components/storefront-page/QuickAddTile";
import { ReviewAsk } from "@/components/checkout/ReviewAsk";
import type { CheckoutTheme } from "@/components/checkout/checkout-theme";
import { resolveTileLook } from "@/lib/storefront/tile-look";
import { DEFAULT_PRODUCT_PAGE_CONFIG, DEFAULT_STOREFRONT_CONFIG, type StorefrontTheme } from "@/types/storefront";
import type { Product } from "@/types/product";
import type { BuyerOrder } from "@/types/checkout";
import { LAB_SCENARIOS, LAB_SHOPS, LAB_STOREFRONT_ID } from "./fixtures";
import { lookOf, type CartLabState } from "./lab-model";

const NO_GROUPS: never[] = [];

/** A card's product, as the board hands it: the fields a face reads. */
function cardProduct(id: string, title: string, photo: string, price: number, quick: boolean): Product {
  return {
    id,
    title,
    description: "",
    price,
    currency: "EUR",
    status: "active",
    imageUrl: `/sample-storefront/${photo}.webp`,
    digitalFileName: null,
    trackStock: false,
    stockQuantity: null,
    lowStockThreshold: 0,
    maxPerOrder: 10,
    ...(quick ? { quickAdd: { optionIds: [] } } : {}),
  };
}

/** Three cards: two that go straight in, one with versions to choose. */
const CARD_PRODUCTS = [
  cardProduct("5a000000-0000-4000-8000-0000000000c1", "Walnut speaker", "speaker", 89, true),
  cardProduct("5a000000-0000-4000-8000-0000000000c2", "Studio headphones", "headphones", 56, false),
  cardProduct("5a000000-0000-4000-8000-0000000000c3", "Potted succulent", "succulent", 14, true),
];

/** An order of three products for the review picker: one reviewed already. */
const REVIEW_ORDER: Pick<
  BuyerOrder,
  "ref" | "productId" | "productTitle" | "photo" | "firstName" | "isDigital" | "review" | "reviewRating" | "reviewReminder" | "reviewItems"
> = {
  ref: "lab",
  productId: CARD_PRODUCTS[0]!.id,
  productTitle: "Walnut speaker",
  photo: { url: "/sample-storefront/speaker.webp", alt: "" },
  firstName: "Aoife",
  isDigital: false,
  review: "open",
  reviewItems: [
    { productId: CARD_PRODUCTS[0]!.id, title: "Walnut speaker", photo: { url: "/sample-storefront/speaker.webp", alt: "" }, review: "open" },
    { productId: CARD_PRODUCTS[1]!.id, title: "Studio headphones", photo: { url: "/sample-storefront/headphones.webp", alt: "" }, review: "done", rating: 5 },
    { productId: CARD_PRODUCTS[2]!.id, title: "Potted succulent", photo: { url: "/sample-storefront/succulent.webp", alt: "" }, review: "open" },
  ],
};

/**
 * The cart drawn where it lives, from the lab's state: the real components
 * (CartContents, CartSummary, the buttons, CartPageBody) over a shop. The
 * panel is drawn in place (the real one is a dialog over the whole screen,
 * which a tile cannot hold): the same surface, the same contents, the same
 * pinned summary.
 */
export function Placement({ state, interactive = false }: { state: CartLabState; interactive?: boolean }) {
  const t = useTranslations("ProductPage.cart");
  const shop = LAB_SHOPS.find((entry) => entry.id === state.shop) ?? LAB_SHOPS[0];
  const view = LAB_SCENARIOS[state.scenario].view;
  const theme: CartPanelTheme = { ink: shop.ink, cornerRadius: shop.cornerRadius, cta: shop.cta };
  const config = {
    ...(state.mainButton === "addToCart" ? { mainButton: "addToCart" as const } : {}),
    ...(state.afterAdd === "note" ? { afterAdd: "note" as const } : {}),
    ...(state.deliveryBar ? {} : { deliveryBar: false as const }),
    ...(state.quickAdd ? {} : { quickAdd: false as const }),
    ...(state.suggest ? {} : { suggestions: false as const }),
  };
  // The shop as a board theme, with the card's buy button on.
  const boardTheme: StorefrontTheme = {
    ...DEFAULT_STOREFRONT_CONFIG.theme,
    background: { kind: "solid", color: shop.background },
    cornerRadius: shop.cornerRadius,
    buyButton: "solid",
  };
  const tileLook = resolveTileLook({ theme: boardTheme, productPage: DEFAULT_PRODUCT_PAGE_CONFIG, cartPage: config });
  // The shop as an order page sees it.
  const orderTheme: CheckoutTheme = {
    surface: shop.background,
    ink: shop.ink,
    rule: ruleColor(shop.ink),
    surfaceRadius: shop.cornerRadius,
    cornerRadius: shop.cornerRadius,
    controlRadius: Math.min(shop.cornerRadius, 8),
    cta: shop.cta,
    panelStyle: {},
    panelInk: shop.ink,
    panelRule: ruleColor(shop.ink),
    panelMatchesSurface: true,
  };

  return (
    <CartPreviewProvider storefrontId={LAB_STOREFRONT_ID} config={config} view={view} look={lookOf(state)}>
      <div
        className={cn("@container flex w-full justify-center", !interactive && "pointer-events-none")}
        style={{ backgroundColor: shop.background, color: shop.ink }}
        data-cart-lab-placement={state.placement}
      >
        {state.placement === "panel" && (
          <div className="flex w-full justify-end py-6 pr-0" style={storefrontOverlayVars(shop.ink, shop.cornerRadius)}>
            <div className={cn(overlaySurfaceClass, "flex h-[34rem] w-full max-w-md flex-col")}>
              <div className="flex items-start justify-between gap-4 px-6 pt-6">
                <h2 className={modalTitleClass}>{t("title")}</h2>
                <span className={cn(overlayCloseButtonClass, "-mr-1.5 -mt-1.5")} aria-hidden="true">
                  <X className="size-5" />
                </span>
              </div>
              <div className="flex-1 overflow-y-auto px-6 pt-4">
                <CartContents theme={theme} />
              </div>
              {view.lines.length > 0 && (
                <div className="border-t border-border bg-popover px-6 py-4">
                  <CartSummary theme={theme} />
                </div>
              )}
            </div>
          </div>
        )}

        {state.placement === "buttons" && (
          <OptionProvider groups={NO_GROUPS} initialOptionIds={[]} syncUrl={false}>
            <div className="flex w-full max-w-sm flex-col gap-2.5 px-6 py-10">
              <p className="text-2xl font-semibold">Walnut speaker</p>
              <p className="mb-2 text-lg tabular-nums">€89.00</p>
              {state.mainButton === "addToCart" && (
                <AddToCartButton productId={view.lines[0]?.productId ?? LAB_STOREFRONT_ID} title="Walnut speaker" cta={shop.cta} ink={shop.ink} primary soldOut={false} />
              )}
              <ProductCta
                target={{ kind: "checkout", storefrontId: LAB_STOREFRONT_ID, productId: LAB_STOREFRONT_ID }}
                label="Buy now"
                cta={shop.cta}
                ink={shop.ink}
                soldOut={false}
                preview
                secondary={state.mainButton === "addToCart"}
              />
              {state.mainButton === "buyNow" && (
                <AddToCartButton productId={LAB_STOREFRONT_ID} title="Walnut speaker" cta={shop.cta} ink={shop.ink} primary={false} soldOut={false} />
              )}
              {state.afterAdd === "note" && <CartAddedNote ink={shop.ink} className="mt-1" />}
            </div>
          </OptionProvider>
        )}

        {state.placement === "header" && (
          <div className="flex w-full items-center justify-between border-b px-6 py-4" style={{ borderColor: ruleColor(shop.ink) }}>
            <span className="text-sm font-semibold">Clay House</span>
            <CartButton ink={shop.ink} />
          </div>
        )}

        {state.placement === "page" && (
          <div className="w-full">
            <CartPageBody theme={theme} shopHref="#" />
          </div>
        )}

        {state.placement === "cards" && (
          <ul className="grid w-full max-w-2xl grid-cols-3 gap-3 px-6 py-8">
            {CARD_PRODUCTS.map((product) => (
              <li key={product.id} className="relative aspect-[3/4] overflow-hidden" style={{ borderRadius: `${shop.cornerRadius}px` }}>
                {product.quickAdd && tileLook.quickAdd ? (
                  <QuickAddTile
                    href="#"
                    newTab={false}
                    frameClassName="relative h-full w-full rounded-[inherit] border border-border bg-card"
                    productId={product.id}
                    optionIds={[]}
                    title={product.title}
                    renderFace={(action) => (
                      <div className="flex h-full w-full flex-col">
                        <ProductTileContent product={product} theme={boardTheme} look={tileLook} quickAddAction={action} />
                      </div>
                    )}
                  />
                ) : (
                  <div className="relative flex h-full w-full flex-col rounded-[inherit] border border-border bg-card">
                    <ProductTileContent product={product} theme={boardTheme} look={tileLook} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {state.placement === "reviews" && (
          <div className="@container w-full max-w-lg px-6 py-8">
            <ReviewAsk
              order={REVIEW_ORDER}
              asks
              hasGoods
              dialog={null}
              storeName="Clay House"
              theme={orderTheme}
              preview
            />
          </div>
        )}
      </div>
    </CartPreviewProvider>
  );
}

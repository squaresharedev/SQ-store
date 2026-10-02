"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ArtboardFrame } from "./ArtboardFrame";
import type { PreviewDevice } from "./DeviceSizeSwitch";
import { usePreviewProduct } from "./usePreviewProduct";
import { CheckoutView } from "@/components/checkout/CheckoutView";
import { OrderStatusView } from "@/components/checkout/OrderStatusView";
import { CheckoutEditProvider } from "@/components/checkout/EditableText";
import { CHECKOUT_PAGE_HOTSPOTS, isCheckoutPageHotspot } from "@/lib/storefront/setting-ref";
import { optionSummaryRows } from "@/lib/products/option-details";
import { photoForSelection, previewSelection } from "@/lib/checkout/selection";
import { buyerWithdrawal } from "@/lib/orders/withdrawal";
import { findShippingProfile } from "@/lib/storefront/shipping";
import type { CheckoutStorefront, OrderPageData } from "@/types/checkout";
import type { Product, ProductPageProduct } from "@/types/product";
import type { SellerShippingPolicy } from "@/types/shipping-policy";
import type {
  CheckoutPageConfig,
  ProductPageConfig,
  StorefrontHeader,
  StorefrontSeller,
  StorefrontTheme,
} from "@/types/storefront";

/** What both checkout artboards are drawn from: the storefront as the editor
 *  holds it right now, and the product whose page they hang off. */
type ChainProps = {
  product: Product;
  soldOut: boolean;
  storefrontId: string;
  storefrontName: string;
  theme: StorefrontTheme;
  header: StorefrontHeader;
  productPage: ProductPageConfig;
  checkoutPage: CheckoutPageConfig;
  shippingPolicy: SellerShippingPolicy;
  seller: StorefrontSeller;
  backgroundImageUrl: string | null;
  customFontUrl: string | null;
  /** Display URL of the checkout's photo backdrop (shared with the thank-you). */
  pagePhotoUrl: string | null;
  widths: Record<PreviewDevice, number>;
  initialDevice: PreviewDevice;
  onClose: () => void;
  /** Words typed straight onto the page. Absent (the dev gallery) leaves them
   *  as plain text. */
  onCheckoutPageChange?: (next: CheckoutPageConfig) => void;
};

/** The seller's words become editable in place when there is someone to keep
 *  the edit; otherwise the page draws exactly as a buyer's would. */
function Editable({ props, children }: { props: ChainProps; children: ReactNode }) {
  if (!props.onCheckoutPageChange) return <>{children}</>;
  return (
    <CheckoutEditProvider checkoutPage={props.checkoutPage} onChange={props.onCheckoutPageChange}>
      {children}
    </CheckoutEditProvider>
  );
}

/** Artboard ids, for the frames and for the connectors that join them. */
export function checkoutArtboardId(productId: string): string {
  return `checkout:${productId}`;
}
export function thanksArtboardId(productId: string): string {
  return `thanks:${productId}`;
}

function resolveCheckoutHotspot(name: string) {
  return isCheckoutPageHotspot(name) ? CHECKOUT_PAGE_HOTSPOTS[name] : null;
}

function chainStorefront(props: ChainProps): CheckoutStorefront {
  return {
    id: props.storefrontId,
    name: props.storefrontName,
    theme: props.theme,
    header: props.header,
    productPage: props.productPage,
    checkoutPage: props.checkoutPage,
    shippingPolicy: props.shippingPolicy,
    seller: props.seller,
    backgroundImageUrl: props.backgroundImageUrl,
    customFontUrl: props.customFontUrl,
    pagePhotoUrl: props.pagePhotoUrl,
  };
}

/**
 * THE CHECKOUT, as an artboard: the page a product page's button leads to,
 * drawn exactly as a buyer would see it for this product (its first available
 * version, one of it), with the payment shown as a still drawing of the card
 * fields.
 */
export function CheckoutArtboard(props: ChainProps) {
  const t = useTranslations("Storefront.artboard");
  const product = usePreviewProduct(props.product, props.productPage.showStock, props.soldOut);
  return (
    <ArtboardFrame
      artboardId={checkoutArtboardId(props.product.id)}
      title={props.product.title}
      kindLabel={t("checkoutLabel")}
      closeLabel={t("closeCheckoutAriaLabel")}
      onClose={props.onClose}
      widths={props.widths}
      initialDevice={props.initialDevice}
      resolveHotspot={resolveCheckoutHotspot}
    >
      <Editable props={props}>
        <CheckoutView
          page={{ storefront: chainStorefront(props), product }}
          mode="preview"
        />
      </Editable>
    </ArtboardFrame>
  );
}

/**
 * THE THANK-YOU PAGE, as an artboard: the order page a buyer lands on, drawn
 * for a sample order of this product so the seller designs it against their
 * own photo, title and price. The celebration plays when the artboard opens
 * and again each time `playKey` changes (the panel's "Play it").
 */
export function ThanksArtboard(props: ChainProps & { playKey: number }) {
  const t = useTranslations("Storefront.artboard");
  const tPanel = useTranslations("Storefront.checkoutPage");
  const product = usePreviewProduct(props.product, props.productPage.showStock, props.soldOut);
  const page: OrderPageData = {
    storefront: chainStorefront(props),
    order: sampleOrder(product, props.shippingPolicy, tPanel("thanks.sampleName")),
  };
  return (
    <ArtboardFrame
      artboardId={thanksArtboardId(props.product.id)}
      title={props.product.title}
      kindLabel={t("thanksLabel")}
      closeLabel={t("closeCheckoutAriaLabel")}
      onClose={props.onClose}
      widths={props.widths}
      initialDevice={props.initialDevice}
      resolveHotspot={resolveCheckoutHotspot}
    >
      {/* Keyed on the play count: a remount replays the CSS celebration. */}
      <Editable props={props}>
        <OrderStatusView key={props.playKey} page={page} mode="preview" placed />
      </Editable>
    </ArtboardFrame>
  );
}

/**
 * A pretend order of one of `product`, placed just now, for the thank-you
 * artboard. Nothing in it is anybody's: no email, no address, no reference.
 * What it does carry is the seller's own facts (the photo, the version, the
 * price, their dispatch line and returns window), which are what the page's
 * design has to work around.
 */
export function sampleOrder(
  product: ProductPageProduct,
  policy: SellerShippingPolicy,
  firstName: string,
): OrderPageData["order"] {
  const selection = previewSelection(product.optionGroups);
  const now = new Date().toISOString();
  const fulfilment = product.isDigital ? "not_required" : "unfulfilled";
  return {
    ref: "",
    number: "A1B2C3D4",
    placedAt: now,
    productId: product.id,
    productTitle: product.title,
    photo: photoForSelection(product.images, selection),
    quantity: 1,
    selection: optionSummaryRows(product.optionGroups, selection),
    amountCents: product.priceCents,
    currency: product.currency,
    maskedEmail: null,
    firstName,
    destination: null,
    isDigital: product.isDigital,
    digitalFormat: product.digitalFormat,
    fulfilment,
    shippedAt: null,
    trackingNumber: null,
    trackingLink: null,
    dispatch: product.isDigital
      ? null
      : (findShippingProfile(policy.profiles, product.shippingProfileId)?.dispatch ?? policy.dispatch ?? null),
    withdrawal: buyerWithdrawal(
      {
        status: "paid",
        fulfilment_status: fulfilment,
        shipped_at: null,
        created_at: now,
        supply_consent_at: null,
        withdrawal_requested_at: null,
      },
      policy,
    ),
  };
}

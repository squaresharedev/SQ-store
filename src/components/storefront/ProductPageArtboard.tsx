"use client";

import { useEffect, useState, type MouseEvent } from "react";
import { X } from "lucide-react";
import { DeviceSizeSwitch, type PreviewDevice } from "./DeviceSizeSwitch";
import { useNaturalSize } from "./useNaturalSize";
import { ProductPageView } from "@/components/product-page/ProductPageView";
import { deriveStockBadge } from "@/lib/stock/badge";
import { publicQuantityLimit } from "@/lib/products/quantity";
import { getProductPagePreviewData } from "@/lib/products/preview-actions";
import { useSettingTarget } from "@/lib/storefront/setting-context";
import {
  PRODUCT_PAGE_HOTSPOTS,
  isProductPageHotspot,
} from "@/lib/storefront/setting-ref";
import type { Product, ProductPageProduct } from "@/types/product";
import type { ProductPageData } from "@/types/product-page";
import type { SellerShippingPolicy } from "@/types/shipping-policy";
import type {
  ProductPageConfig,
  StorefrontHeader,
  StorefrontSeller,
  StorefrontTheme,
} from "@/types/storefront";

/**
 * How much smaller a page's own card renders on the canvas than the width
 * its device switch actually asks for.
 *
 * A CSS transform, not a smaller `width` handed to ProductPageView: the page
 * still LAYS OUT at its full realistic width (see the width prop's own doc
 * below) and is only shrunk in paint, so it keeps the exact desktop or mobile
 * layout a buyer's browser would give it (the image-left/details-right
 * breakpoint, the same line wraps, the same everything), just smaller,
 * rather than a genuinely narrower render reflowing into a different shape.
 * The real, hosted page a buyer visits never passes through this component
 * at all (see the public route), so it always renders full size regardless
 * of whatever the seller's canvas is showing.
 */
const PRODUCT_PAGE_SCALE = 0.75;

/**
 * ONE PRODUCT'S PAGE, as an artboard on the storefront canvas.
 *
 * The board and the pages its tiles open live on the same workspace, joined by
 * a connector (see PageConnectors), so the seller can see a tile and the page
 * behind it at once and design both without changing screens. That is the
 * whole reason this is an artboard on the canvas rather than a mode the editor
 * switches into: a product page is not a different place, it is what a tile
 * leads to.
 *
 * WIDTH is a REALISTIC PHONE OR DESKTOP BROWSER WIDTH, at whichever device
 * this page's own switch is on — a product page is a real route a buyer's
 * browser renders on its own, not a panel scaled to whatever the seller's
 * board happens to measure (a 6-column board's natural design-view width is
 * under 700px, nowhere near enough for this page's own image-left/details-
 * right breakpoint). Independent of the board's own device, too: a seller
 * previewing the storefront on mobile can still switch just this page to its
 * desktop version to work on it, the same way they could switch the whole
 * canvas if the board were the only thing open. Height is natural, not a
 * fixed frame: a real page is exactly as tall as its content.
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
  onClose,
  widths,
  initialDevice,
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
  onClose: () => void;
  /** This page's own two widths — a realistic phone width and a realistic
   *  desktop browser width — that its switch picks between. */
  widths: Record<PreviewDevice, number>;
  /** What the board is showing right now, so a freshly opened page starts in
   *  step with it — this page's own switch takes over from there. */
  initialDevice: PreviewDevice;
}) {
  const [device, setDevice] = useState<PreviewDevice>(initialDevice);
  const width = widths[device];
  // The card's rendered footprint on the canvas: the actual page beneath it
  // still measures itself at the full `width`, this is only how much room it
  // is given to show through (see PRODUCT_PAGE_SCALE).
  const scaledWidth = width * PRODUCT_PAGE_SCALE;
  // The page's own natural height, measured at full size so the wrapper below
  // can be shrunk to match: see useNaturalSize.
  const { ref: contentRef, size: naturalSize } = useNaturalSize<HTMLDivElement>();
  // Null outside the designer (the dev gallery, a component test), which
  // simply means clicking the page opens nothing.
  const setting = useSettingTarget();
  // Read once: both the preview load and the first frame derive the quantity
  // ceiling from it, and the two must not disagree.
  const showStock = productPage.showStock;

  // The page facts (gallery, options, details, purchase link) come from the
  // same builder the public route uses, so the artboard cannot show the seller
  // something a buyer would not get. Until it answers, the catalogue row the
  // editor already holds paints a faithful first frame; a failed load simply
  // keeps that frame, because a preview has no failure worth a toast.
  // No reset when the id changes: an artboard is keyed by its product, so a
  // different product is a different instance with its own empty state.
  const [loaded, setLoaded] = useState<ProductPageProduct | null>(null);
  useEffect(() => {
    let cancelled = false;
    // The sold-out flag is re-applied live below (withLiveSoldOut), so it is
    // not sent; showStock IS, because the quantity ceiling is derived from it
    // and a preview that disclosed a stock count the buyer's page hides would
    // be showing the seller the wrong page.
    getProductPagePreviewData(product.id, false, showStock)
      .then((result) => {
        if (!cancelled && result.ok) setLoaded(result.product);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [product.id, showStock]);

  /**
   * Resolve a click inside the page to the setting behind what was clicked.
   *
   * Nearest hotspot wins (`closest`), so a region always beats the backdrop it
   * sits on. A `data-setting-skip` subtree opts out entirely, for the controls
   * that belong to the PRODUCT rather than to the page: the option picker
   * changes the photo and nothing else.
   *
   * Links are neutralised, and only links. A document opens a signed PDF in a
   * new tab and a mailto would hand the editor to a mail client, neither of
   * which a seller means by clicking their own design. Everything else keeps
   * its behaviour, so a disclosure still expands while its settings open,
   * which is exactly what someone poking at a section wants.
   */
  function openSettingForTarget(event: MouseEvent<HTMLDivElement>) {
    if (!setting) return;
    const from = event.target instanceof Element ? event.target : null;
    if (!from || from.closest("[data-setting-skip]")) return;
    const anchor = from.closest("a");
    if (anchor) event.preventDefault();
    const hotspot = from.closest("[data-setting-hotspot]");
    const name = hotspot?.getAttribute("data-setting-hotspot") ?? "";
    if (!isProductPageHotspot(name)) return;
    setting.open(PRODUCT_PAGE_HOTSPOTS[name]);
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
    },
    product: withLiveSoldOut(loaded ?? fromCatalogRow(product, showStock), soldOut),
    productUrl: "",
  };

  return (
    <div
      data-artboard-id={product.id}
      className="flex shrink-0 flex-col gap-2"
      style={{ width: scaledWidth }}
    >
      {/* The frame's label, outside the page itself: this chrome belongs to
          the editor, never to the design. At the CARD's width, not the page's
          full width (the title simply truncates sooner if it has to), so the
          controls stay full, comfortable size rather than shrinking along
          with the page and becoming fiddlier to hit for the space saved. */}
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate font-inter text-sm font-medium text-foreground">
          {product.title}
          <span className="text-muted-foreground"> · Product page</span>
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <DeviceSizeSwitch
            device={device}
            onChange={setDevice}
            labels={{ desktop: "Desktop size", mobile: "Mobile size" }}
          />
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close the product page for ${product.title}`}
            title={`Close the product page for ${product.title}`}
            className="flex size-7 shrink-0 items-center justify-center rounded-sm border border-border bg-background text-muted-foreground transition-colors duration-base ease-standard hover:text-foreground"
          >
            <X className="size-3.5" strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* THE CARD. Sized to the shrunk footprint and clipping to it
          (overflow-hidden), while the frame itself (border, radius, shadow)
          stays crisp at full strength rather than thinning out along with a
          scaled-down page, the same reason StorefrontPreview keeps its own
          background on the unscaled box. Height comes from the page's own
          measured natural height (see useNaturalSize): before that lands,
          it is simply unset and the box sizes to the (still full-height,
          pre-scale) content underneath, which is the same "assume it fits"
          fallback useFitToBox uses while its own first measurement is
          pending. */}
      <div
        data-artboard-card=""
        className="overflow-hidden rounded-md border border-border bg-background shadow-lg"
        style={{
          width: scaledWidth,
          height: naturalSize.height > 0 ? naturalSize.height * PRODUCT_PAGE_SCALE : undefined,
        }}
      >
        {/* CLICK THE PAGE, GET THE SETTING. One delegated listener rather
            than a control wrapped around each region: the page is full of
            real interactive elements (the option radios, the section
            disclosures, the document links) and nesting them inside buttons
            would be both invalid markup and a worse page to read with a
            screen reader. Capture phase so the setting opens even when the
            thing clicked handles the event itself, unaffected by the scale
            below since a browser hit-tests and reports click coordinates
            against what is actually on screen, transform included.
            Rendered at the REAL width and scaled down in paint only (see
            PRODUCT_PAGE_SCALE), so the page inside lays out exactly as a
            buyer's browser would lay it out, just smaller: never a
            narrower render reflowing into a different shape. */}
        <div
          ref={contentRef}
          onClickCapture={openSettingForTarget}
          style={{ width, transform: `scale(${PRODUCT_PAGE_SCALE})`, transformOrigin: "top left" }}
        >
          <ProductPageView page={page} mode="preview" />
        </div>
      </div>
    </div>
  );
}

/** A faithful first frame from the catalogue row alone: no gallery, no
 *  options, no details and no purchase link until the action answers. */
function fromCatalogRow(product: Product, showStock: boolean): ProductPageProduct {
  const stock = deriveStockBadge(product);
  return {
    id: product.id,
    title: product.title,
    description: product.description,
    priceCents: Math.round(product.price * 100),
    currency: product.currency,
    purchaseUrl: null,
    // The catalogue row has no page facts, so the first frame shows the store
    // default; the real choice arrives with the preview load a tick later.
    shippingProfileId: null,
    images: product.imageUrl ? [{ url: product.imageUrl, alt: product.title }] : [],
    optionGroups: [],
    details: {},
    documents: [],
    isDigital: product.digitalFileName !== null,
    digitalFormat: null,
    stock,
    soldOut: stock?.state === "sold_out",
    // Derived by the same function the public builder uses, from the catalogue
    // row's own numbers, so the first frame cannot offer a quantity the real
    // page would not. The tile's sold-out SWITCH is not folded in here: it is
    // live in the editor, and the page hides the picker on `soldOut` anyway.
    maxQuantity: publicQuantityLimit(
      {
        maxPerOrder: product.maxPerOrder,
        trackStock: product.trackStock,
        stockQuantity: product.stockQuantity,
        lowStockThreshold: product.lowStockThreshold,
      },
      { stockShown: showStock },
    ),
  };
}

/** The tile's sold-out switch is live in the editor; the loaded facts are a
 *  snapshot from when the action ran. The switch wins. */
function withLiveSoldOut(product: ProductPageProduct, soldOut: boolean): ProductPageProduct {
  const next = soldOut || product.stock?.state === "sold_out";
  return next === product.soldOut ? product : { ...product, soldOut: next };
}

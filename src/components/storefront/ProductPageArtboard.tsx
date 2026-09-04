"use client";

import { useEffect, useState, type MouseEvent } from "react";
import { X } from "lucide-react";
import { ProductPageView } from "@/components/product-page/ProductPageView";
import { deriveStockBadge } from "@/lib/stock/badge";
import { getProductPagePreviewData } from "@/lib/products/preview-actions";
import { useSettingTarget } from "@/lib/storefront/setting-context";
import {
  PRODUCT_PAGE_HOTSPOTS,
  isProductPageHotspot,
} from "@/lib/storefront/setting-ref";
import type { Product, ProductPageProduct } from "@/types/product";
import type { ProductPageData } from "@/types/product-page";
import type {
  ProductPageConfig,
  StorefrontHeader,
  ShippingProfile,
  StorefrontPolicies,
  StorefrontSeller,
  StorefrontTheme,
} from "@/types/storefront";

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
 * SAME WIDTH AS THE BOARD, always — a real buyer reads the page in the exact
 * same browser window they read the storefront in, so the two are designed at
 * one shared scale (the caller hands down `width`) rather than the page
 * choosing an arbitrary "desktop" size of its own that has no relationship to
 * how big the storefront next to it looks. Height is natural, not a fixed
 * frame: a real page is exactly as tall as its content.
 */
export function ProductPageArtboard({
  product,
  soldOut,
  storefrontId,
  storefrontName,
  theme,
  header,
  productPage,
  policies,
  shippingProfiles,
  seller,
  backgroundImageUrl,
  customFontUrl,
  onClose,
  width,
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
  policies: StorefrontPolicies;
  shippingProfiles: ShippingProfile[];
  seller: StorefrontSeller;
  backgroundImageUrl: string | null;
  customFontUrl: string | null;
  onClose: () => void;
  /** The board's current width (design-view natural size, or mobile
   *  preview's simulated phone width) — this page renders at the same one. */
  width: number;
}) {
  // Null outside the designer (the dev gallery, a component test), which
  // simply means clicking the page opens nothing.
  const setting = useSettingTarget();

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
    getProductPagePreviewData(product.id)
      .then((result) => {
        if (!cancelled && result.ok) setLoaded(result.product);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [product.id]);

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
      policies,
      shippingProfiles,
      seller,
      backgroundImageUrl,
      customFontUrl,
    },
    product: withLiveSoldOut(loaded ?? fromCatalogRow(product), soldOut),
    productUrl: "",
  };

  return (
    <div
      data-artboard-id={product.id}
      className="flex shrink-0 flex-col gap-2"
      style={{ width }}
    >
      {/* The frame's label, outside the page itself: this chrome belongs to
          the editor, never to the design. */}
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate font-inter text-sm font-medium text-foreground">
          {product.title}
          <span className="text-muted-foreground"> · Product page</span>
        </p>
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

      {/* CLICK THE PAGE, GET THE SETTING. One delegated listener rather than a
          control wrapped around each region: the page is full of real
          interactive elements (the option radios, the section disclosures, the
          document links) and nesting them inside buttons would be both invalid
          markup and a worse page to read with a screen reader. Capture phase
          so the setting opens even when the thing clicked handles the event
          itself. */}
      <div
        className="overflow-hidden rounded-md border border-border bg-background shadow-lg"
        onClickCapture={openSettingForTarget}
      >
        <ProductPageView page={page} mode="preview" />
      </div>
    </div>
  );
}

/** A faithful first frame from the catalogue row alone: no gallery, no
 *  options, no details and no purchase link until the action answers. */
function fromCatalogRow(product: Product): ProductPageProduct {
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
  };
}

/** The tile's sold-out switch is live in the editor; the loaded facts are a
 *  snapshot from when the action ran. The switch wins. */
function withLiveSoldOut(product: ProductPageProduct, soldOut: boolean): ProductPageProduct {
  const next = soldOut || product.stock?.state === "sold_out";
  return next === product.soldOut ? product : { ...product, soldOut: next };
}

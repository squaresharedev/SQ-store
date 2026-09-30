"use client";

import { useEffect, useState } from "react";
import { deriveStockBadge } from "@/lib/stock/badge";
import { publicQuantityLimit } from "@/lib/products/quantity";
import { getProductPagePreviewData } from "@/lib/products/preview-actions";
import { useSampleMode } from "@/lib/storefront/sample-mode";
import type { Product, ProductPageProduct } from "@/types/product";

type PreviewResult = Awaited<ReturnType<typeof getProductPagePreviewData>>;

/**
 * Requests in flight, by product and stock visibility. The product page, the
 * checkout and the thank-you artboards for one product open together and all
 * want the same facts; they share one request instead of spending three of
 * the preview action's rate-limit tokens. Only IN-FLIGHT requests are shared:
 * a settled one is dropped, so reopening a page after editing the product
 * reads it afresh.
 */
const inflight = new Map<string, Promise<PreviewResult>>();

function loadPreview(productId: string, showStock: boolean): Promise<PreviewResult> {
  const key = `${productId}:${showStock}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  const request = getProductPagePreviewData(productId, false, showStock).finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, request);
  return request;
}

/**
 * THE PRODUCT AN ARTBOARD PREVIEWS: the buyer-safe product the public pages
 * would get, from the same builder (via the editor's preview action), so no
 * artboard can show a seller something a buyer would not get.
 *
 * Until it answers, the catalogue row the editor already holds paints a
 * faithful first frame; a failed load keeps that frame, because a preview has
 * no failure worth a toast. The sample storefront's products exist only in
 * code, so in sample mode the catalogue row IS the product.
 *
 * `soldOut` is the tile's manual flag, live in the editor, and it wins over
 * the snapshot the load returned.
 */
export function usePreviewProduct(product: Product, showStock: boolean, soldOut: boolean): ProductPageProduct {
  const [loaded, setLoaded] = useState<ProductPageProduct | null>(null);
  const sample = useSampleMode();
  useEffect(() => {
    if (sample) return;
    let cancelled = false;
    loadPreview(product.id, showStock)
      .then((result) => {
        if (!cancelled && result.ok) setLoaded(result.product);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [product.id, showStock, sample]);

  return withLiveSoldOut(loaded ?? fromCatalogRow(product, showStock), soldOut);
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

"use client";

import { createContext, useContext } from "react";
import type { Product } from "@/types/product";
import { boardProductIds, type StorefrontBand, type StorefrontBlock } from "@/types/storefront";
import type { LinkChoices, LinkableStorefront } from "./LinkDestinationField";

/**
 * What the layout workstream's panels need from the designer that is not
 * theirs to hold: where a link may lead (the board's products and bands, the
 * store's storefronts) and the display URLs of uploads (a band photo, the
 * header logo), with the way to add one. Provided once by StorefrontDesigner,
 * so the header's section and the band and button panels need no props
 * threaded through the shared panels around them. Null outside the designer.
 */
export type LayoutEditorValue = LinkChoices & {
  /** Display URLs by object key (the designer's page photo map). */
  photoUrls: Readonly<Record<string, string>>;
  /** A display URL for a key uploaded in this session. */
  onPhotoUrl: (key: string, url: string) => void;
};

const LayoutEditorContext = createContext<LayoutEditorValue | null>(null);

export const LayoutEditorProvider = LayoutEditorContext.Provider;

export function useLayoutEditor(): LayoutEditorValue | null {
  return useContext(LayoutEditorContext);
}

/** The places a link on this board may lead, from what the designer holds. */
export function linkChoicesFor(
  blocks: readonly StorefrontBlock[],
  bands: readonly StorefrontBand[],
  productsById: ReadonlyMap<string, Product>,
  storefronts: readonly LinkableStorefront[],
): LinkChoices {
  return {
    products: boardProductIds(blocks).flatMap((id) => {
      const product = productsById.get(id);
      return product ? [{ id, title: product.title }] : [];
    }),
    bands,
    storefronts,
  };
}

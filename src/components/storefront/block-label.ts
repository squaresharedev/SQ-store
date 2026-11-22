import type { MessageKey } from "@/i18n/types";
import type { Product } from "@/types/product";
import type { StorefrontBlock } from "@/types/storefront";

/** A translator over full message keys: `useTranslations()` with no namespace. */
export type KeyTranslator = (key: MessageKey) => string;

/**
 * WHAT A BLOCK IS CALLED, in one place.
 *
 * Two things name the objects on the canvas: the layers list, and the editor's
 * search field. They have to agree — a seller who reads "Sale ends Friday" in
 * the stack and types it into the search expects to find that block, and would
 * not accept "Text" as an answer.
 *
 * This lived inside LayersPanel until the search needed it too. It sits beside
 * the components rather than under lib/ because it reaches into the shape
 * library for its labels, and that is presentation.
 *
 * A seller's own words (a product title, a text block, an image description)
 * come back untouched; only the fallbacks and shape names are translated.
 */

/**
 * Falls back to the KIND rather than to "Untitled": an empty text block is
 * still recognisably text, and a row that says so is more use than one that
 * says nothing.
 */
export function blockLabel(
  block: StorefrontBlock,
  productsById: ReadonlyMap<string, Product>,
  t: KeyTranslator,
): string {
  switch (block.type) {
    case "product":
      return productsById.get(block.productId)?.title ?? t(BLOCK_KIND_LABELS.product);
    case "text": {
      const text = block.text.trim().replace(/\s+/g, " ");
      return text.length > 0 ? text : t(BLOCK_KIND_LABELS.text);
    }
    case "shape":
      return t(`Storefront.shapes.name.${block.kind}`);
    case "image":
      return block.alt.trim().length > 0 ? block.alt.trim() : t(BLOCK_KIND_LABELS.image);
    case "button":
    case "marquee": {
      const words = blockWords(block);
      return words.length > 0 ? words : t(BLOCK_KIND_LABELS[block.type]);
    }
    case "carousel":
      return t(BLOCK_KIND_LABELS.carousel);
  }
}

/**
 * The seller's own words on a block that is made of words: a text block's
 * text, a button's label, a scrolling strip's line. Trimmed, on one line.
 * Empty for every other kind, and for one of these with nothing typed yet.
 */
export function blockWords(block: StorefrontBlock): string {
  const words = block.type === "text" || block.type === "marquee" ? block.text : block.type === "button" ? block.label : "";
  return words.trim().replace(/\s+/g, " ");
}

/** The kind, spelled out under the name. A text block's name IS its words, so
 *  without this line there is nothing saying which of four things it is. */
export const BLOCK_KIND_LABELS: Record<StorefrontBlock["type"], MessageKey> = {
  product: "Storefront.blockKinds.product",
  text: "Storefront.blockKinds.text",
  shape: "Storefront.blockKinds.shape",
  image: "Storefront.blockKinds.image",
  button: "Storefront.blockKinds.button",
  marquee: "Storefront.blockKinds.marquee",
  carousel: "Storefront.blockKinds.carousel",
};

/**
 * What else someone might call this block when searching for it.
 *
 * Only what the label and the kind do not already say. A shape's own kind
 * ("Star") is its label, so the useful extra is the words for the family it
 * belongs to; a product's title says nothing about it being a product tile.
 */
export function blockKeywords(block: StorefrontBlock): string[] {
  switch (block.type) {
    case "product":
      return ["product tile", "item", "listing"];
    case "text":
      return ["words", "caption", "heading", "label"];
    case "shape":
      return ["shape", block.kind, "graphic"];
    case "image":
      return ["element", "picture", "graphic", "artwork", "logo"];
    case "button":
      return ["button", "link", "call to action"];
    case "marquee":
      return ["scrolling text", "ticker", "strip", "marquee"];
    case "carousel":
      return ["carousel", "slider", "products", "row"];
  }
}

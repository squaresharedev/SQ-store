import type { Product } from "@/types/product";
import type { StorefrontBlock } from "@/types/storefront";
import { SHAPE_SPECS } from "./shape-specs";

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
 */

/**
 * Falls back to the KIND rather than to "Untitled": an empty text block is
 * still recognisably text, and a row that says so is more use than one that
 * says nothing.
 */
export function blockLabel(
  block: StorefrontBlock,
  productsById: ReadonlyMap<string, Product>,
): string {
  switch (block.type) {
    case "product":
      return productsById.get(block.productId)?.title ?? "Product";
    case "text": {
      const text = block.text.trim().replace(/\s+/g, " ");
      return text.length > 0 ? text : "Text";
    }
    case "shape":
      return SHAPE_SPECS[block.kind].label;
    case "image":
      return block.alt.trim().length > 0 ? block.alt.trim() : "Image";
  }
}

/** The kind, spelled out under the name. A text block's name IS its words, so
 *  without this line there is nothing saying which of four things it is. */
export const BLOCK_KIND_LABELS: Record<StorefrontBlock["type"], string> = {
  product: "Product",
  text: "Text",
  shape: "Shape",
  image: "Image",
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
  }
}

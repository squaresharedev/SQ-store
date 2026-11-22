import { productPhotoPath } from "@/lib/products/paths";
import type { Product } from "@/types/product";
import {
  blockKey,
  resolveCardStyle,
  type CardStyle,
  type PhotoEdge,
  type ProductBlock,
  type StorefrontBlock,
  type StorefrontTheme,
} from "@/types/storefront";

/**
 * WHAT IS AT A PRODUCT PHOTO'S EDGES: near-white all round, or anything else.
 *
 * Two card looks depend on it. `whiteBlend: "auto"` blends only a photo whose
 * edges are near-white (a studio shot), and the `shadow` title style swaps its
 * dark fade for a pale one over such a photo, where a dark fade reads as a
 * muddy grey smudge.
 *
 * WHERE IT IS MEASURED: IN THE DESIGNER, ONCE, AND CACHED ON THE BLOCK.
 *
 * A canvas can only read pixels from its own origin (or one that answers with
 * CORS). A product photo is a presigned R2 URL on another origin, and this app
 * deliberately relies on no CORS rule on the bucket (see the photo route), so
 * a buyer's page cannot measure the photo it shows. The designer can: the
 * signed-in seller has a same-origin copy of every product photo at
 * GET /api/products/[id]/photo. So the designer measures, writes the answer to
 * `ProductBlock.photoEdge`, and the saved storefront carries it. A buyer's page
 * (hosted or embedded) then blends on its first paint, with no measuring, no
 * second download and no flash.
 *
 * A PHOTO THAT CANNOT BE MEASURED IS LEFT ALONE: no `photoEdge`, so `auto`
 * does not blend it. Never a guess.
 *
 * Measuring squashes the photo to a small square and reads a ring of pixels
 * round its border, composited over white (a cut-out PNG's transparent edge IS
 * the card behind it, which blending can only help). The ring is the photo's
 * own edge, not the tile's crop of it: for a studio shot the two are the same
 * backdrop, and it keeps the answer a fact about the photo, so one measurement
 * serves every tile the product is on.
 */

/** The side, in px, of the square a photo is shrunk to before it is read. */
export const PHOTO_EDGE_SAMPLE_PX = 48;

/** How deep the ring read round the border is, in sample px. */
export const PHOTO_EDGE_RING_PX = 2;

/** A pixel is near-white when its darkest channel is at least this... */
export const NEAR_WHITE_MIN_CHANNEL = 236;

/** ...and its channels sit within this of each other: a pale tint is a
 *  colour, and multiplying it into the card would leave its box behind. */
export const NEAR_WHITE_MAX_SPREAD = 14;

/** The share of the ring that has to be near-white. Not all of it: a product
 *  touching one edge (a shoe's sole, a vase's foot) is still a studio shot. */
export const NEAR_WHITE_SHARE = 0.88;

/**
 * Classify a photo from its RGBA pixels (row-major, 4 bytes a pixel): white
 * when at least NEAR_WHITE_SHARE of the border ring is near-white. Pure, so
 * every rule here is testable without a canvas.
 */
export function classifyPhotoEdge(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  ring = PHOTO_EDGE_RING_PX,
): PhotoEdge {
  if (width <= 0 || height <= 0) return "other";
  const depth = Math.max(1, Math.min(ring, Math.floor(width / 2), Math.floor(height / 2)));
  let total = 0;
  let white = 0;
  for (let y = 0; y < height; y += 1) {
    const edgeRow = y < depth || y >= height - depth;
    for (let x = 0; x < width; x += 1) {
      if (!edgeRow && x >= depth && x < width - depth) continue;
      const at = (y * width + x) * 4;
      // Over white: a see-through pixel shows the card, which blending suits.
      const alpha = (rgba[at + 3] ?? 255) / 255;
      const r = rgba[at] * alpha + 255 * (1 - alpha);
      const g = rgba[at + 1] * alpha + 255 * (1 - alpha);
      const b = rgba[at + 2] * alpha + 255 * (1 - alpha);
      const low = Math.min(r, g, b);
      const high = Math.max(r, g, b);
      total += 1;
      if (low >= NEAR_WHITE_MIN_CHANNEL && high - low <= NEAR_WHITE_MAX_SPREAD) white += 1;
    }
  }
  return total > 0 && white / total >= NEAR_WHITE_SHARE ? "white" : "other";
}

/**
 * Whether a card's look depends on its photo's edge: an `auto` blend, or a
 * `shadow` title (which turns pale over a white edge). Only these cards are
 * measured and carry a `photoEdge`, so a storefront that uses neither never
 * has one written to it.
 */
export function cardNeedsPhotoEdge(card: Pick<CardStyle, "whiteBlend" | "titleStyle">): boolean {
  return card.whiteBlend === "auto" || card.titleStyle === "shadow";
}

/**
 * Where the designer can read a product's photo from: the photo itself when
 * it is already on this origin (the sample storefront's, the dev gallery's),
 * else the signed-in seller's same-origin copy. The sample has no copy (its
 * products exist only in code), so a cross-origin sample photo has none.
 */
export function photoEdgeSource(product: Pick<Product, "id" | "imageUrl">, sample: boolean): string | null {
  const url = product.imageUrl;
  if (!url) return null;
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  return sample ? null : productPhotoPath(product.id);
}

/** What identifies one photo across a session: the product, and the photo's
 *  address without its signature (a presigned URL changes every load, its
 *  object key only when the seller changes the photo). */
export function photoEdgeCacheKey(product: Pick<Product, "id" | "imageUrl">): string {
  return `${product.id}|${(product.imageUrl ?? "").split("?")[0]}`;
}

/**
 * Measure one photo in the browser: shrink it onto a white square and read its
 * border. Null when it cannot be read (it failed to load, or its pixels are on
 * another origin and the canvas refuses them): the photo is then left alone.
 */
export async function measurePhotoEdge(src: string): Promise<PhotoEdge | null> {
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = src;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = PHOTO_EDGE_SAMPLE_PX;
    canvas.height = PHOTO_EDGE_SAMPLE_PX;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, PHOTO_EDGE_SAMPLE_PX, PHOTO_EDGE_SAMPLE_PX);
    context.drawImage(image, 0, 0, PHOTO_EDGE_SAMPLE_PX, PHOTO_EDGE_SAMPLE_PX);
    const { data } = context.getImageData(0, 0, PHOTO_EDGE_SAMPLE_PX, PHOTO_EDGE_SAMPLE_PX);
    return classifyPhotoEdge(data, PHOTO_EDGE_SAMPLE_PX, PHOTO_EDGE_SAMPLE_PX);
  } catch {
    return null;
  }
}

/** One measurement per photo per page session, shared by every tile it is on
 *  and by every effect run that asks again while it is still in flight. */
const measured = new Map<string, Promise<PhotoEdge | null>>();

/** The photo's edge, measured once per session (see photoEdgeCacheKey). */
export function cachedPhotoEdge(
  product: Pick<Product, "id" | "imageUrl">,
  sample: boolean,
  measure: (src: string) => Promise<PhotoEdge | null> = measurePhotoEdge,
): Promise<PhotoEdge | null> {
  const src = photoEdgeSource(product, sample);
  if (!src) return Promise.resolve(null);
  const key = photoEdgeCacheKey(product);
  let pending = measured.get(key);
  if (!pending) {
    pending = measure(src);
    measured.set(key, pending);
  }
  return pending;
}

/** The product blocks on a board whose look depends on their photo's edge and
 *  whose product has a photo: what the designer measures. */
export function blocksNeedingPhotoEdge(
  theme: StorefrontTheme,
  blocks: readonly StorefrontBlock[],
  products: ReadonlyMap<string, Pick<Product, "id" | "imageUrl">>,
): { block: ProductBlock; product: Pick<Product, "id" | "imageUrl"> }[] {
  return blocks.flatMap((block) => {
    if (block.type !== "product") return [];
    const product = products.get(block.productId);
    if (!product?.imageUrl) return [];
    return cardNeedsPhotoEdge(resolveCardStyle(theme, block.style)) ? [{ block, product }] : [];
  });
}

/**
 * Lay measured edges (by block key) onto the blocks. Hands back the SAME array
 * when nothing differs, so a board whose cache is already right costs nothing.
 * Every other member of a block is carried as it is (its phone layout too).
 */
export function withPhotoEdges(
  blocks: StorefrontBlock[],
  edges: ReadonlyMap<string, PhotoEdge>,
): StorefrontBlock[] {
  let changed = false;
  const next = blocks.map((block) => {
    if (block.type !== "product") return block;
    const edge = edges.get(blockKey(block));
    if (edge === undefined || edge === block.photoEdge) return block;
    changed = true;
    return { ...block, photoEdge: edge };
  });
  return changed ? next : blocks;
}

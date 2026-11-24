import { productPhotoPath } from "@/lib/products/paths";
import { PHOTO_EDGES, type PhotoEdge, type Product } from "@/types/product";
import { resolveCardStyle, type CardStyle, type StorefrontBlock, type StorefrontTheme } from "@/types/storefront";

/**
 * WHAT IS AT A PRODUCT PHOTO'S EDGES: near-white all round, or anything else.
 *
 * Two card looks depend on it. `whiteBlend: "auto"` blends only a photo whose
 * edges are near-white (a studio shot), and the `shadow` title style swaps its
 * dark fade for a pale one over such a photo, where a dark fade reads as a
 * muddy grey smudge.
 *
 * A FACT ABOUT THE PHOTO, STORED WITH THE PRODUCT. products.photo_edge
 * (Product.photoEdge) holds the answer for the photo in image_key and no
 * other: the database clears it whenever the photo changes (migration
 * 20261123_product_photo_edge). So one measurement serves every storefront
 * the product is on, a board built through the MCP blends as soon as its
 * photos are measured, and measuring never touches a storefront: nothing is
 * marked unsaved, no config changes.
 *
 * WHERE IT IS MEASURED: IN THE SELLER'S BROWSER, NEVER ON THE SERVER (decoding
 * a photo costs more CPU than a Worker request has).
 *   - As a photo is uploaded, from the file the browser already holds
 *     (ProductForm, the only place a product's main photo is uploaded).
 *   - For a photo with no answer yet (one stored before this existed, or
 *     uploaded through the MCP), the designer and the Products list measure
 *     the seller's same-origin copy, GET /api/products/[id]/photo, which says
 *     which photo it served (PHOTO_KEY_HEADER). See usePhotoEdgeBackfill.
 * Either way the answer is stored by recordPhotoEdge
 * (lib/products/photo-edge-actions), against the photo that was measured.
 *
 * WHY A BUYER'S PAGE NEVER MEASURES. A canvas can only read pixels from its
 * own origin (or one that answers with CORS). A product photo is a presigned
 * R2 URL on another origin, and this app deliberately relies on no CORS rule
 * on the bucket (see the photo route). So a buyer's page (hosted, embedded,
 * the MCP preview) is HANDED the stored answer (lib/storefront/tile-extras)
 * and blends on its first paint, with no second download and no flash.
 *
 * A PHOTO NOT MEASURED YET IS LEFT ALONE: no photoEdge, so `auto` does not
 * blend it. Never a guess.
 *
 * Measuring squashes the photo to a small square and reads a ring of pixels
 * round its border, composited over white (a cut-out PNG's transparent edge IS
 * the card behind it, which blending can only help). The ring is the photo's
 * own edge, not a tile's crop of it: for a studio shot the two are the same
 * backdrop, and it keeps the answer a fact about the photo.
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

/** The response header the photo route names the photo it served in (its
 *  storage key), so a measurement is recorded against THAT photo and a late
 *  answer about a replaced one lands nowhere. Seller-only, same origin. */
export const PHOTO_KEY_HEADER = "X-Photo-Key";

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

/** Whether a value is one of the answers (PHOTO_EDGES): what every read and
 *  write of a stored or reported value is gated by. */
export function isPhotoEdge(value: unknown): value is PhotoEdge {
  return typeof value === "string" && (PHOTO_EDGES as readonly string[]).includes(value);
}

/**
 * THE READ SIDE: a product row's stored answer, or undefined. Only for a
 * product that has a photo, and only a value from the enum: the database's
 * CHECK says the same, and a stored value is trusted exactly as far as it
 * still passes the rule. Every read of the column goes through here (the
 * seller's catalogue, the card extras a buyer's board is handed).
 */
export function readPhotoEdge(row: { image_key: string | null; photo_edge?: string | null }): PhotoEdge | undefined {
  return row.image_key && isPhotoEdge(row.photo_edge) ? row.photo_edge : undefined;
}

/**
 * Whether a card's look depends on its photo's edge: an `auto` blend, or a
 * `shadow` title (which turns pale over a white edge). A buyer's board is
 * handed the edge only for these cards, so a board that uses neither is
 * handed exactly what it always was.
 */
export function cardNeedsPhotoEdge(card: Pick<CardStyle, "whiteBlend" | "titleStyle">): boolean {
  return card.whiteBlend === "auto" || card.titleStyle === "shadow";
}

/** The products on a board whose card's look depends on their photo's edge
 *  (each once, however many cards it has): what the designer makes sure is
 *  measured. Products with no photo, or not in the catalogue, are left out. */
export function productsNeedingPhotoEdge<P extends Pick<Product, "id" | "imageUrl">>(
  theme: StorefrontTheme,
  blocks: readonly StorefrontBlock[],
  products: ReadonlyMap<string, P>,
): P[] {
  const found = new Map<string, P>();
  for (const block of blocks) {
    if (block.type !== "product" || found.has(block.productId)) continue;
    const product = products.get(block.productId);
    if (product?.imageUrl && cardNeedsPhotoEdge(resolveCardStyle(theme, block.style))) found.set(product.id, product);
  }
  return [...found.values()];
}

/** Lay a product's answer on a list of products. Hands back the SAME list when
 *  nothing differs, so an answer already shown costs no render. */
export function withPhotoEdge<P extends Pick<Product, "id" | "photoEdge">>(
  products: readonly P[],
  productId: string,
  edge: PhotoEdge,
): P[] {
  if (!products.some((product) => product.id === productId && product.photoEdge !== edge)) return products as P[];
  return products.map((product) => (product.id === productId ? { ...product, photoEdge: edge } : product));
}

/** A photo already on this origin (the sample storefront's, a dev gallery's):
 *  its pixels can be read directly, and there is nothing to store, since such
 *  a product exists only in code. Null for anything else. */
export function localPhotoSource(imageUrl: string | null | undefined): string | null {
  return imageUrl && imageUrl.startsWith("/") && !imageUrl.startsWith("//") ? imageUrl : null;
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

/** Measure a photo the browser holds as bytes: a file being uploaded, or the
 *  photo route's answer. A blob URL is this origin's, so the canvas reads it. */
export async function measurePhotoBlob(blob: Blob): Promise<PhotoEdge | null> {
  let url: string | null = null;
  try {
    url = URL.createObjectURL(blob);
    return await measurePhotoEdge(url);
  } catch {
    return null;
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}

/** What measuring a stored photo through the photo route came to. `busy`: the
 *  route's budget is spent (429), so the session stops asking for a while. */
export type StoredPhotoMeasurement =
  | { status: "measured"; photoKey: string; edge: PhotoEdge }
  | { status: "busy" }
  | { status: "unreadable" };

/**
 * Measure a product's CURRENT photo through the seller's same-origin copy, and
 * say which photo that was (PHOTO_KEY_HEADER). Never throws.
 */
export async function measureStoredPhoto(
  productId: string,
  load: typeof fetch = fetch,
  measure: (blob: Blob) => Promise<PhotoEdge | null> = measurePhotoBlob,
): Promise<StoredPhotoMeasurement> {
  try {
    const response = await load(productPhotoPath(productId), { credentials: "same-origin" });
    if (response.status === 429) return { status: "busy" };
    const photoKey = response.headers.get(PHOTO_KEY_HEADER);
    if (!response.ok || !photoKey) return { status: "unreadable" };
    const edge = await measure(await response.blob());
    return edge ? { status: "measured", photoKey, edge } : { status: "unreadable" };
  } catch {
    return { status: "unreadable" };
  }
}

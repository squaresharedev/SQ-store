import { describe, expect, it, vi } from "vitest";
import {
  NEAR_WHITE_SHARE,
  blocksNeedingPhotoEdge,
  cachedPhotoEdge,
  cardNeedsPhotoEdge,
  classifyPhotoEdge,
  photoEdgeCacheKey,
  photoEdgeSource,
  withPhotoEdges,
} from "@/lib/storefront/photo-edge";
import { productPhotoPath } from "@/lib/products/paths";
import {
  DEFAULT_STOREFRONT_CONFIG,
  resolveCardStyle,
  type ProductBlock,
  type StorefrontBlock,
  type StorefrontTheme,
} from "@/types/storefront";

/**
 * WHAT IS AT A PHOTO'S EDGES (lib/storefront/photo-edge): the measurement
 * behind `whiteBlend: "auto"` and the pale `shadow` fade, and the rules for
 * which cards are measured and how the answer is cached on the board.
 */

const SIDE = 10;

/** A SIDE x SIDE photo of one colour, with an optional block of another
 *  colour painted over part of it. */
function photo(
  background: [number, number, number, number?],
  product?: { color: [number, number, number]; x0: number; y0: number; x1: number; y1: number },
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(SIDE * SIDE * 4);
  for (let y = 0; y < SIDE; y += 1) {
    for (let x = 0; x < SIDE; x += 1) {
      const inProduct = product && x >= product.x0 && x < product.x1 && y >= product.y0 && y < product.y1;
      const [r, g, b] = inProduct ? product.color : background;
      const a = inProduct ? 255 : (background[3] ?? 255);
      data.set([r, g, b, a], (y * SIDE + x) * 4);
    }
  }
  return data;
}

describe("classifying a photo's edge", () => {
  it("calls a white studio shot white, whatever sits in the middle", () => {
    const shot = photo([250, 250, 250], { color: [20, 60, 140], x0: 3, y0: 3, x1: 7, y1: 7 });
    expect(classifyPhotoEdge(shot, SIDE, SIDE)).toBe("white");
  });

  it("keeps a product that touches one edge a studio shot", () => {
    // The product runs off the bottom: two of the ring's 64 pixels in each of
    // the bottom two rows, well inside the share that may be something else.
    const shot = photo([255, 255, 255], { color: [30, 30, 30], x0: 4, y0: 3, x1: 6, y1: 10 });
    expect(classifyPhotoEdge(shot, SIDE, SIDE)).toBe("white");
  });

  it("does not call a grey backdrop, a pale tint or a busy edge white", () => {
    expect(classifyPhotoEdge(photo([225, 225, 228]), SIDE, SIDE)).toBe("other");
    expect(classifyPhotoEdge(photo([255, 240, 220]), SIDE, SIDE)).toBe("other");
    const busy = photo([255, 255, 255], { color: [80, 120, 60], x0: 0, y0: 0, x1: 10, y1: 4 });
    expect(classifyPhotoEdge(busy, SIDE, SIDE)).toBe("other");
  });

  it("reads a see-through edge as the card behind it, which blending suits", () => {
    expect(classifyPhotoEdge(photo([0, 0, 0, 0]), SIDE, SIDE)).toBe("white");
  });

  it("asks for most of the ring, not all of it", () => {
    expect(NEAR_WHITE_SHARE).toBeGreaterThan(0.75);
    expect(NEAR_WHITE_SHARE).toBeLessThan(1);
  });

  it("answers an empty picture with other, never white", () => {
    expect(classifyPhotoEdge(new Uint8ClampedArray(0), 0, 0)).toBe("other");
  });
});

const theme = (over: Partial<StorefrontTheme> = {}): StorefrontTheme => ({
  ...structuredClone(DEFAULT_STOREFRONT_CONFIG.theme),
  ...over,
});

const A = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const B = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const card = (productId: string, over: Partial<ProductBlock> = {}): ProductBlock => ({
  type: "product",
  productId,
  x: 0,
  y: 0,
  w: 1,
  h: 1,
  ...over,
});

describe("which cards are measured", () => {
  it("only cards whose look depends on the edge: an auto blend or a shadow title", () => {
    expect(cardNeedsPhotoEdge(resolveCardStyle(theme()))).toBe(false);
    expect(cardNeedsPhotoEdge(resolveCardStyle(theme({ whiteBlend: "on" })))).toBe(false);
    expect(cardNeedsPhotoEdge(resolveCardStyle(theme({ whiteBlend: "auto" })))).toBe(true);
    expect(cardNeedsPhotoEdge(resolveCardStyle(theme({ titleStyle: "shadow" })))).toBe(true);
  });

  it("reads each card through its own style, and skips a product with no photo", () => {
    const products = new Map([
      [A, { id: A, imageUrl: "/a.webp" }],
      [B, { id: B, imageUrl: null }],
    ]);
    const blocks: StorefrontBlock[] = [card(A, { style: { whiteBlend: "auto" } }), card(B, { style: { whiteBlend: "auto" } })];
    expect(blocksNeedingPhotoEdge(theme(), blocks, products).map(({ block }) => block.productId)).toEqual([A]);
    // A legacy board measures nothing, so nothing is ever written to it.
    expect(blocksNeedingPhotoEdge(theme(), [card(A)], products)).toEqual([]);
  });
});

describe("where a photo is read from", () => {
  it("reads a photo on this origin directly, and the seller's own copy of a signed one", () => {
    expect(photoEdgeSource({ id: A, imageUrl: "/sample-storefront/camera.webp" }, true)).toBe("/sample-storefront/camera.webp");
    expect(photoEdgeSource({ id: A, imageUrl: "https://bucket.r2.test/images/a.webp?X-Amz-Signature=1" }, false)).toBe(productPhotoPath(A));
  });

  it("has nothing to read for the sample's cross-origin photo, nor for no photo", () => {
    expect(photoEdgeSource({ id: A, imageUrl: "https://elsewhere.test/a.webp" }, true)).toBeNull();
    expect(photoEdgeSource({ id: A, imageUrl: "//elsewhere.test/a.webp" }, true)).toBeNull();
    expect(photoEdgeSource({ id: A, imageUrl: null }, false)).toBeNull();
  });

  it("knows one photo by its object, not by a signature that changes every load", () => {
    const signed = (sig: string) => ({ id: A, imageUrl: `https://bucket.r2.test/images/a.webp?X-Amz-Signature=${sig}` });
    expect(photoEdgeCacheKey(signed("1"))).toBe(photoEdgeCacheKey(signed("2")));
    expect(photoEdgeCacheKey(signed("1"))).not.toBe(photoEdgeCacheKey({ id: A, imageUrl: "https://bucket.r2.test/images/b.webp" }));
  });

  it("measures each photo once a session, however many tiles ask", async () => {
    const measure = vi.fn(async () => "white" as const);
    const product = { id: B, imageUrl: "/once.webp" };
    const [first, second] = await Promise.all([cachedPhotoEdge(product, false, measure), cachedPhotoEdge(product, false, measure)]);
    expect([first, second]).toEqual(["white", "white"]);
    expect(measure).toHaveBeenCalledTimes(1);
    expect(measure).toHaveBeenCalledWith("/once.webp");
  });

  it("does not try a photo it cannot read", async () => {
    const measure = vi.fn(async () => "white" as const);
    expect(await cachedPhotoEdge({ id: A, imageUrl: "https://elsewhere.test/x.webp" }, true, measure)).toBeNull();
    expect(measure).not.toHaveBeenCalled();
  });
});

describe("caching the answer on the board", () => {
  it("lays the measured edge on the right card, and keeps the rest of it", () => {
    const blocks: StorefrontBlock[] = [card(A, { mobile: { x: 0, y: 2 } } as Partial<ProductBlock>), card(B, { x: 1 })];
    const next = withPhotoEdges(blocks, new Map([[`p_${A}`, "white" as const]]));
    expect(next[0]).toEqual({ ...blocks[0], photoEdge: "white" });
    expect(next[1]).toBe(blocks[1]);
  });

  it("hands back the same board when nothing changes", () => {
    const blocks: StorefrontBlock[] = [card(A, { photoEdge: "white" })];
    expect(withPhotoEdges(blocks, new Map([[`p_${A}`, "white" as const]]))).toBe(blocks);
    expect(withPhotoEdges(blocks, new Map())).toBe(blocks);
  });
});

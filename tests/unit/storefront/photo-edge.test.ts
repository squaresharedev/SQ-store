import { describe, expect, it, vi } from "vitest";
import {
  NEAR_WHITE_SHARE,
  PHOTO_KEY_HEADER,
  cardNeedsPhotoEdge,
  classifyPhotoEdge,
  isPhotoEdge,
  localPhotoSource,
  measureStoredPhoto,
  photoEdgeCacheKey,
  productsNeedingPhotoEdge,
  readPhotoEdge,
  withPhotoEdge,
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
 * behind `whiteBlend: "auto"` and the pale `shadow` fade, how a stored answer
 * is read back (a fact about the product's CURRENT photo), which products the
 * designer has measured, and how a stored photo is measured through the
 * seller's same-origin copy.
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

describe("reading a stored answer", () => {
  const KEY = "images/u/a-photo.webp";

  it("hands back the answer for a product with a photo", () => {
    expect(readPhotoEdge({ image_key: KEY, photo_edge: "white" })).toBe("white");
    expect(readPhotoEdge({ image_key: KEY, photo_edge: "other" })).toBe("other");
  });

  it("knows nothing before the photo is measured, or of a product with no photo", () => {
    expect(readPhotoEdge({ image_key: KEY, photo_edge: null })).toBeUndefined();
    expect(readPhotoEdge({ image_key: KEY })).toBeUndefined();
    // An answer left behind by a photo that is gone says nothing.
    expect(readPhotoEdge({ image_key: null, photo_edge: "white" })).toBeUndefined();
  });

  it("trusts only a value from the list", () => {
    expect(readPhotoEdge({ image_key: KEY, photo_edge: "grey" })).toBeUndefined();
    expect(isPhotoEdge("white")).toBe(true);
    expect(isPhotoEdge("WHITE")).toBe(false);
    expect(isPhotoEdge(undefined)).toBe(false);
  });
});

describe("which cards read it", () => {
  it("only cards whose look depends on the edge: an auto blend or a shadow title", () => {
    expect(cardNeedsPhotoEdge(resolveCardStyle(theme()))).toBe(false);
    expect(cardNeedsPhotoEdge(resolveCardStyle(theme({ whiteBlend: "on" })))).toBe(false);
    expect(cardNeedsPhotoEdge(resolveCardStyle(theme({ whiteBlend: "auto" })))).toBe(true);
    expect(cardNeedsPhotoEdge(resolveCardStyle(theme({ titleStyle: "shadow" })))).toBe(true);
  });

  it("names each such product once, through each card's own style, and skips one with no photo", () => {
    const products = new Map([
      [A, { id: A, imageUrl: "/a.webp" }],
      [B, { id: B, imageUrl: null }],
    ]);
    const blocks: StorefrontBlock[] = [
      card(A, { style: { whiteBlend: "auto" } }),
      card(A, { x: 1, style: { titleStyle: "shadow" } }),
      card(B, { x: 2, style: { whiteBlend: "auto" } }),
    ];
    expect(productsNeedingPhotoEdge(theme(), blocks, products).map((product) => product.id)).toEqual([A]);
    // A legacy board measures nothing.
    expect(productsNeedingPhotoEdge(theme(), [card(A)], products)).toEqual([]);
  });
});

describe("laying an answer on the products a page shows", () => {
  const products = [
    { id: A, imageUrl: "/a.webp" },
    { id: B, imageUrl: "/b.webp", photoEdge: "other" as const },
  ];

  it("sets it on the right product and keeps the rest", () => {
    const next = withPhotoEdge(products, A, "white");
    expect(next[0]).toEqual({ ...products[0], photoEdge: "white" });
    expect(next[1]).toBe(products[1]);
  });

  it("hands back the same list when it already says so", () => {
    expect(withPhotoEdge(products, B, "other")).toBe(products);
    expect(withPhotoEdge(products, "nobody", "white")).toBe(products);
  });
});

describe("where a photo is read from", () => {
  it("reads a photo on this origin directly, and nothing else", () => {
    expect(localPhotoSource("/sample-storefront/camera.webp")).toBe("/sample-storefront/camera.webp");
    expect(localPhotoSource("https://bucket.r2.test/images/a.webp?X-Amz-Signature=1")).toBeNull();
    expect(localPhotoSource("//elsewhere.test/a.webp")).toBeNull();
    expect(localPhotoSource(null)).toBeNull();
  });

  it("knows one photo by its object, not by a signature that changes every load", () => {
    const signed = (sig: string) => ({ id: A, imageUrl: `https://bucket.r2.test/images/a.webp?X-Amz-Signature=${sig}` });
    expect(photoEdgeCacheKey(signed("1"))).toBe(photoEdgeCacheKey(signed("2")));
    expect(photoEdgeCacheKey(signed("1"))).not.toBe(photoEdgeCacheKey({ id: A, imageUrl: "https://bucket.r2.test/images/b.webp" }));
  });
});

describe("measuring a stored photo through the seller's own copy", () => {
  const answer = (status: number, key?: string) =>
    vi.fn(
      async () =>
        // Bytes, not a jsdom Blob: Node 22 (CI) refuses a foreign Blob as a body.
        new Response(status === 200 ? new Uint8Array([1, 2, 3]) : null, {
          status,
          headers: key ? { [PHOTO_KEY_HEADER]: key } : {},
        }),
    );
  const asFetch = (load: unknown) => load as typeof fetch;

  it("reads the route, and says which photo it measured", async () => {
    const load = answer(200, "images/u/a-photo.webp");
    const measure = vi.fn(async () => "white" as const);
    expect(await measureStoredPhoto(A, asFetch(load), measure)).toEqual({
      status: "measured",
      photoKey: "images/u/a-photo.webp",
      edge: "white",
    });
    expect(load).toHaveBeenCalledWith(productPhotoPath(A), { credentials: "same-origin" });
    expect(measure).toHaveBeenCalledTimes(1);
  });

  it("measures nothing it cannot pin to a photo, or cannot read", async () => {
    const measure = vi.fn(async () => "white" as const);
    expect(await measureStoredPhoto(A, asFetch(answer(200)), measure)).toEqual({ status: "unreadable" });
    expect(await measureStoredPhoto(A, asFetch(answer(404)), measure)).toEqual({ status: "unreadable" });
    expect(measure).not.toHaveBeenCalled();
    const unreadable = vi.fn(async () => null);
    expect(await measureStoredPhoto(A, asFetch(answer(200, "images/u/k.webp")), unreadable)).toEqual({
      status: "unreadable",
    });
    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await measureStoredPhoto(A, asFetch(offline), measure)).toEqual({ status: "unreadable" });
  });

  it("says when the route's budget is spent, so the session can stop asking", async () => {
    expect(await measureStoredPhoto(A, asFetch(answer(429)))).toEqual({ status: "busy" });
  });
});

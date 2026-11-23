// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  CAROUSEL_NEW_ROWS,
  CAROUSEL_STARTING_PRODUCTS,
  carouselInsertSize,
  keepProducts,
  moveCarouselProduct,
  newCarouselBlock,
  startingCarouselProducts,
  withCarouselProducts,
} from "@/lib/storefront/carousel";
import { withoutDeadLinks } from "@/lib/storefront/layout-blocks";
import { placedProductIds } from "@/lib/storefront/placed-products";
import { tileExtrasWanted } from "@/lib/storefront/tile-extras";
import { storefrontStructuredData } from "@/lib/seo/structured-data";
import { storefrontConfigSchema } from "@/lib/validation/storefront";
import {
  CAROUSEL_PRODUCTS_MAX,
  DEFAULT_STOREFRONT_CONFIG,
  boardProductIds,
  type CarouselBlock,
  type StorefrontBlock,
} from "@/types/storefront";
import type { StorefrontPageData } from "@/types/storefront-page";

vi.mock("@/lib/r2", () => ({ presignGetUrl: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
const { placementOf } = await import("@/lib/products/purchasable");

// THE PRODUCT CAROUSEL'S PURE RULES, and every place that asks "is this
// product on this storefront" counting its members (one answer:
// boardProductIds).

const A = "a0000000-0000-4000-8000-000000000001";
const B = "a0000000-0000-4000-8000-000000000002";
const C = "a0000000-0000-4000-8000-000000000003";
const D = "a0000000-0000-4000-8000-000000000004";
const CAROUSEL = "c0000000-0000-4000-8000-000000000001";
const OTHER_CAROUSEL = "c0000000-0000-4000-8000-000000000002";
const BUTTON = "b0000000-0000-4000-8000-000000000001";

const carousel = (productIds: string[], over: Partial<CarouselBlock> = {}): CarouselBlock => ({
  type: "carousel",
  id: CAROUSEL,
  productIds,
  x: 0,
  y: 2,
  w: 6,
  h: 2,
  ...over,
});
const tile = (productId: string, x = 0): StorefrontBlock => ({ type: "product", productId, x, y: 0, w: 1, h: 1 });
const text: StorefrontBlock = { type: "text", id: BUTTON, text: "Hi", variant: "heading", align: "left", x: 3, y: 0, w: 2, h: 1 };

describe("a new carousel", () => {
  it("lands across the board's full width, two rows tall", () => {
    expect(carouselInsertSize(6)).toEqual({ w: 6, h: CAROUSEL_NEW_ROWS });
    expect(carouselInsertSize(3)).toEqual({ w: 3, h: 2 });
    expect(carouselInsertSize(3).w).toBeGreaterThanOrEqual(3);
  });

  it("holds each product once, at most CAROUSEL_PRODUCTS_MAX", () => {
    const many = Array.from({ length: 20 }, (_, n) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
    const block = newCarouselBlock(CAROUSEL, { x: 0, y: 0, w: 6, h: 2 }, [A, B, A, ...many]);
    expect(block.productIds.slice(0, 2)).toEqual([A, B]);
    expect(block.productIds).toHaveLength(CAROUSEL_PRODUCTS_MAX);
    expect(storefrontConfigSchema.safeParse({ ...DEFAULT_STOREFRONT_CONFIG, blocks: [block] }).success).toBe(true);
  });

  it("starts with live products the board does not show yet, then the rest, never a draft beside a live one", () => {
    const catalog = [
      { id: A, status: "active" },
      { id: B, status: "draft" },
      { id: C, status: "active" },
      { id: D, status: "active" },
    ];
    expect(startingCarouselProducts(catalog, new Set([A]))).toEqual([C, D, A]);
    // Nothing live at all: the drafts, so the seller still sees a row.
    expect(startingCarouselProducts([{ id: B, status: "draft" }], new Set())).toEqual([B]);
    expect(startingCarouselProducts([], new Set())).toEqual([]);
    const big = Array.from({ length: 10 }, (_, n) => ({ id: `p${n}`, status: "active" }));
    expect(startingCarouselProducts(big, new Set())).toHaveLength(CAROUSEL_STARTING_PRODUCTS);
  });
});

describe("a carousel's list of products", () => {
  it("moves one product up or down, and stays put at an end", () => {
    expect(moveCarouselProduct([A, B, C], 2, -1)).toEqual([A, C, B]);
    expect(moveCarouselProduct([A, B, C], 0, 1)).toEqual([B, A, C]);
    expect(moveCarouselProduct([A, B, C], 0, -1)).toEqual([A, B, C]);
    expect(moveCarouselProduct([A, B, C], 2, 1)).toEqual([A, B, C]);
  });

  it("replaces its products, each once", () => {
    expect(withCarouselProducts(carousel([A]), [C, B, C]).productIds).toEqual([C, B]);
  });
});

describe("keepProducts: the one way a board sheds a product", () => {
  it("drops a product block whole, a carousel's member, and a carousel left with none", () => {
    const blocks = [tile(A), tile(B, 1), text, carousel([B, C]), carousel([D], { id: OTHER_CAROUSEL, y: 4 })];
    const kept = keepProducts(blocks, (id) => id !== B && id !== D);
    expect(kept).toEqual([tile(A), text, carousel([C])]);
  });

  it("hands back the very same board when nothing goes", () => {
    const blocks = [tile(A), carousel([B, C])];
    expect(keepProducts(blocks, () => true)).toBe(blocks);
  });

  it("leaves a link to a product the board still shows elsewhere, and takes one to a product gone from it", () => {
    const button = (productId: string, id: string): StorefrontBlock => ({
      type: "button",
      id,
      label: "Go",
      link: { kind: "product", productId },
      x: 0,
      y: 5,
      w: 2,
      h: 1,
    });
    const blocks = [tile(A), carousel([A, B]), button(A, "b1"), button(B, "b2")];
    // The seller takes both out of the carousel: A is still a tile, B is gone.
    const edited = blocks.map((block) => (block.type === "carousel" ? withCarouselProducts(block, [C]) : block));
    const linked = withoutDeadLinks(edited, []);
    expect(linked.filter((block) => block.type === "button").map((block) => (block as { id: string }).id)).toEqual(["b1"]);
  });
});

describe("every visibility site counts a carousel's products", () => {
  it("boardProductIds: tiles and members, each once, in reading order", () => {
    expect(boardProductIds([carousel([C, A]), tile(A), tile(B, 1)])).toEqual([A, B, C]);
  });

  it("the gate's placement: on the board, with a block (and its sold-out mark) only for a tile", () => {
    const { onBoard, blocks } = placementOf({ blocks: [tile(A), carousel([B, A])] });
    expect([...onBoard].sort()).toEqual([A, B].sort());
    expect(blocks.has(A)).toBe(true);
    expect(blocks.has(B)).toBe(false);
  });

  it("the storefront list's previews read a carousel's products", () => {
    expect([...placedProductIds([{ config: { blocks: [carousel([C, D])] } }])].sort()).toEqual([C, D].sort());
  });

  it("the card extras: the theme's stars and stock for a carousel's cards, never a second photo", () => {
    const theme = { ...DEFAULT_STOREFRONT_CONFIG.theme, showRating: true, showLowStock: true, hoverPhoto: true };
    const wanted = tileExtrasWanted({ theme, blocks: [carousel([A, B])] });
    expect([...wanted.rating].sort()).toEqual([A, B].sort());
    expect([...wanted.stock].sort()).toEqual([A, B].sort());
    expect(wanted.hoverPhoto.size).toBe(0);
  });

  it("the storefront's structured data lists a carousel's products in its order, each once", () => {
    const product = (id: string, title: string) => ({ id, title, price: 10, currency: "EUR" as const, imageUrl: null, href: "#" });
    const page = {
      id: "s0000000-0000-4000-8000-000000000001",
      url: "https://store.example/s/x",
      blocks: [tile(A), carousel([C, A, B])],
      products: [product(A, "Lamp"), product(B, "Mug"), product(C, "Vase")],
    } as unknown as StorefrontPageData;
    const graph = (storefrontStructuredData(page, "Shop") as { "@graph": { "@type": string; itemListElement?: { name: string }[] }[] })["@graph"];
    const list = graph.find((node) => node["@type"] === "ItemList");
    expect(list?.itemListElement?.map((item) => item.name)).toEqual(["Lamp", "Vase", "Mug"]);
  });
});

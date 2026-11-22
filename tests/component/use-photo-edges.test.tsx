import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import {
  DEFAULT_STOREFRONT_CONFIG,
  type ProductBlock,
  type StorefrontTheme,
} from "@/types/storefront";
import { cachedPhotoEdge } from "@/lib/storefront/photo-edge";
import { usePhotoEdges } from "@/components/storefront/usePhotoEdges";

/**
 * THE DESIGNER'S MEASURING (usePhotoEdges): it measures only the cards whose
 * look depends on their photo's edge, and reports only what differs from the
 * board's cache, so a board already right is left alone.
 */

const measured = vi.hoisted(() => new Map<string, "white" | "other" | null>());
vi.mock("@/lib/storefront/photo-edge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storefront/photo-edge")>();
  return {
    ...actual,
    cachedPhotoEdge: vi.fn(async (product: { id: string }) => measured.get(product.id) ?? null),
  };
});

afterEach(() => {
  cleanup();
  measured.clear();
});

const A = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const B = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const C = "cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa";
const products = new Map([A, B, C].map((id) => [id, { id, imageUrl: `/${id}.webp` }]));
const card = (productId: string, over: Partial<ProductBlock> = {}): ProductBlock => ({
  type: "product",
  productId,
  x: 0,
  y: 0,
  w: 1,
  h: 1,
  ...over,
});
const theme = (over: Partial<StorefrontTheme> = {}): StorefrontTheme => ({ ...DEFAULT_STOREFRONT_CONFIG.theme, ...over });

describe("usePhotoEdges", () => {
  it("reports the cards whose cached edge is missing or wrong, and only those", async () => {
    measured.set(A, "white").set(B, "other").set(C, null);
    const onMeasured = vi.fn();
    renderHook(() =>
      usePhotoEdges({
        theme: theme({ whiteBlend: "auto" }),
        // B is already right; C cannot be read and so says nothing.
        blocks: [card(A), card(B, { x: 1, photoEdge: "other" }), card(C, { x: 2 })],
        products,
        sample: false,
        onMeasured,
      }),
    );
    await waitFor(() => expect(onMeasured).toHaveBeenCalledTimes(1));
    expect([...onMeasured.mock.calls[0][0].entries()]).toEqual([[`p_${A}`, "white"]]);
  });

  it("measures nothing on a board whose cards do not depend on it", async () => {
    measured.set(A, "white");
    const onMeasured = vi.fn();
    vi.mocked(cachedPhotoEdge).mockClear();
    renderHook(() => usePhotoEdges({ theme: theme(), blocks: [card(A)], products, sample: false, onMeasured }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(cachedPhotoEdge).not.toHaveBeenCalled();
    expect(onMeasured).not.toHaveBeenCalled();
  });
});

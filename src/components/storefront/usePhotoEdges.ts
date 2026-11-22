"use client";

import { useEffect, useMemo, useRef } from "react";
import type { Product } from "@/types/product";
import {
  blockKey,
  type PhotoEdge,
  type StorefrontBlock,
  type StorefrontTheme,
} from "@/types/storefront";
import { blocksNeedingPhotoEdge, cachedPhotoEdge } from "@/lib/storefront/photo-edge";

/**
 * THE DESIGNER'S HALF OF `whiteBlend: "auto"`: measure the photos whose look
 * depends on their edges (lib/storefront/photo-edge), and report every block
 * whose cached `photoEdge` differs from what was found.
 *
 * The designer lays the answer onto its blocks and marks the storefront
 * unsaved: the canvas then shows exactly what a buyer will see once it is
 * saved, and the save carries the cache to the buyer's page, which never
 * measures for itself. Nothing is reported for a board whose cache is already
 * right, so opening an untouched storefront changes nothing.
 *
 * A photo that cannot be read reports nothing, and its card is left alone.
 */
export function usePhotoEdges({
  theme,
  blocks,
  products,
  sample,
  onMeasured,
}: {
  theme: StorefrontTheme;
  blocks: readonly StorefrontBlock[];
  products: ReadonlyMap<string, Pick<Product, "id" | "imageUrl">>;
  /** The sample storefront, whose products exist only in code. */
  sample: boolean;
  /** The blocks (by key) whose cached edge should change. */
  onMeasured: (edges: ReadonlyMap<string, PhotoEdge>) => void;
}) {
  // The latest callback, without making every render a new measuring run.
  const report = useRef(onMeasured);
  useEffect(() => {
    report.current = onMeasured;
  });

  const wanted = useMemo(() => blocksNeedingPhotoEdge(theme, blocks, products), [theme, blocks, products]);

  useEffect(() => {
    if (wanted.length === 0) return;
    let cancelled = false;
    void Promise.all(
      wanted.map(async ({ block, product }) => [block, await cachedPhotoEdge(product, sample)] as const),
    ).then((results) => {
      if (cancelled) return;
      const changes = new Map<string, PhotoEdge>();
      for (const [block, edge] of results) {
        if (edge !== null && edge !== block.photoEdge) changes.set(blockKey(block), edge);
      }
      if (changes.size > 0) report.current(changes);
    });
    return () => {
      cancelled = true;
    };
  }, [wanted, sample]);
}

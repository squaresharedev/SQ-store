"use client";

import { useEffect, useMemo, useRef } from "react";
import { recordPhotoEdge } from "@/lib/products/photo-edge-actions";
import {
  localPhotoSource,
  measurePhotoEdge,
  measureStoredPhoto,
  photoEdgeCacheKey,
} from "@/lib/storefront/photo-edge";
import type { PhotoEdge, Product } from "@/types/product";

/**
 * THE BROWSER'S HALF OF A PHOTO'S EDGE (lib/storefront/photo-edge): measure
 * the product photos that have no stored answer yet, and store each answer on
 * its product (recordPhotoEdge). The designer runs it for the cards on its
 * board whose look depends on it, and the Products list for the page it
 * shows, so a photo stored before measuring existed, or uploaded through the
 * MCP, is measured on the seller's next visit, with nothing to save.
 *
 *   - A photo on this origin (the sample storefront's, a dev gallery's) is
 *     read directly and its answer only shown: such a product exists only in
 *     code, and there is nowhere to store it.
 *   - Any other photo is read through the seller's same-origin copy and stored
 *     against the photo the route says it served. Its answer is reported only
 *     once it is stored, so the canvas never shows a blend a buyer would not
 *     see. A member who may not edit products (`record` false) measures none.
 *
 * NEVER TOUCHES A STOREFRONT: nothing is marked unsaved, no config changes.
 * One measurement per photo per page session, a couple at a time; when a
 * budget says no, the session stops asking for a while.
 */

/** What a photo's backfill needs to know about its product. */
export type PhotoEdgeSubject = Pick<Product, "id" | "imageUrl" | "photoEdge">;

/** How many photos are read at once: each one is a full download through the
 *  photo route. */
export const PHOTO_EDGE_CONCURRENCY = 2;

/** How long the session stops asking after a spent budget (the photo route's
 *  or the write's). */
export const PHOTO_EDGE_PAUSE_MS = 10 * 60 * 1000;

/** One answer per photo per page session, shared by every caller and by every
 *  effect run that asks again while it is still in flight. */
const settled = new Map<string, Promise<PhotoEdge | null>>();
let pausedUntil = 0;

/** For tests: forget this session's answers and any pause. */
export function resetPhotoEdgeSession(): void {
  settled.clear();
  pausedUntil = 0;
}

/** Whether this product's photo is one this page measures: it has a photo
 *  with no stored answer, and the answer can be stored or needs no storing. */
export function needsPhotoEdge(product: PhotoEdgeSubject, record: boolean): boolean {
  if (!product.imageUrl || product.photoEdge !== undefined) return false;
  return record || localPhotoSource(product.imageUrl) !== null;
}

/** Not answered for now: asked again later in the session. */
const LATER = "later";

/** A budget said no: the session stops asking for a while. */
function pause(): typeof LATER {
  pausedUntil = Date.now() + PHOTO_EDGE_PAUSE_MS;
  return LATER;
}

/** Store an answer, and say what the product now holds for that photo (null
 *  when nothing is known). Never throws. */
async function store(productId: string, photoKey: string, edge: PhotoEdge): Promise<PhotoEdge | null | typeof LATER> {
  try {
    const result = await recordPhotoEdge({ productId, photoKey, edge });
    if (result.ok) return result.edge;
    return result.error.code === "rate_limited" ? pause() : null;
  } catch {
    return null;
  }
}

async function measureAndStore(product: PhotoEdgeSubject, record: boolean): Promise<PhotoEdge | null | typeof LATER> {
  const local = localPhotoSource(product.imageUrl);
  if (local) return measurePhotoEdge(local);
  if (!record) return null;
  if (Date.now() < pausedUntil) return LATER;
  const measured = await measureStoredPhoto(product.id);
  if (measured.status === "busy") return pause();
  if (measured.status === "unreadable") return null;
  return store(product.id, measured.photoKey, measured.edge);
}

/**
 * Measure one product's photo and, where it belongs on a product, store it:
 * what the product now holds for its photo, or null. Once per photo per
 * session; one not answered for now is forgotten, so a later visit asks again.
 */
export function settlePhotoEdge(product: PhotoEdgeSubject, record: boolean): Promise<PhotoEdge | null> {
  const key = photoEdgeCacheKey(product);
  let pending = settled.get(key);
  if (!pending) {
    pending = measureAndStore(product, record).then((outcome) => {
      if (outcome !== LATER) return outcome;
      settled.delete(key);
      return null;
    });
    settled.set(key, pending);
  }
  return pending;
}

/**
 * A photo just uploaded: the browser measured the file it held, and the save
 * that put the photo on the product has landed. Stored against that photo, in
 * the background: a save never waits on it or fails over it, and a photo left
 * unmeasured is measured on a later visit.
 */
export async function storeUploadedPhotoEdge(
  productId: string,
  photoKey: string,
  measuring: Promise<PhotoEdge | null>,
): Promise<void> {
  const edge = await measuring.catch(() => null);
  if (edge) await store(productId, photoKey, edge);
}

export function usePhotoEdgeBackfill({
  products,
  record,
  onMeasured,
}: {
  products: readonly PhotoEdgeSubject[];
  /** May this member store an answer (products.write, and not the sample)? */
  record: boolean;
  /** An answer now known for a product's photo: lay it on what the page
   *  shows. Never called for a photo whose answer was not stored (or, for a
   *  photo on this origin, measured). */
  onMeasured?: (productId: string, edge: PhotoEdge) => void;
}) {
  // The latest callback, without making every render a new measuring run.
  const report = useRef(onMeasured);
  useEffect(() => {
    report.current = onMeasured;
  });

  const wanted = useMemo(() => products.filter((product) => needsPhotoEdge(product, record)), [products, record]);
  // A run starts again only when WHICH photos are wanted changes, not every
  // time a caller hands over a new array of the same products.
  const signature = wanted.map(photoEdgeCacheKey).join("\n");
  const latest = useRef(wanted);
  useEffect(() => {
    latest.current = wanted;
  });

  useEffect(() => {
    const queue = latest.current;
    if (queue.length === 0) return;
    let cancelled = false;
    let next = 0;
    const work = async () => {
      while (!cancelled && next < queue.length) {
        const product = queue[next];
        next += 1;
        const edge = await settlePhotoEdge(product, record);
        if (!cancelled && edge) report.current?.(product.id, edge);
      }
    };
    for (let lane = 0; lane < Math.min(PHOTO_EDGE_CONCURRENCY, queue.length); lane += 1) void work();
    return () => {
      cancelled = true;
    };
  }, [signature, record]);
}

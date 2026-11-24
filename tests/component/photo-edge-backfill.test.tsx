import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";

/**
 * THE BROWSER'S HALF OF A PHOTO'S EDGE (usePhotoEdgeBackfill): which photos a
 * page measures, that a stored photo's answer is stored against the photo the
 * route served before anything is shown, that nothing is stored for a member
 * who may not, and that a photo is measured once a session.
 */

const recordPhotoEdge = vi.hoisted(() => vi.fn());
vi.mock("@/lib/products/photo-edge-actions", () => ({ recordPhotoEdge }));

const measureStoredPhoto = vi.hoisted(() => vi.fn());
const measurePhotoEdge = vi.hoisted(() => vi.fn());
vi.mock("@/lib/storefront/photo-edge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storefront/photo-edge")>()),
  measureStoredPhoto,
  measurePhotoEdge,
}));

import {
  needsPhotoEdge,
  resetPhotoEdgeSession,
  storeUploadedPhotoEdge,
  usePhotoEdgeBackfill,
  type PhotoEdgeSubject,
} from "@/components/products/usePhotoEdgeBackfill";

const A = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const B = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const C = "cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa";
const signed = (id: string): PhotoEdgeSubject => ({ id, imageUrl: `https://bucket.r2.test/images/${id}.webp?X-Amz-Signature=1` });
const keyOf = (id: string) => `images/u/${id}-photo.webp`;

beforeEach(() => {
  resetPhotoEdgeSession();
  measureStoredPhoto.mockImplementation(async (id: string) => ({ status: "measured", photoKey: keyOf(id), edge: "white" }));
  measurePhotoEdge.mockResolvedValue("white");
  recordPhotoEdge.mockImplementation(async ({ edge }: { edge: string }) => ({ ok: true, edge }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("which photos a page measures", () => {
  it("a photo with no stored answer, where the answer can be stored or needs no storing", () => {
    expect(needsPhotoEdge(signed(A), true)).toBe(true);
    expect(needsPhotoEdge({ ...signed(A), photoEdge: "other" }, true)).toBe(false);
    expect(needsPhotoEdge({ id: A, imageUrl: null }, true)).toBe(false);
    // A member who may not store anything measures no stored photo...
    expect(needsPhotoEdge(signed(A), false)).toBe(false);
    // ...but a photo that exists only in code (the sample's) needs no storing.
    expect(needsPhotoEdge({ id: A, imageUrl: "/sample-storefront/camera.webp" }, false)).toBe(true);
  });
});

describe("usePhotoEdgeBackfill", () => {
  it("stores each answer against the photo the route served, and reports only what was stored", async () => {
    recordPhotoEdge.mockImplementation(async ({ productId, edge }: { productId: string; edge: string }) =>
      // B's photo was replaced while it was being measured: nothing landed.
      ({ ok: true, edge: productId === B ? null : edge }),
    );
    const onMeasured = vi.fn();
    renderHook(() =>
      usePhotoEdgeBackfill({
        products: [signed(A), signed(B), { ...signed(C), photoEdge: "other" }, { id: "none", imageUrl: null }],
        record: true,
        onMeasured,
      }),
    );
    await waitFor(() => expect(recordPhotoEdge).toHaveBeenCalledTimes(2));
    await settle();
    expect(recordPhotoEdge).toHaveBeenCalledWith({ productId: A, photoKey: keyOf(A), edge: "white" });
    expect(recordPhotoEdge).toHaveBeenCalledWith({ productId: B, photoKey: keyOf(B), edge: "white" });
    expect(onMeasured.mock.calls).toEqual([[A, "white"]]);
    // C already has an answer; "none" has no photo.
    expect(measureStoredPhoto.mock.calls.map(([id]) => id).sort()).toEqual([A, B].sort());
  });

  it("measures and stores nothing for a member who may not edit products", async () => {
    const onMeasured = vi.fn();
    renderHook(() => usePhotoEdgeBackfill({ products: [signed(A)], record: false, onMeasured }));
    await settle();
    expect(measureStoredPhoto).not.toHaveBeenCalled();
    expect(recordPhotoEdge).not.toHaveBeenCalled();
    expect(onMeasured).not.toHaveBeenCalled();
  });

  it("shows a photo on this origin its answer, with nothing to store", async () => {
    measurePhotoEdge.mockResolvedValue("other");
    const onMeasured = vi.fn();
    renderHook(() =>
      usePhotoEdgeBackfill({ products: [{ id: A, imageUrl: "/sample-storefront/camera.webp" }], record: false, onMeasured }),
    );
    await waitFor(() => expect(onMeasured).toHaveBeenCalledWith(A, "other"));
    expect(measurePhotoEdge).toHaveBeenCalledWith("/sample-storefront/camera.webp");
    expect(recordPhotoEdge).not.toHaveBeenCalled();
  });

  it("measures a photo once a session, however many pages and renders ask", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ products }) => usePhotoEdgeBackfill({ products, record: true, onMeasured: first }), {
      initialProps: { products: [signed(A)] },
    });
    renderHook(() => usePhotoEdgeBackfill({ products: [signed(A)], record: true, onMeasured: second }));
    rerender({ products: [signed(A)] });
    await waitFor(() => expect(second).toHaveBeenCalledWith(A, "white"));
    await waitFor(() => expect(first).toHaveBeenCalledWith(A, "white"));
    expect(measureStoredPhoto).toHaveBeenCalledTimes(1);
    expect(recordPhotoEdge).toHaveBeenCalledTimes(1);
  });

  it("measures a replaced photo afresh: one photo's answer is never another's", async () => {
    renderHook(() => usePhotoEdgeBackfill({ products: [signed(A)], record: true }));
    await waitFor(() => expect(recordPhotoEdge).toHaveBeenCalledTimes(1));
    renderHook(() =>
      usePhotoEdgeBackfill({ products: [{ id: A, imageUrl: "https://bucket.r2.test/images/new.webp?X-Amz-Signature=2" }], record: true }),
    );
    await waitFor(() => expect(measureStoredPhoto).toHaveBeenCalledTimes(2));
  });

  it("stops asking for a while once a budget says no", async () => {
    measureStoredPhoto.mockResolvedValue({ status: "busy" });
    renderHook(() => usePhotoEdgeBackfill({ products: [signed(A)], record: true }));
    await waitFor(() => expect(measureStoredPhoto).toHaveBeenCalledTimes(1));
    await settle();
    renderHook(() => usePhotoEdgeBackfill({ products: [signed(B), signed(C)], record: true }));
    await settle();
    expect(measureStoredPhoto).toHaveBeenCalledTimes(1);
    expect(recordPhotoEdge).not.toHaveBeenCalled();
  });
});

describe("a photo just uploaded", () => {
  it("is stored against the photo the save stored, from the file the browser measured", async () => {
    await storeUploadedPhotoEdge(A, keyOf(A), Promise.resolve("white"));
    expect(recordPhotoEdge).toHaveBeenCalledWith({ productId: A, photoKey: keyOf(A), edge: "white" });
  });

  it("stores nothing when the file could not be read, and never throws", async () => {
    await storeUploadedPhotoEdge(A, keyOf(A), Promise.resolve(null));
    await storeUploadedPhotoEdge(A, keyOf(A), Promise.reject(new Error("decode")));
    expect(recordPhotoEdge).not.toHaveBeenCalled();
    recordPhotoEdge.mockRejectedValue(new Error("offline"));
    await expect(storeUploadedPhotoEdge(A, keyOf(A), Promise.resolve("other"))).resolves.toBeUndefined();
  });
});

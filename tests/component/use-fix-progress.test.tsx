import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useFixProgress } from "@/components/products/useFixProgress";
import { fixProgressStorageKey } from "@/lib/moderation/fix-fields";

/**
 * A paused product's "Changed" marks have to survive the full reload that
 * follows a save, which is what this remembers. The e2e spec proves the whole
 * loop (75-moderation-fix-and-appeal: "remembers a fixed part"); this pins
 * the storage contract itself, including a browser that refuses storage.
 */

const DECISION = "0b1f7b1e-6d3a-4f4e-9f6c-1a2b3c4d5e6f";

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("useFixProgress", () => {
  it("starts empty, remembers what was saved, and a fresh mount reads it back", () => {
    const first = renderHook(() => useFixProgress(DECISION));
    expect([...first.result.current.saved]).toEqual([]);

    act(() => first.result.current.remember(["title"]));
    expect([...first.result.current.saved]).toEqual(["title"]);
    act(() => first.result.current.remember(["description", "title"]));
    expect([...first.result.current.saved].sort()).toEqual(["description", "title"]);
    expect(JSON.parse(window.sessionStorage.getItem(fixProgressStorageKey(DECISION))!).sort()).toEqual([
      "description",
      "title",
    ]);
    first.unmount();

    // The reload after a save.
    const second = renderHook(() => useFixProgress(DECISION));
    expect([...second.result.current.saved].sort()).toEqual(["description", "title"]);
  });

  it("keeps a new decision's progress apart from an old one's", () => {
    window.sessionStorage.setItem(fixProgressStorageKey(DECISION), JSON.stringify(["photos"]));
    const other = renderHook(() => useFixProgress("d3c15e0f-1111-4222-8333-444455556666"));
    expect([...other.result.current.saved]).toEqual([]);
  });

  it("remembers nothing without a decision", () => {
    const none = renderHook(() => useFixProgress(null));
    act(() => none.result.current.remember(["title"]));
    expect([...none.result.current.saved]).toEqual([]);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("still covers the visit when storage refuses", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    const hook = renderHook(() => useFixProgress(DECISION));
    act(() => hook.result.current.remember(["price"]));
    expect([...hook.result.current.saved]).toEqual(["price"]);
  });

  it("ignores a value it did not write", () => {
    // Its own decision: what an earlier test kept in memory lasts as long as
    // the page, exactly as it would in the app.
    const decision = "a1b2c3d4-0000-4000-8000-000000000009";
    window.sessionStorage.setItem(fixProgressStorageKey(decision), "{not json");
    const hook = renderHook(() => useFixProgress(decision));
    expect([...hook.result.current.saved]).toEqual([]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  __resetTourForTests,
  createTourStore,
  editorTour,
  endTour,
  goToStep,
  markArrived,
  setTourNext,
  startTour,
  useTour,
  useTourReveal,
} from "@/lib/onboarding/tour-store";

/**
 * Where the guided tour is, for this tab. The store has to survive the dashboard
 * shell remounting and a refresh (sessionStorage), while never putting store
 * data in web storage and never resurrecting a tour that is stale or unknown.
 */

const KEY = "sq.dashboard.tour";

function stored(): Record<string, unknown> | null {
  const raw = sessionStorage.getItem(KEY);
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
}

beforeEach(() => {
  sessionStorage.clear();
  __resetTourForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("tour store", () => {
  it("is idle until started, then sits on the first step, not yet arrived", () => {
    const { result } = renderHook(() => useTour());
    expect(result.current).toEqual({ status: "idle" });

    act(() => startTour());
    expect(result.current).toEqual({
      status: "active",
      stepId: "overview-nav",
      arrived: false,
      next: null,
    });
  });

  it("does not restart a tour that is already running", () => {
    const { result } = renderHook(() => useTour());
    act(() => {
      startTour();
      goToStep("orders-search");
      startTour();
    });
    expect(result.current).toMatchObject({ status: "active", stepId: "orders-search" });
  });

  it("moves between steps, and only marks the current one arrived", () => {
    const { result } = renderHook(() => useTour());
    act(() => startTour());
    act(() => markArrived("products-add"));
    expect(result.current).toMatchObject({ stepId: "overview-nav", arrived: false });

    act(() => markArrived("overview-nav"));
    expect(result.current).toMatchObject({ stepId: "overview-nav", arrived: true });

    act(() => goToStep("search", { arrived: true }));
    expect(result.current).toMatchObject({ stepId: "search", arrived: true });

    act(() => goToStep("products-add"));
    expect(result.current).toMatchObject({ stepId: "products-add", arrived: false });
  });

  it("persists only the position, never the next setup action", () => {
    act(() => startTour({ next: { href: "/storefront/abc", label: "Open designer" } }));
    const saved = stored();
    expect(Object.keys(saved ?? {}).sort()).toEqual(["arrived", "stepId", "updatedAt", "v"]);
    expect(JSON.stringify(saved)).not.toContain("/storefront/abc");
  });

  it("resumes a tour in this tab after a refresh, without the in-memory offer", () => {
    act(() => startTour({ next: { href: "/products/new", label: "Add your first product" } }));
    act(() => goToStep("orders-filters", { arrived: true }));

    __resetTourForTests(); // a fresh module, as after a reload; storage is untouched
    const { result } = renderHook(() => useTour());
    expect(result.current).toEqual({
      status: "active",
      stepId: "orders-filters",
      arrived: true,
      next: null,
    });
  });

  it("ignores, and clears, a stored position that is unknown, malformed or stale", () => {
    const cases = [
      JSON.stringify({ v: 1, stepId: "map", arrived: false, updatedAt: Date.now() }),
      JSON.stringify({ v: 2, stepId: "search", arrived: false, updatedAt: Date.now() }),
      JSON.stringify({ v: 1, stepId: "search", arrived: false }),
      JSON.stringify({
        v: 1,
        stepId: "search",
        arrived: false,
        updatedAt: Date.now() - 31 * 60 * 1000,
      }),
      JSON.stringify(null),
    ];
    for (const value of cases) {
      sessionStorage.setItem(KEY, value);
      __resetTourForTests();
      const { result, unmount } = renderHook(() => useTour());
      expect(result.current, value).toEqual({ status: "idle" });
      expect(sessionStorage.getItem(KEY), value).toBeNull();
      unmount();
    }
  });

  it("treats unparseable storage as no tour", () => {
    sessionStorage.setItem(KEY, "{not json");
    __resetTourForTests();
    const { result } = renderHook(() => useTour());
    expect(result.current).toEqual({ status: "idle" });
  });

  it("clears the stored position when the tour ends", () => {
    const { result } = renderHook(() => useTour());
    act(() => startTour());
    expect(stored()).not.toBeNull();
    act(() => endTour());
    expect(result.current).toEqual({ status: "idle" });
    expect(stored()).toBeNull();
  });

  it("keeps working in memory when storage refuses writes", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    const { result } = renderHook(() => useTour());
    act(() => startTour());
    act(() => goToStep("payments"));
    expect(result.current).toMatchObject({ status: "active", stepId: "payments" });
  });

  it("updates the next setup action while running, and ignores it while idle", () => {
    const { result } = renderHook(() => useTour());
    act(() => setTourNext({ href: "/products/new", label: "Add your first product" }));
    expect(result.current).toEqual({ status: "idle" });

    act(() => startTour());
    act(() => setTourNext({ href: "/products/new", label: "Add your first product" }));
    expect(result.current).toMatchObject({
      next: { href: "/products/new", label: "Add your first product" },
    });
  });

  it("reveals the Orders toolbar only while the tour is on an orders stop", () => {
    const { result } = renderHook(() => useTourReveal("orders-toolbar"));
    expect(result.current).toBe(false);
    act(() => startTour());
    expect(result.current).toBe(false);
    act(() => goToStep("orders-search"));
    expect(result.current).toBe(true);
    act(() => goToStep("orders-filters"));
    expect(result.current).toBe(true);
    act(() => goToStep("analytics"));
    expect(result.current).toBe(false);
    act(() => endTour());
    expect(result.current).toBe(false);
  });
});

describe("separate tours", () => {
  it("keeps the designer's tour apart from the dashboard's, in memory and in storage", () => {
    const dashboard = renderHook(() => useTour());
    const editor = renderHook(() => editorTour.useTour());

    act(() => startTour());
    act(() => editorTour.start());
    expect(dashboard.result.current).toMatchObject({ status: "active", stepId: "overview-nav" });
    expect(editor.result.current).toMatchObject({ status: "active", stepId: "editor-add" });
    expect(sessionStorage.getItem("sq.editor.tour")).toContain("editor-add");

    // Ending one leaves the other exactly where it was.
    act(() => editorTour.end());
    expect(editor.result.current).toEqual({ status: "idle" });
    expect(dashboard.result.current).toMatchObject({ status: "active", stepId: "overview-nav" });
    expect(stored()).toMatchObject({ stepId: "overview-nav" });

    act(() => editorTour.start());
    act(() => endTour());
    expect(editor.result.current).toMatchObject({ status: "active", stepId: "editor-add" });
  });

  it("will not restore a step that belongs to the other tour", () => {
    sessionStorage.setItem(
      "sq.editor.tour",
      JSON.stringify({ v: 1, stepId: "products-add", arrived: true, updatedAt: Date.now() }),
    );
    __resetTourForTests();
    const { result } = renderHook(() => editorTour.useTour());
    expect(result.current).toEqual({ status: "idle" });
    expect(sessionStorage.getItem("sq.editor.tour")).toBeNull();
  });

  it("builds a store that starts at its own first step", () => {
    const ids = ["one", "two"] as const;
    const store = createTourStore({
      storageKey: "test.tour",
      stepIds: ids,
      isStepId: (value): value is (typeof ids)[number] =>
        typeof value === "string" && (ids as readonly string[]).includes(value),
    });
    store.start();
    expect(store.getSnapshot()).toMatchObject({ status: "active", stepId: "one" });
    store.goTo("two", { arrived: true });
    expect(store.getSnapshot()).toMatchObject({ stepId: "two", arrived: true });
    store.end();
    expect(store.getSnapshot()).toEqual({ status: "idle" });
  });
});

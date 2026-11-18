import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, cleanup, act } from "@testing-library/react";
import { useTipPlacement } from "@/components/ui/tip-placement";

/**
 * TIP PLACEMENT: position is correct and stable.
 *
 * The old implementation bumped a `reflow` counter inside every rAF tick,
 * causing a React re-render per frame even when nothing moved.  The new
 * version calls measure() directly from the rAF callback; since setPlacement
 * bails early when top/left/side/arrowLeft are identical, frames where the
 * trigger did not move produce no re-render.
 *
 * These tests verify:
 * 1. The placement is computed correctly from the trigger and bubble rects.
 * 2. The placement object is kept stable across rAF ticks when nothing moves
 *    (same reference, not just equal values).
 */

afterEach(cleanup);

function makeRef<T>(value: T): React.RefObject<T> {
  return { current: value } as React.RefObject<T>;
}

function makeTrigger(rect: Partial<DOMRect>): HTMLElement {
  const el = document.createElement("button");
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    left: 100,
    top: 100,
    right: 140,
    bottom: 120,
    width: 40,
    height: 20,
    x: 100,
    y: 100,
    toJSON: () => ({}),
    ...rect,
  } as DOMRect);
  return el;
}

function makeBubble(width = 120, height = 32): HTMLElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "offsetWidth", { value: width, configurable: true });
  Object.defineProperty(el, "offsetHeight", { value: height, configurable: true });
  return el;
}

beforeEach(() => {
  vi.useFakeTimers();
  // jsdom viewport defaults.
  Object.defineProperty(window, "innerWidth", { value: 800, configurable: true, writable: true });
  Object.defineProperty(window, "innerHeight", { value: 600, configurable: true, writable: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useTipPlacement", () => {
  it("places the bubble below the trigger by default", () => {
    const trigger = makeTrigger({ left: 300, top: 200, right: 340, bottom: 220, width: 40, height: 20 });
    const bubble = makeBubble(120, 32);

    const { result } = renderHook(() =>
      useTipPlacement(true, makeRef(trigger), makeRef(bubble)),
    );

    // The layout effect fired synchronously; placement should be non-null.
    expect(result.current).not.toBeNull();
    // Default: bubble goes below the trigger (8px gap).
    expect(result.current?.side).toBe("bottom");
    expect(result.current?.top).toBe(220 + 8); // rect.bottom + GAP
  });

  it("flips above when there is no room below", () => {
    // Trigger near the bottom of the viewport.
    const trigger = makeTrigger({ left: 300, top: 550, right: 340, bottom: 570, width: 40, height: 20 });
    const bubble = makeBubble(120, 40);

    const { result } = renderHook(() =>
      useTipPlacement(true, makeRef(trigger), makeRef(bubble)),
    );

    expect(result.current?.side).toBe("top");
  });

  it("keeps the same placement object across rAF ticks when nothing moves", () => {
    const trigger = makeTrigger({ left: 300, top: 200, right: 340, bottom: 220, width: 40, height: 20 });
    const bubble = makeBubble(120, 32);

    const { result } = renderHook(() =>
      useTipPlacement(true, makeRef(trigger), makeRef(bubble)),
    );

    const first = result.current;
    expect(first).not.toBeNull();

    // Advance a few frames (16 ms each) without changing the trigger position.
    // runAllTimers is avoided here because the rAF loop is intentionally
    // infinite and would trigger vitest's infinite-loop guard.
    act(() => {
      vi.advanceTimersByTime(100);
    });

    // Same object reference: setPlacement returned `prev` unchanged each frame.
    expect(result.current).toBe(first);
  });

  it("updates the placement when the trigger moves", () => {
    let currentTop = 200;
    const trigger = document.createElement("button");
    vi.spyOn(trigger, "getBoundingClientRect").mockImplementation(() => ({
      left: 300,
      top: currentTop,
      right: 340,
      bottom: currentTop + 20,
      width: 40,
      height: 20,
      x: 300,
      y: currentTop,
      toJSON: () => ({}),
    } as DOMRect));
    const bubble = makeBubble(120, 32);

    const { result } = renderHook(() =>
      useTipPlacement(true, makeRef(trigger), makeRef(bubble)),
    );

    const first = result.current;

    // Simulate the trigger moving (canvas pan) and let one rAF tick fire.
    act(() => {
      currentTop = 400;
      vi.advanceTimersByTime(32);
    });

    // A new placement object because top changed.
    expect(result.current).not.toBe(first);
    expect(result.current?.top).toBeGreaterThan(first?.top ?? 0);
  });

  it("returns null while closed", () => {
    const trigger = makeTrigger({});
    const bubble = makeBubble();

    const { result } = renderHook(() =>
      useTipPlacement(false, makeRef(trigger), makeRef(bubble)),
    );

    // With open=false the layout effect does not run, so placement stays null.
    // (The last placement from a previous open is deliberately kept for reuse
    // on the next open; a fresh hook with open=false starts at null.)
    expect(result.current).toBeNull();
  });
});

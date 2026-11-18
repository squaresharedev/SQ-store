// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, cleanup, act } from "@testing-library/react";
import { useNow } from "@/lib/hooks/useNow";

/**
 * ONE SHARED INTERVAL across all useNow subscribers.
 *
 * The original implementation started a setInterval per subscriber.  A list
 * of N order rows therefore registered N timers and fired N re-renders every
 * minute.  The fixed version uses a module-level listener set so the interval
 * is started once and cleared when the last subscriber leaves.
 */

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useNow shares one interval", () => {
  it("creates only one timer no matter how many instances mount", () => {
    const spy = vi.spyOn(global, "setInterval");

    const a = renderHook(() => useNow());
    const b = renderHook(() => useNow());
    const c = renderHook(() => useNow());

    expect(spy).toHaveBeenCalledTimes(1);

    a.unmount();
    b.unmount();
    c.unmount();

    spy.mockRestore();
  });

  it("clears the timer when the last subscriber unmounts", () => {
    const clearSpy = vi.spyOn(global, "clearInterval");

    const a = renderHook(() => useNow());
    const b = renderHook(() => useNow());

    a.unmount();
    expect(clearSpy).not.toHaveBeenCalled();

    b.unmount();
    expect(clearSpy).toHaveBeenCalledTimes(1);

    clearSpy.mockRestore();
  });

  it("restarts the timer when a new subscriber mounts after all left", () => {
    const spy = vi.spyOn(global, "setInterval");

    const a = renderHook(() => useNow());
    a.unmount();

    const b = renderHook(() => useNow());
    b.unmount();

    // Two subscribe/unsubscribe cycles -> two timer starts.
    expect(spy).toHaveBeenCalledTimes(2);

    spy.mockRestore();
  });

  it("all subscribers see the same tick", () => {
    const MINUTE_MS = 60_000;

    const a = renderHook(() => useNow());
    const b = renderHook(() => useNow());

    const before = a.result.current?.getTime();

    act(() => {
      vi.advanceTimersByTime(MINUTE_MS);
    });

    expect(a.result.current?.getTime()).toBeGreaterThan(before ?? 0);
    // Both hooks moved to the same minute.
    expect(a.result.current?.getTime()).toBe(b.result.current?.getTime());

    a.unmount();
    b.unmount();
  });

  it("disabled hook does not subscribe", () => {
    const spy = vi.spyOn(global, "setInterval");

    const hook = renderHook(() => useNow(false));
    expect(spy).not.toHaveBeenCalled();
    expect(hook.result.current).toBeNull();

    hook.unmount();
    spy.mockRestore();
  });
});

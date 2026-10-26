import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDelayedPending } from "@/lib/hooks/useDelayedPending";
import { PENDING_DELAY_MS, PENDING_MIN_SHOW_MS } from "@/components/ui/motion-tokens";

/**
 * The rule behind every loading state that answers a click: nothing for the
 * first PENDING_DELAY_MS (a fast result must not flash a spinner), and once
 * shown, at least PENDING_MIN_SHOW_MS (a result just past the delay must not
 * flash one either).
 */

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function elapse(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("useDelayedPending", () => {
  it("shows nothing while the work is quick", () => {
    const { result, rerender } = renderHook(({ pending }) => useDelayedPending(pending), {
      initialProps: { pending: true },
    });
    elapse(PENDING_DELAY_MS - 1);
    expect(result.current).toBe(false);

    rerender({ pending: false });
    elapse(PENDING_MIN_SHOW_MS);
    expect(result.current).toBe(false);
  });

  it("shows once the work has outlasted the delay", () => {
    const { result } = renderHook(() => useDelayedPending(true));
    expect(result.current).toBe(false);
    elapse(PENDING_DELAY_MS);
    expect(result.current).toBe(true);
  });

  it("stays up for the minimum, then leaves", () => {
    const { result, rerender } = renderHook(({ pending }) => useDelayedPending(pending), {
      initialProps: { pending: true },
    });
    elapse(PENDING_DELAY_MS);
    expect(result.current).toBe(true);

    // Settles 50ms after it appeared.
    elapse(50);
    rerender({ pending: false });
    elapse(PENDING_MIN_SHOW_MS - 50 - 1);
    expect(result.current).toBe(true);
    elapse(1);
    expect(result.current).toBe(false);
  });

  it("leaves at once when it has already been up long enough", () => {
    const { result, rerender } = renderHook(({ pending }) => useDelayedPending(pending), {
      initialProps: { pending: true },
    });
    elapse(PENDING_DELAY_MS + PENDING_MIN_SHOW_MS + 100);
    expect(result.current).toBe(true);

    rerender({ pending: false });
    elapse(0);
    expect(result.current).toBe(false);
  });
});

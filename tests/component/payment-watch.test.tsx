/**
 * The order page while a payment is being confirmed (components/checkout/
 * PaymentWatch.tsx): it re-reads itself for a minute, then hands the buyer a
 * button to ask again instead of leaving them to "reload the page".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "../setup/render";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { PaymentWatch } = await import("@/components/checkout/PaymentWatch");

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("PaymentWatch", () => {
  it("asks again by itself for a minute, showing nothing", () => {
    render(<PaymentWatch />);
    act(() => vi.advanceTimersByTime(56_000));
    expect(refresh).toHaveBeenCalledTimes(14);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("then offers a button to check again, which starts another minute", () => {
    render(<PaymentWatch />);
    act(() => vi.advanceTimersByTime(60_000));
    expect(refresh).toHaveBeenCalledTimes(15);

    const again = screen.getByRole("button", { name: "Check again" });
    fireEvent.click(again);
    expect(refresh).toHaveBeenCalledTimes(16);
    expect(screen.queryByRole("button", { name: "Check again" })).toBeNull();

    act(() => vi.advanceTimersByTime(8_000));
    expect(refresh).toHaveBeenCalledTimes(18);
  });
});

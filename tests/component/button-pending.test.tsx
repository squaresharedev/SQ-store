import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup } from "../setup/render";
import { Button } from "@/components/ui/button";
import { PENDING_DELAY_MS } from "@/components/ui/motion-tokens";

afterEach(cleanup);
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** A Spinner is the only svg these buttons carry. */
const spinner = (button: HTMLElement) => button.querySelector("svg.animate-spin");

describe("Button pending", () => {
  it("is an ordinary button until it is pending", () => {
    render(<Button>Publish</Button>);
    const button = screen.getByRole("button", { name: "Publish" });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute("aria-busy");
    expect(spinner(button)).toBeNull();
  });

  it("locks at once but only shows a spinner after the delay", () => {
    render(<Button pending>Publish</Button>);
    const button = screen.getByRole("button", { name: "Publish" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(spinner(button)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(PENDING_DELAY_MS);
    });
    expect(spinner(button)).not.toBeNull();
    // The label stays: the button keeps its width and says what it is doing.
    expect(button).toHaveTextContent("Publish");
  });

  it("stays locked when the caller disables it, pending or not", () => {
    render(<Button disabled>Publish</Button>);
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
  });
});

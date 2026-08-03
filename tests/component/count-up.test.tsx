import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { CountUp } from "@/components/ui/CountUp";

afterEach(cleanup);

/** jsdom has no matchMedia; the component asks it about reduced motion. */
function stubReducedMotion(reduced: boolean) {
  Object.defineProperty(window, "matchMedia", {
    value: (query: string) => ({
      matches: reduced,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
    configurable: true,
    writable: true,
  });
}

/**
 * The two halves of the component, addressed separately because they say
 * different things: the aria-hidden node is what a sighted user watches
 * counting up, and the sr-only node is the settled figure assistive tech reads.
 */
function animated(container: HTMLElement): HTMLElement {
  const node = container.querySelector<HTMLElement>('[aria-hidden="true"]');
  if (!node) throw new Error("no aria-hidden node — the animated digits are missing");
  return node;
}

beforeEach(() => {
  stubReducedMotion(false);
});

describe("CountUp", () => {
  it("exposes the settled figure to assistive tech as real text", () => {
    const { container } = render(<CountUp value="€1,234.56" />);
    // Real (visually hidden) text, NOT aria-label: aria-label is prohibited on
    // a role-less span and is widely ignored by screen readers there, which
    // would leave the figure announced as nothing at all.
    expect(screen.getByText("€1,234.56")).toHaveClass("sr-only");
    expect(container.querySelector("[aria-label]")).toBeNull();
  });

  it("hides the animating digits from assistive tech", () => {
    // Otherwise every frame of the count would be announced.
    const { container } = render(<CountUp value="42" />);
    expect(animated(container)).toBeInTheDocument();
  });

  it("lands on the exact original string", async () => {
    const { container } = render(<CountUp value="€1,234.56" />);
    await waitFor(() => expect(animated(container)).toHaveTextContent("€1,234.56"), {
      timeout: 3000,
    });
  });

  it("skips the animation under reduced motion", () => {
    stubReducedMotion(true);
    const { container } = render(<CountUp value="42" />);
    expect(animated(container)).toHaveTextContent("42");
  });

  it("renders a string with no digits unchanged", () => {
    stubReducedMotion(true);
    const { container } = render(<CountUp value="No sales yet" />);
    expect(animated(container)).toHaveTextContent("No sales yet");
  });

  it("handles a multi-currency figure without dropping either part", async () => {
    const { container } = render(<CountUp value="€100.00 · $50.00" />);
    await waitFor(
      () => expect(animated(container)).toHaveTextContent("€100.00 · $50.00"),
      { timeout: 3000 },
    );
  });
});

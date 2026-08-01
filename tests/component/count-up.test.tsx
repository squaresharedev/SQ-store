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

beforeEach(() => {
  stubReducedMotion(false);
});

describe("CountUp", () => {
  it("always exposes the settled figure as the accessible name", () => {
    render(<CountUp value="€1,234.56" />);
    // The animated digits are aria-hidden, so only the final figure is read.
    expect(screen.getByLabelText("€1,234.56")).toBeInTheDocument();
  });

  it("lands on the exact original string", async () => {
    render(<CountUp value="€1,234.56" />);
    await waitFor(
      () => expect(screen.getByLabelText("€1,234.56")).toHaveTextContent("€1,234.56"),
      { timeout: 3000 },
    );
  });

  it("skips the animation under reduced motion", () => {
    stubReducedMotion(true);
    render(<CountUp value="42" />);
    expect(screen.getByLabelText("42")).toHaveTextContent("42");
  });

  it("renders a string with no digits unchanged", () => {
    stubReducedMotion(true);
    render(<CountUp value="No sales yet" />);
    expect(screen.getByLabelText("No sales yet")).toHaveTextContent("No sales yet");
  });

  it("handles a multi-currency figure without dropping either part", async () => {
    render(<CountUp value="€100.00 · $50.00" />);
    await waitFor(
      () =>
        expect(screen.getByLabelText("€100.00 · $50.00")).toHaveTextContent(
          "€100.00 · $50.00",
        ),
      { timeout: 3000 },
    );
  });
});

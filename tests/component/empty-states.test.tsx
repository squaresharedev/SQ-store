/**
 * The empty products and storefront lists (AddShowcase).
 *
 * What these pin: the add card is the call to action and only a writer gets
 * one (a reader sees the examples alone, never a plus that does nothing); the
 * tilted examples are decoration, hidden from assistive tech; and the storefront
 * card keeps the guided tour's `storefront-create` hook and opens the setup
 * flow. The create tile beside the sample is covered by
 * sample-storefront-list.test.tsx.
 */

import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { cleanup, render, screen } from "../setup/render";
import { ProductEmptyState } from "@/components/products/ProductEmptyState";
import { StorefrontEmptyState } from "@/components/storefront/StorefrontEmptyState";

beforeAll(() => {
  // The storefront example is a live StorefrontPreview, which measures its box.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

describe("empty products list", () => {
  it("offers the add card to a writer, with a product either side hidden from assistive tech", () => {
    const { container } = render(<ProductEmptyState canWrite />);
    expect(screen.getByRole("link", { name: "Add product" })).toHaveAttribute("href", "/products/new");
    expect(screen.getByRole("heading", { name: "No products yet" })).toBeInTheDocument();
    for (const side of [".showcase-peek-left", ".showcase-peek-right"]) {
      expect(container.querySelector(side)).toHaveAttribute("aria-hidden", "true");
    }
    // Real products, cut out: no alt text to announce, nothing to click.
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("shows a reader the example alone, with nothing to click", () => {
    render(<ProductEmptyState canWrite={false} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("This store has no products yet.")).toBeInTheDocument();
  });
});

describe("empty storefront list", () => {
  it("opens the setup flow from the create card, which keeps the tour hook", async () => {
    const onCreate = vi.fn();
    render(<StorefrontEmptyState canWrite onCreate={onCreate} data-tour="storefront-create" />);
    const card = screen.getByRole("button", { name: "Create storefront" });
    expect(card).toHaveAttribute("data-tour", "storefront-create");
    await userEvent.setup().click(card);
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("holds the card while a storefront is being created", () => {
    render(<StorefrontEmptyState canWrite creating onCreate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Creating…" })).toBeDisabled();
  });

  it("offers a reader nothing to press", () => {
    render(<StorefrontEmptyState canWrite={false} onCreate={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("heading", { name: "No storefronts yet" })).toBeInTheDocument();
  });
});

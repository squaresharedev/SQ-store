/**
 * The storefront designer's product picker, with nothing to pick.
 *
 * It used to offer a plain link to the products list, which left the designer
 * without its unsaved-changes guard and never brought the seller back. Now the
 * designer supplies the way out, so the seller creates a first product and
 * lands back on the board they were building.
 */

import type { ReactNode } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, cleanup } from "../setup/render";

afterEach(cleanup);

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
// A "use server" module; the empty state never searches.
vi.mock("@/lib/products/picker-actions", () => ({
  searchCatalogProducts: vi.fn(),
}));

import { ProductPicker } from "@/components/storefront/ProductPicker";

describe("ProductPicker with no products", () => {
  it("offers a first product through the designer's own handler, and says it comes back", async () => {
    const user = userEvent.setup();
    const onCreateProduct = vi.fn();
    render(
      <ProductPicker
        products={[]}
        usedProductIds={new Set()}
        onAdd={vi.fn()}
        onCreateProduct={onCreateProduct}
      />,
    );

    expect(screen.getByText(/come straight back here to place it/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add your first product" }));
    expect(onCreateProduct).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("link", { name: /add a product/i })).toBeNull();
  });

  it("falls back to the new-product form when no handler is given", () => {
    render(<ProductPicker products={[]} usedProductIds={new Set()} onAdd={vi.fn()} />);
    expect(screen.getByRole("link", { name: "Add your first product" })).toHaveAttribute(
      "href",
      "/products/new",
    );
  });
});

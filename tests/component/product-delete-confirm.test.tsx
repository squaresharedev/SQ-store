import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const deleteProductMock = vi.fn();
vi.mock("@/lib/products/actions", () => ({
  deleteProduct: (id: string) => deleteProductMock(id),
}));

import { ProductList } from "@/components/products/ProductList";
import type { Product, ProductSalesSummary } from "@/types/product";

afterEach(cleanup);

function product(id: string, title: string): Product {
  return {
    id,
    title,
    description: "",
    price: 10,
    currency: "EUR",
    status: "active",
    imageUrl: null,
    digitalFileName: null,
    trackStock: false,
    stockQuantity: null,
    lowStockThreshold: 5,
  };
}

const NO_SALES: ProductSalesSummary = { byProduct: {}, bestsellerId: null };

function renderList(products = [product("p1", "Blue Hoodie")]) {
  return render(
    <ProductList products={products} canWrite sales={NO_SALES} />,
  );
}

/** The confirm dialog, once open. */
function dialog() {
  return screen.getByRole("dialog");
}

beforeEach(() => {
  deleteProductMock.mockResolvedValue({ ok: true });
});

describe("product delete confirmation", () => {
  it("does not delete on the first click, only opens a confirm", async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(screen.getByRole("button", { name: /delete blue hoodie/i }));

    expect(deleteProductMock).not.toHaveBeenCalled();
    expect(dialog()).toBeInTheDocument();
    // The card is still there until the seller confirms.
    expect(screen.getByText("Blue Hoodie")).toBeInTheDocument();
  });

  it("names the product and warns that the files go with it", async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(screen.getByRole("button", { name: /delete blue hoodie/i }));

    expect(dialog()).toHaveTextContent("Blue Hoodie");
    expect(dialog()).toHaveTextContent(/permanently removed/i);
  });

  it("cancelling closes the dialog and keeps the product", async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(screen.getByRole("button", { name: /delete blue hoodie/i }));
    await user.click(within(dialog()).getByRole("button", { name: /^cancel$/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(deleteProductMock).not.toHaveBeenCalled();
    expect(screen.getByText("Blue Hoodie")).toBeInTheDocument();
  });

  it("confirming deletes exactly that product", async () => {
    const user = userEvent.setup();
    renderList([product("p1", "Blue Hoodie"), product("p2", "Red Cap")]);

    await user.click(screen.getByRole("button", { name: /delete red cap/i }));
    await user.click(within(dialog()).getByRole("button", { name: /delete product/i }));

    await waitFor(() => expect(deleteProductMock).toHaveBeenCalledWith("p2"));
    await waitFor(() => expect(screen.queryByText("Red Cap")).not.toBeInTheDocument());
    expect(screen.getByText("Blue Hoodie")).toBeInTheDocument();
  });

  it("restores the card and explains why when the server refuses", async () => {
    deleteProductMock.mockResolvedValue({
      ok: false,
      error: {
        code: "permission_denied",
        message: "Your Viewer role can't delete products in this store.",
        fix: "Ask the store owner to change your role.",
      },
    });
    const user = userEvent.setup();
    renderList();

    await user.click(screen.getByRole("button", { name: /delete blue hoodie/i }));
    await user.click(within(dialog()).getByRole("button", { name: /delete product/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/can't delete products/i),
    );
    // Optimistically removed, then put back.
    expect(screen.getByText("Blue Hoodie")).toBeInTheDocument();
  });

  it("hides the delete control entirely for a read-only role", () => {
    render(
      <ProductList
        products={[product("p1", "Blue Hoodie")]}
        canWrite={false}
        sales={NO_SALES}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /delete blue hoodie/i }),
    ).not.toBeInTheDocument();
  });
});

describe("filtered empty state", () => {
  it("offers to clear filters instead of prompting a first product", async () => {
    const onClear = vi.fn();
    render(
      <ProductList
        products={[]}
        canWrite
        sales={NO_SALES}
        filtered
        onClearFilters={onClear}
      />,
    );

    expect(screen.getByText(/no products match these filters/i)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /clear filters/i }));
    expect(onClear).toHaveBeenCalled();
  });

  it("shows the real empty state when nothing is filtered", () => {
    render(<ProductList products={[]} canWrite sales={NO_SALES} />);
    expect(screen.queryByText(/no products match these filters/i)).not.toBeInTheDocument();
  });
});

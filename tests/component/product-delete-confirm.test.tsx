import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "../setup/render";
import userEvent from "@testing-library/user-event";

const deleteProductMock = vi.fn();
vi.mock("@/lib/products/actions", () => ({
  deleteProduct: (id: string) => deleteProductMock(id),
}));

import { ProductList } from "@/components/products/ProductList";
import type { Product, ProductSalesSummary } from "@/types/product";

afterEach(cleanup);

// jsdom does not implement window.matchMedia; the card's actions menu is a
// Popover, which reads it to decide whether to lock scroll for the mobile sheet.
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

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
    maxPerOrder: 10,
  };
}

const NO_SALES: ProductSalesSummary = { byProduct: {}, bestsellerId: null };

function renderList(
  products = [product("p1", "Blue Hoodie")],
  placements: Record<string, Array<{ id: string; name: string }>> = {},
) {
  return render(
    <ProductList products={products} canWrite sales={NO_SALES} placements={placements} />,
  );
}

/**
 * Delete lives in the card's actions menu (with copy link and open page), so
 * choosing it is two clicks: the menu button, then Delete.
 */
async function chooseDelete(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(screen.getByRole("button", { name: `More actions for ${title}` }));
  await user.click(screen.getByRole("button", { name: /^delete$/i }));
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

    await chooseDelete(user, "Blue Hoodie");

    expect(deleteProductMock).not.toHaveBeenCalled();
    expect(dialog()).toBeInTheDocument();
    // The card is still there until the seller confirms.
    expect(screen.getByText("Blue Hoodie")).toBeInTheDocument();
  });

  it("names the product and warns that the files go with it", async () => {
    const user = userEvent.setup();
    renderList();

    await chooseDelete(user, "Blue Hoodie");

    expect(dialog()).toHaveTextContent("Blue Hoodie");
    expect(dialog()).toHaveTextContent(/permanently removed/i);
  });

  it("mentions the storefront when the product is on one", async () => {
    const user = userEvent.setup();
    renderList(
      [product("p1", "Blue Hoodie")],
      { p1: [{ id: "sf1", name: "My Store" }] },
    );

    await chooseDelete(user, "Blue Hoodie");

    expect(dialog()).toHaveTextContent(/1 storefront/i);
    expect(dialog()).toHaveTextContent(/block stays/i);
  });

  it("mentions the count when the product is on multiple storefronts", async () => {
    const user = userEvent.setup();
    renderList(
      [product("p1", "Blue Hoodie")],
      { p1: [{ id: "sf1", name: "Store A" }, { id: "sf2", name: "Store B" }] },
    );

    await chooseDelete(user, "Blue Hoodie");

    expect(dialog()).toHaveTextContent(/2 storefronts/i);
    expect(dialog()).toHaveTextContent(/blocks stay/i);
  });

  it("does not mention storefronts when the product is not placed anywhere", async () => {
    const user = userEvent.setup();
    renderList();

    await chooseDelete(user, "Blue Hoodie");

    expect(dialog()).not.toHaveTextContent(/storefront/i);
  });

  it("cancelling closes the dialog and keeps the product", async () => {
    const user = userEvent.setup();
    renderList();

    await chooseDelete(user, "Blue Hoodie");
    await user.click(within(dialog()).getByRole("button", { name: /^cancel$/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(deleteProductMock).not.toHaveBeenCalled();
    expect(screen.getByText("Blue Hoodie")).toBeInTheDocument();
  });

  it("confirming deletes exactly that product", async () => {
    const user = userEvent.setup();
    renderList([product("p1", "Blue Hoodie"), product("p2", "Red Cap")]);

    await chooseDelete(user, "Red Cap");
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

    await chooseDelete(user, "Blue Hoodie");
    await user.click(within(dialog()).getByRole("button", { name: /delete product/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/can't delete products/i),
    );
    // Optimistically removed, then put back.
    expect(screen.getByText("Blue Hoodie")).toBeInTheDocument();
  });

  it("hides the delete control entirely for a read-only role", async () => {
    const user = userEvent.setup();
    render(
      <ProductList
        products={[product("p1", "Blue Hoodie")]}
        canWrite={false}
        sales={NO_SALES}
      />,
    );
    // The menu still opens (copy link and open page are not writes); Delete
    // is simply not in it.
    await user.click(screen.getByRole("button", { name: "More actions for Blue Hoodie" }));
    expect(screen.getByRole("button", { name: /copy product link/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^delete$/i })).not.toBeInTheDocument();
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

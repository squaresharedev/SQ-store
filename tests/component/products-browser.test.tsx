/**
 * The products page toolbar (ProductsBrowser): the in-page way into search,
 * the status filter's "In moderation" choice, and what a member who cannot
 * edit is told in place of the buttons they do not get.
 */
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup } from "../setup/render";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/products/actions", () => ({
  deleteProduct: vi.fn().mockResolvedValue({ ok: true }),
}));

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }),
  usePathname: () => "/products",
}));

const openSearch = vi.fn();
vi.mock("@/components/search/SearchProvider", () => ({
  useSearch: () => ({ isOpen: false, open: openSearch, close: vi.fn(), registerAnchor: vi.fn() }),
}));

import { ProductsBrowser } from "@/components/products/ProductsBrowser";
import type { Product, ProductFilters, ProductSalesSummary } from "@/types/product";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// jsdom does not implement window.matchMedia; the filter menu is a Popover,
// which reads it to decide whether to lock scroll for the mobile sheet.
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

const PRODUCT: Product = {
  id: "p1",
  title: "Oak lamp",
  description: "",
  price: 20,
  currency: "EUR",
  status: "active",
  imageUrl: null,
  digitalFileName: null,
  trackStock: false,
  stockQuantity: null,
  lowStockThreshold: 5,
  maxPerOrder: 10,
};

const NO_SALES: ProductSalesSummary = { byProduct: {}, bestsellerId: null };

function renderBrowser({
  canWrite = true,
  filters = {},
  total = 1,
}: { canWrite?: boolean; filters?: ProductFilters; total?: number } = {}) {
  return render(
    <ProductsBrowser
      data={{ rows: [PRODUCT], total, page: 1, pageSize: 24 }}
      filters={filters}
      sort="default"
      canWrite={canWrite}
      sales={NO_SALES}
      heading={<h1>Products</h1>}
    />,
  );
}

describe("ProductsBrowser toolbar", () => {
  it("opens universal search from the page itself", async () => {
    const user = userEvent.setup();
    renderBrowser();
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(openSearch).toHaveBeenCalled();
  });

  it("filters to everything moderation is holding back", async () => {
    const user = userEvent.setup();
    renderBrowser();
    await user.click(screen.getByRole("button", { name: "Sort and filter products" }));
    await user.click(screen.getByRole("option", { name: /In moderation/ }));
    expect(replace).toHaveBeenCalledWith("/products?status=moderated", { scroll: false });
  });

  it("reads back an applied moderation filter, with the way out of it", () => {
    renderBrowser({ filters: { moderated: true } });
    expect(screen.getByRole("button", { name: "Sort and filter products" })).toHaveTextContent("In moderation");
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
  });

  it("tells a member who cannot edit why there is nothing to add with", () => {
    renderBrowser({ canWrite: false });
    expect(
      screen.getByText("You have view-only access. Contact the store owner to edit products."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Add product" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Import" })).not.toBeInTheDocument();
  });

  it("gives a writer the buttons and no such note", () => {
    renderBrowser();
    expect(screen.getByRole("link", { name: "Add product" })).toHaveAttribute("href", "/products/new");
    expect(screen.getByRole("link", { name: "Import" })).toHaveAttribute("href", "/products/import");
    expect(screen.queryByText(/view-only access/)).not.toBeInTheDocument();
  });

  it("points at the way to publish many at once when several drafts are in view", () => {
    renderBrowser({ filters: { status: "draft" }, total: 12 });
    expect(screen.getByRole("link", { name: "connect an AI assistant" })).toHaveAttribute(
      "href",
      "/settings/connected-apps",
    );
  });

  it("keeps that pointer off every other view", () => {
    renderBrowser({ total: 12 });
    expect(screen.queryByRole("link", { name: "connect an AI assistant" })).not.toBeInTheDocument();
  });

  it("says the order buyers see is set on a storefront, not by this list's sort", () => {
    renderBrowser();
    expect(screen.getByText(/To change the order buyers see/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "storefront" })).toHaveAttribute("href", "/storefront");
  });

  it("keeps that note to writers looking at the whole list", () => {
    renderBrowser({ canWrite: false });
    expect(screen.queryByText(/To change the order buyers see/)).not.toBeInTheDocument();
    cleanup();
    renderBrowser({ filters: { status: "draft" } });
    expect(screen.queryByText(/To change the order buyers see/)).not.toBeInTheDocument();
  });
});

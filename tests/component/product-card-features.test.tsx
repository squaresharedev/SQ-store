/**
 * Tests for the three card-level findings:
 *
 *   PRD-07 — Draft badge is a visible text pill, not an unlabelled dot.
 *   PRD-08 — Tracked stock count appears in the card footer.
 *   SELL-04 — Copy-link and open affordances route through the placement data.
 */
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, waitFor } from "../setup/render";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/products/actions", () => ({
  deleteProduct: vi.fn().mockResolvedValue({ ok: true }),
}));

import { StatusBadge } from "@/components/products/StatusBadge";
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

// ── helpers ──────────────────────────────────────────────────────────────────

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "p1",
    title: "Test Product",
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
    ...overrides,
  };
}

const NO_SALES: ProductSalesSummary = { byProduct: {}, bestsellerId: null };

function renderList(
  products: Product[],
  placements: Record<string, Array<{ id: string; name: string }>> = {},
) {
  return render(
    <ProductList products={products} canWrite sales={NO_SALES} placements={placements} />,
  );
}

/**
 * Stub navigator.clipboard AFTER userEvent.setup(). This ordering matters:
 * user-event installs its own clipboard shim, so stubbing before setup() would
 * be silently overwritten and every clipboard assertion would check the wrong
 * function. Pattern from tests/component/copy-button.test.tsx.
 */
function stubClipboard() {
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
    writable: true,
  });
  return writeText;
}

// ── PRD-07: Status badge ──────────────────────────────────────────────────────

describe("StatusBadge (PRD-07)", () => {
  it("renders nothing for an active product — no 'Draft' text visible", () => {
    render(<StatusBadge status="active" />);
    expect(screen.queryByText("Draft")).not.toBeInTheDocument();
  });

  it("renders a visible text pill reading 'Draft' for a draft product", () => {
    render(<StatusBadge status="draft" />);
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });

  it("the Draft text is visible, not sr-only", () => {
    render(<StatusBadge status="draft" />);
    const pill = screen.getByText("Draft");
    // The element must be in the accessibility tree and not hidden.
    expect(pill).not.toHaveClass("sr-only");
    expect(pill).toBeVisible();
  });
});

// ── PRD-08: Stock display in footer ─────────────────────────────────────────

describe("stock count in card footer (PRD-08)", () => {
  it("shows nothing for untracked products", () => {
    renderList([makeProduct({ trackStock: false, stockQuantity: null })]);
    expect(screen.queryByText(/in stock/i)).not.toBeInTheDocument();
  });

  it("shows the count for a tracked product above the threshold", () => {
    renderList([makeProduct({ trackStock: true, stockQuantity: 12, lowStockThreshold: 5 })]);
    expect(screen.getByText("12 in stock")).toBeInTheDocument();
  });

  it("shows the count for a tracked product at the low-stock threshold", () => {
    renderList([makeProduct({ trackStock: true, stockQuantity: 3, lowStockThreshold: 5 })]);
    expect(screen.getByText("3 in stock")).toBeInTheDocument();
  });

  it("shows 'Sold out' for a zero-quantity tracked product", () => {
    renderList([makeProduct({ trackStock: true, stockQuantity: 0, lowStockThreshold: 5 })]);
    // Sold out text appears at least once (footer; badge area may also show it).
    expect(screen.getAllByText(/sold out/i).length).toBeGreaterThan(0);
  });
});

// ── SELL-04: Copy-link placement logic ───────────────────────────────────────

/** Copy link and open page live in the card's actions menu. */
async function openActions(user: ReturnType<typeof userEvent.setup>, title = "Test Product") {
  await user.click(screen.getByRole("button", { name: `More actions for ${title}` }));
}

/** Open the menu, then choose "Copy product link". */
async function copyLink(user: ReturnType<typeof userEvent.setup>) {
  await openActions(user);
  await user.click(screen.getByRole("button", { name: /copy product link/i }));
}

describe("copy-link placement (SELL-04)", () => {
  it("shows copy-link and open actions for every product", async () => {
    const user = userEvent.setup();
    renderList([makeProduct()]);
    await openActions(user);
    expect(screen.getByRole("button", { name: /copy product link/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open product page/i })).toBeInTheDocument();
  });

  it("shows a toast when the product is not on any storefront", async () => {
    const user = userEvent.setup();
    renderList([makeProduct()], {});

    await copyLink(user);

    await waitFor(() =>
      expect(screen.getByRole("region", { name: /notifications/i })).toHaveTextContent(
        /not on any storefront/i,
      ),
    );
  });

  it("copies immediately when the product is on exactly one storefront", async () => {
    const user = userEvent.setup();
    const writeText = stubClipboard();
    renderList([makeProduct()], { p1: [{ id: "sf1", name: "My Store" }] });

    await copyLink(user);

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByRole("region", { name: /notifications/i })).toHaveTextContent(
        /link copied/i,
      ),
    );
  });

  it("shows a chooser modal when the product is on multiple storefronts", async () => {
    const user = userEvent.setup();
    renderList([makeProduct()], {
      p1: [
        { id: "sf1", name: "Store A" },
        { id: "sf2", name: "Store B" },
      ],
    });

    await copyLink(user);

    await waitFor(() =>
      expect(screen.getByRole("dialog")).toHaveTextContent(/store a/i),
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(/store b/i);
  });

  it("copies after the seller picks a storefront in the chooser", async () => {
    const user = userEvent.setup();
    const writeText = stubClipboard();
    renderList([makeProduct()], {
      p1: [
        { id: "sf1", name: "Store A" },
        { id: "sf2", name: "Store B" },
      ],
    });

    await copyLink(user);
    await waitFor(() => screen.getByRole("dialog"));
    await user.click(screen.getByRole("button", { name: "Store A" }));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByRole("region", { name: /notifications/i })).toHaveTextContent(
        /link copied/i,
      ),
    );
    // Chooser modal closes after picking.
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

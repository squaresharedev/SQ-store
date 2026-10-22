import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import userEvent from "@testing-library/user-event";
import { cleanup, render as rtlRender, screen, waitFor, within } from "../setup/render";
import { ToastProvider } from "@/components/ui/Toast";
import { NavigationBlockerProvider } from "@/lib/hooks/useNavigationBlocker";
import type { ProductDetail } from "@/types/product";
import { invalidInput } from "@/lib/errors";
import { msg } from "@/i18n/types";

afterEach(cleanup);
Element.prototype.scrollIntoView = vi.fn();
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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/products/x/edit",
  useSearchParams: () => new URLSearchParams(),
}));
const createProduct = vi.hoisted(() => vi.fn());
const updateProduct = vi.hoisted(() => vi.fn());
vi.mock("@/lib/products/actions", () => ({ createProduct, updateProduct }));
vi.mock("@/lib/products/badge-actions", () => ({ checkBadgeLabel: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/products/upload", () => ({ uploadToR2: vi.fn() }));
vi.mock("@/lib/stock/actions", () => ({}));

const { ProductForm } = await import("@/components/products/ProductForm");

function render(ui: ReactElement) {
  return rtlRender(
    <ToastProvider>
      <NavigationBlockerProvider>{ui}</NavigationBlockerProvider>
    </ToastProvider>,
  );
}

const PRODUCT: Partial<ProductDetail> & Pick<ProductDetail, "id" | "title" | "price"> = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  title: "Oak bench",
  description: "Seats four.",
  price: 349,
  currency: "EUR",
  status: "active",
  imageUrl: null,
  digitalFileName: null,
  trackStock: false,
  stockQuantity: null,
  lowStockThreshold: 5,
  maxPerOrder: 10,
  details: {
    materials: "Solid oak",
    badges: [
      { icon: "hand-heart", label: "Handmade" },
      { icon: "leaf", label: "Eco friendly" },
    ],
  },
};

const form = () => document.querySelector("[data-product-form]")!;
const badgesSection = () => document.querySelector('[data-product-section="badges"]') as HTMLElement;
const sentDetails = (mock: typeof updateProduct) =>
  (mock.mock.calls[0]![1] ?? mock.mock.calls[0]![0]) as { details: Record<string, unknown> };

beforeEach(() => {
  createProduct.mockReset();
  updateProduct.mockReset();
  createProduct.mockResolvedValue({ ok: true, id: "new" });
  updateProduct.mockResolvedValue({ ok: true, id: PRODUCT.id });
});

// The whole form, rendered and typed into: slow under a full parallel run, so
// these get the headroom the other form specs give their saves.
const WAIT = { timeout: 10_000 };

describe("the product form's badges", { timeout: 30_000 }, () => {
  it("opens a product's stored badges without counting them as a change", () => {
    render(<ProductForm product={PRODUCT as ProductDetail} />);
    expect(screen.getByLabelText("Words for badge 1")).toHaveValue("Handmade");
    expect(screen.getByLabelText("Words for badge 2")).toHaveValue("Eco friendly");
    expect(form().getAttribute("data-product-form-dirty")).toBe("0");
    expect(within(badgesSection()).getByText("2 badges")).toBeTruthy();
  });

  it("saves edited badges inside the details, beside the specifications it leaves alone", async () => {
    const user = userEvent.setup();
    render(<ProductForm product={PRODUCT as ProductDetail} />);
    const second = screen.getByLabelText("Words for badge 2");
    await user.clear(second);
    await user.type(second, "Climate neutral");
    expect(form().getAttribute("data-product-form-dirty")).toBe("1");
    await user.click(screen.getByRole("button", { name: "Move badge 2 earlier" }));
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updateProduct).toHaveBeenCalled(), WAIT);
    const { details } = updateProduct.mock.calls[0]![1] as { details: Record<string, unknown> };
    expect(details.badges).toEqual([
      { icon: "leaf", label: "Climate neutral" },
      { icon: "hand-heart", label: "Handmade" },
    ]);
    expect(details.materials).toBe("Solid oak");
  });

  it("drops an emptied badge, and sends no badges member once they are all gone", async () => {
    const user = userEvent.setup();
    render(<ProductForm product={PRODUCT as ProductDetail} />);
    await user.clear(screen.getByLabelText("Words for badge 1"));
    await user.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(updateProduct).toHaveBeenCalledTimes(1), WAIT);
    expect(sentDetails(updateProduct).details.badges).toEqual([{ icon: "leaf", label: "Eco friendly" }]);

    cleanup();
    updateProduct.mockClear();
    render(<ProductForm product={PRODUCT as ProductDetail} />);
    await user.click(screen.getByRole("button", { name: "Remove badge 2" }));
    await user.click(screen.getByRole("button", { name: "Remove badge 1" }));
    await user.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(updateProduct).toHaveBeenCalledTimes(1), WAIT);
    expect(sentDetails(updateProduct).details).not.toHaveProperty("badges");
    expect(sentDetails(updateProduct).details.materials).toBe("Solid oak");
  });

  it("will not save two badges that say the same thing, and says where", async () => {
    const user = userEvent.setup();
    render(<ProductForm product={PRODUCT as ProductDetail} />);
    const second = screen.getByLabelText("Words for badge 2");
    await user.clear(second);
    await user.type(second, "HANDMADE");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    expect(updateProduct).not.toHaveBeenCalled();
    expect(within(badgesSection()).getByRole("alert").textContent).toMatch(/say the same thing/);
    expect(badgesSection().getAttribute("data-product-section-state")).toBe("invalid");
    // The jump lands on the second of the two, the one to change.
    await waitFor(() => expect(document.activeElement).toBe(second), WAIT);

    // Fixing it clears the message without another save.
    await user.type(second, " in Lisbon");
    expect(within(badgesSection()).queryByRole("alert")).toBeNull();
  });

  it("adds badges to a new product and sends them with the first save", async () => {
    const user = userEvent.setup();
    render(<ProductForm />);
    await user.type(screen.getByLabelText("Title"), "Candle");
    await user.type(screen.getByLabelText("Price"), "18.00");
    await user.click(screen.getByRole("button", { name: "Handmade" }));
    await user.click(screen.getByRole("button", { name: /save product/i }));

    await waitFor(() => expect(createProduct).toHaveBeenCalled(), WAIT);
    const { details } = createProduct.mock.calls[0]![0] as { details: Record<string, unknown> };
    expect(details.badges).toEqual([{ icon: "hand-heart", label: "Handmade", color: "pink" }]);
  });

  it("outlines the Badges section too when staff flag the specifications", () => {
    render(
      <ProductForm
        product={
          {
            ...PRODUCT,
            removal: {
              kind: "paused",
              automated: true,
              reviewRequestedAt: null,
              ground: "other",
              note: null,
              at: "2026-10-19T10:00:00Z",
              fields: ["specs"],
              decisionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            },
          } as ProductDetail
        }
      />,
    );
    expect(badgesSection().getAttribute("data-fix-flag")).toBe("needs");
    expect(within(badgesSection()).getByText(/Badges and specifications/)).toBeTruthy();
    expect(
      document.querySelector('[data-product-section="specs"]')!.getAttribute("data-fix-flag"),
    ).toBe("needs");
  });

  it("counts a badge edit as answering that flag", async () => {
    const user = userEvent.setup();
    render(
      <ProductForm
        product={
          {
            ...PRODUCT,
            removal: {
              kind: "paused",
              automated: true,
              reviewRequestedAt: null,
              ground: "other",
              note: null,
              at: "2026-10-19T10:00:00Z",
              fields: ["specs"],
              decisionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            },
          } as ProductDetail
        }
      />,
    );
    await user.click(screen.getByRole("button", { name: "Remove badge 2" }));
    expect(badgesSection().getAttribute("data-fix-flag")).toBe("changed");
  });

  it("keeps a badge's colour and place through a visit, and says them in the snapshot", async () => {
    const styled = {
      ...PRODUCT,
      details: {
        materials: "Solid oak",
        badges: [
          { icon: "leaf" as const, label: "Eco friendly", color: "green" as const, placement: "photo-top-right" as const },
          { icon: "star" as const, label: "Top rated" },
        ],
      },
    };
    const user = userEvent.setup();
    render(<ProductForm product={styled as ProductDetail} />);
    expect(form().getAttribute("data-product-form-dirty")).toBe("0");
    const snapshot = JSON.parse(document.getElementById("product-form-snapshot")!.textContent!);
    expect(snapshot.badges).toEqual([
      { icon: "leaf", label: "Eco friendly", color: "green", placement: "photo-top-right" },
      { icon: "star", label: "Top rated", color: "ink", placement: "beside" },
    ]);

    // Moving a badge is a change, and the save carries it.
    await user.click(screen.getByRole("button", { name: "Where badge 2 goes" }));
    await user.click(screen.getByRole("button", { name: "On the photo, bottom left" }));
    expect(form().getAttribute("data-product-form-dirty")).toBe("1");
    await user.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(updateProduct).toHaveBeenCalled(), WAIT);
    expect((updateProduct.mock.calls[0]![1] as { details: { badges: unknown } }).details.badges).toEqual([
      { icon: "leaf", label: "Eco friendly", color: "green", placement: "photo-top-right" },
      { icon: "star", label: "Top rated", placement: "photo-bottom-left" },
    ]);
  });

  it("puts the seller on the badge a save was refused over", async () => {
    updateProduct.mockResolvedValue({
      ok: false,
      error: invalidInput(
        msg("Errors.products.badgeRefused.message", { label: "Eco friendly" }),
        msg("Errors.products.badgeRefused.fix", { email: "support@squareshare.eu" }),
      ),
    });
    const user = userEvent.setup();
    render(<ProductForm product={PRODUCT as ProductDetail} />);
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(badgesSection().getAttribute("data-product-section-state")).toBe("invalid"), WAIT);
    expect(within(badgesSection()).getByRole("alert").textContent).toMatch(
      /“Eco friendly” breaks the platform rules/,
    );
    const refused = screen.getByLabelText("Words for badge 2") as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(refused), WAIT);
    expect(refused.value.slice(refused.selectionStart!, refused.selectionEnd!)).toBe("Eco friendly");

    // Changing the badges clears the section's message.
    await user.type(refused, "!");
    expect(within(badgesSection()).queryByRole("alert")).toBeNull();
  });
});

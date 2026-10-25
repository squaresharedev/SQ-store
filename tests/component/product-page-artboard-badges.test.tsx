import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "../setup/render";
import { DEFAULT_PRODUCT_PAGE_CONFIG, DEFAULT_STOREFRONT_CONFIG } from "@/types/storefront";
import type { Product, ProductBadge } from "@/types/product";
import { harnessProduct } from "@/app/dev/checkout/fixtures";

/**
 * Moving a badge on the product page artboard, in the storefront editor: the
 * badge moves at once, the move is saved through moveProductBadge, and a save
 * that is refused puts it back where it was.
 */

const BADGES: ProductBadge[] = [
  { icon: "heart", label: "Loved by 250+ people" },
  { icon: "leaf", label: "Eco friendly", placement: "photo-top-left" },
];

vi.mock("@/lib/products/preview-actions", () => ({
  getProductPagePreviewData: async () => {
    const product = harnessProduct(false);
    return { ok: true, product: { ...product, details: { ...product.details, badges: BADGES } } };
  },
}));

const moveMock = vi.fn();
vi.mock("@/lib/products/badge-actions", () => ({
  moveProductBadge: (...args: unknown[]) => moveMock(...args),
}));

const { ProductPageArtboard } = await import("@/components/storefront/ProductPageArtboard");

const PRODUCT: Product = {
  id: "5a3e1d20-0c4f-4b6e-9a61-1f0d2c3b4a03",
  title: "Stoneware vase",
  description: "",
  price: 24,
  currency: "EUR",
  status: "active",
  imageUrl: null,
  digitalFileName: null,
  trackStock: false,
  stockQuantity: null,
  lowStockThreshold: 3,
  maxPerOrder: 10,
};

function rect(left: number, top: number, width: number, height: number) {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} } as DOMRect;
}

/** The photo at 0..400 square, the space beside it at 500..900 x 0..40. */
function layOut() {
  const photo = document.querySelector<HTMLElement>('[data-badge-zone="photo"]')!;
  const beside = document.querySelector<HTMLElement>('[data-badge-zone="beside"]')!;
  photo.getBoundingClientRect = () => rect(0, 0, 400, 400);
  beside.getBoundingClientRect = () => rect(500, 0, 400, 40);
}

function drag(label: string, x: number, y: number) {
  const pill = document.querySelector<HTMLElement>(`[data-badge-label="${label}"]`)!;
  pill.getBoundingClientRect = () => rect(510, 10, 100, 20);
  fireEvent.pointerDown(pill, { button: 0, clientX: 520, clientY: 15 });
  act(() => {
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 540, clientY: 40 }));
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: x, clientY: y }));
    window.dispatchEvent(new MouseEvent("pointerup", { clientX: x, clientY: y }));
  });
}

function artboard() {
  render(
    <ProductPageArtboard
      product={PRODUCT}
      soldOut={false}
      storefrontId="00000000-0000-4000-8000-000000000000"
      storefrontName="Clay House"
      theme={DEFAULT_STOREFRONT_CONFIG.theme}
      header={{ show: true, name: "Clay House", bio: "" }}
      productPage={DEFAULT_PRODUCT_PAGE_CONFIG}
      shippingPolicy={{}}
      seller={{}}
      backgroundImageUrl={null}
      customFontUrl={null}
      pagePhoto={null}
      onClose={vi.fn()}
      widths={{ desktop: 1180, mobile: 390 }}
      initialDevice="desktop"
    />,
  );
}

const corner = (label: string) =>
  document.querySelector(`[data-badge-label="${label}"]`)?.closest("[data-badge-corner]")?.getAttribute("data-badge-corner") ?? null;

beforeEach(() => moveMock.mockReset());
afterEach(cleanup);

describe("moving a badge on the editor's product page", () => {
  it("moves it at once and saves the move", async () => {
    moveMock.mockImplementation(async (_id: string, label: string, placement: string) => ({
      ok: true,
      badges: [{ ...BADGES[0], placement }, BADGES[1]],
    }));
    artboard();
    await screen.findByText("Loved by 250+ people");
    layOut();
    drag("Loved by 250+ people", 350, 350);
    expect(corner("Loved by 250+ people")).toBe("photo-bottom-right");
    await waitFor(() =>
      expect(moveMock).toHaveBeenCalledWith(PRODUCT.id, "Loved by 250+ people", "photo-bottom-right"),
    );
    expect(document.querySelector("[data-badge-ghost]")).toBeNull();
  });

  it("puts it back when the save is refused", async () => {
    moveMock.mockResolvedValue({
      ok: false,
      error: { code: "server_error", message: { key: "Errors.serverError.saveProduct" } },
    });
    artboard();
    await screen.findByText("Eco friendly");
    layOut();
    drag("Eco friendly", 700, 20);
    await waitFor(() => expect(moveMock).toHaveBeenCalledWith(PRODUCT.id, "Eco friendly", "beside"));
    await waitFor(() => expect(corner("Eco friendly")).toBe("photo-top-left"));
  });

  it("does nothing for a press that never moves", async () => {
    artboard();
    await screen.findByText("Eco friendly");
    layOut();
    const pill = document.querySelector<HTMLElement>('[data-badge-label="Eco friendly"]')!;
    fireEvent.pointerDown(pill, { button: 0, clientX: 20, clientY: 20 });
    act(() => {
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 22, clientY: 21 }));
      window.dispatchEvent(new MouseEvent("pointerup", { clientX: 700, clientY: 20 }));
    });
    expect(moveMock).not.toHaveBeenCalled();
    expect(corner("Eco friendly")).toBe("photo-top-left");
  });
});

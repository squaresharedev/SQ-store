import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { cleanup, render, screen } from "../setup/render";
import { CartPreviewProvider, CartProvider } from "@/components/cart/CartContext";
import { CartContents, type CartPanelTheme } from "@/components/cart/CartPanel";
import { CartPanelSurface } from "@/components/cart/CartPanelSurface";
import { CartEditProvider } from "@/components/checkout/EditableTextProviders";
import { CartPageSection } from "@/components/storefront/CartPageSection";
import { sampleCartView } from "@/lib/cart/sample";
import { ProductTileContent } from "@/components/storefront/ProductTileContent";
import { QuickAddTile } from "@/components/storefront-page/QuickAddTile";
import { ReviewAsk } from "@/components/checkout/ReviewAsk";
import type { CheckoutTheme } from "@/components/checkout/checkout-theme";
import { resolveTileLook } from "@/lib/storefront/tile-look";
import { LAB_SCENARIOS, LAB_SHOPS, LAB_STOREFRONT_ID } from "@/app/dev/cart-lab/fixtures";
import { DEFAULT_PRODUCT_PAGE_CONFIG, DEFAULT_STOREFRONT_CONFIG, type CartPageConfig, type StorefrontTheme } from "@/types/storefront";
import type { Product } from "@/types/product";

/**
 * The cart's follow-ups, as a buyer meets them:
 *
 *   - a card whose product needs no choice says "Add to cart" and is a real
 *     button that never sits inside the card's link; every other card keeps
 *     the product page's words; the seller's own card words win either way;
 *   - "Goes well with" offers the seller's picks under the lines, one press
 *     where there is nothing to choose, "Choose" where there is, and nothing
 *     when the seller switched it off;
 *   - an order of several products is reviewed product by product.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const shop = LAB_SHOPS[0];
const panelTheme: CartPanelTheme = { ink: shop.ink, cornerRadius: shop.cornerRadius, cta: shop.cta };
const boardTheme: StorefrontTheme = { ...DEFAULT_STOREFRONT_CONFIG.theme, buyButton: "solid" };

function product(quick: boolean, extra: Partial<Product> = {}): Product {
  return {
    id: "5a000000-0000-4000-8000-0000000000c1",
    title: "Walnut speaker",
    description: "",
    price: 89,
    currency: "EUR",
    status: "active",
    imageUrl: null,
    digitalFileName: null,
    trackStock: false,
    stockQuantity: null,
    lowStockThreshold: 0,
    maxPerOrder: 10,
    ...(quick ? { quickAdd: { optionIds: [] } } : {}),
    ...extra,
  };
}

function card(item: Product, cartPage: CartPageConfig = {}, theme: StorefrontTheme = boardTheme) {
  const look = resolveTileLook({ theme, productPage: DEFAULT_PRODUCT_PAGE_CONFIG, cartPage });
  return render(<ProductTileContent product={item} theme={theme} look={look} />);
}

const buyWords = () => document.querySelector("[data-tile-buy] span span")?.textContent;

describe("the card label rule", () => {
  it("says Add to cart where the product goes straight in, the page's words otherwise", () => {
    card(product(true));
    expect(buyWords()).toBe("Add to cart");
    expect(document.querySelector("[data-tile-buy-cart]")).not.toBeNull();
    cleanup();
    card(product(false));
    expect(buyWords()).toBe(DEFAULT_PRODUCT_PAGE_CONFIG.ctaLabel);
    expect(document.querySelector("[data-tile-buy-arrow]")).not.toBeNull();
  });

  it("follows the seller's switches and words", () => {
    card(product(true), { quickAdd: false });
    expect(buyWords()).toBe(DEFAULT_PRODUCT_PAGE_CONFIG.ctaLabel);
    cleanup();
    card(product(true), { enabled: false });
    expect(buyWords()).toBe(DEFAULT_PRODUCT_PAGE_CONFIG.ctaLabel);
    cleanup();
    card(product(true), { addLabel: "Into the bag" });
    expect(buyWords()).toBe("Into the bag");
    cleanup();
    // The seller's own words for the cards win over the cart's.
    card(product(true), {}, { ...boardTheme, buyButtonLabel: "Get it" });
    expect(buyWords()).toBe("Get it");
  });
});

describe("a card that adds to the cart", () => {
  function renderTile() {
    const item = product(true);
    const look = resolveTileLook({ theme: boardTheme, productPage: DEFAULT_PRODUCT_PAGE_CONFIG, cartPage: {} });
    return render(
      <CartProvider storefrontId={LAB_STOREFRONT_ID} config={{ afterAdd: "note" }}>
        <QuickAddTile
          href="/s/x/p/y"
          newTab={false}
          frameClassName="relative"
          productId={item.id}
          optionIds={[]}
          title={item.title}
          renderFace={(action) => <ProductTileContent product={item} theme={boardTheme} look={look} quickAddAction={action} />}
        />
      </CartProvider>,
    );
  }

  it("keeps its button out of the card's link, and the link the way to the page", () => {
    renderTile();
    const link = screen.getByRole("link", { name: "Walnut speaker" });
    const button = screen.getByRole("button", { name: "Add Walnut speaker to your cart" });
    expect(link.getAttribute("href")).toBe("/s/x/p/y");
    expect(link.contains(button)).toBe(false);
    expect(link.querySelector("button, a")).toBeNull();
  });

  it("puts that version in the cart, and says Added once it is in", async () => {
    const sent: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        sent.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ ok: true, cart: { ...LAB_SCENARIOS.one.view, count: 1 } }), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderTile();
    await user.click(screen.getByRole("button", { name: "Add Walnut speaker to your cart" }));
    expect(await screen.findByText("Added")).toBeTruthy();
    expect(document.querySelector("[data-tile-quick-add]")!.getAttribute("data-tile-quick-add")).toBe("added");
    expect(sent).toContainEqual({
      cartId: null,
      change: { kind: "add", productId: product(true).id, optionIds: [], quantity: 1, source: "cart" },
    });
  });
});

describe("Goes well with", () => {
  function renderCart(config: CartPageConfig = {}) {
    return render(
      <CartPreviewProvider storefrontId={LAB_STOREFRONT_ID} config={config} view={LAB_SCENARIOS.three.view}>
        <CartContents theme={panelTheme} />
      </CartPreviewProvider>,
    );
  }

  it("offers the seller's picks: Add where nothing is chosen, Choose where a version is", () => {
    renderCart();
    const items = [...document.querySelectorAll("[data-cart-suggestion]")];
    expect(items).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Add Wireless mouse to your cart" })).toBeTruthy();
    const watch = document.querySelector('[data-cart-suggestion="5a000000-0000-4000-8000-000000000008"]')!;
    expect(watch.querySelector("[data-cart-suggestion-choose]")?.textContent).toBe("Choose");
    expect(watch.querySelector("button")).toBeNull();
    // A sale shows its regular price struck through.
    expect(document.querySelector('[data-cart-suggestion="5a000000-0000-4000-8000-000000000009"] s')).not.toBeNull();
  });

  it("is gone when the seller switched it off", () => {
    renderCart({ suggestions: false });
    expect(document.querySelector("[data-cart-suggestions]")).toBeNull();
  });
});

describe("reviews on an order of several products", () => {
  const theme: CheckoutTheme = {
    surface: "#ffffff",
    ink: "#171717",
    rule: "#e5e5e5",
    surfaceRadius: 8,
    cornerRadius: 8,
    controlRadius: 6,
    cta: panelTheme.cta,
    panelStyle: {},
    panelInk: "#171717",
    panelRule: "#e5e5e5",
    panelMatchesSurface: true,
  };
  const order = {
    ref: "lab",
    productId: "p1",
    productTitle: "Walnut speaker",
    photo: null,
    firstName: "Aoife",
    isDigital: false,
    review: "open" as const,
    reviewItems: [
      { productId: "p1", title: "Walnut speaker", photo: null, review: "open" as const },
      { productId: "p2", title: "Studio headphones", photo: null, review: "done" as const, rating: 5 },
      { productId: "p3", title: "Potted succulent", photo: null, review: "closed" as const },
    ],
  };

  it("picks the product the stars are for, ticks a reviewed one, and leaves out one that cannot be reviewed", async () => {
    const user = userEvent.setup();
    render(<ReviewAsk order={order} asks hasGoods dialog={null} storeName="Clay House" theme={theme} preview />);
    const picks = [...document.querySelectorAll("[data-order-review-pick]")].map((node) =>
      node.getAttribute("data-order-review-pick"),
    );
    // The refunded or removed product is not offered at all.
    expect(picks).toEqual(["p1", "p2"]);
    const speaker = screen.getByRole("button", { name: "Walnut speaker" });
    expect(speaker.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Studio headphones Reviewed" })).toBeTruthy();
    // The chosen product's card names it under the question.
    const visible = () => document.querySelector<HTMLElement>("[data-order-review-item]:not([hidden])")!;
    expect(visible().getAttribute("data-order-review-item")).toBe("p1");
    expect(visible().querySelector("[data-order-review-subject]")?.textContent).toBe("Walnut speaker");
    await user.click(screen.getByRole("button", { name: "Studio headphones Reviewed" }));
    expect(visible().getAttribute("data-order-review-item")).toBe("p2");
    expect(visible().querySelector('[data-order-review="done"]')).not.toBeNull();
  });
});

describe("the cart on the designer's canvas", () => {
  const sample = (id: string, title: string, priceCents: number) => ({ id, title, priceCents, currency: "EUR" as const, image: null });
  const view = sampleCartView(
    [sample("p1", "Mug", 1000), sample("p2", "Bowl", 500), sample("p3", "Plate", 700)],
    { state: "full", freeOverCents: 5000 },
  );
  const items = () => document.querySelector("[data-cart-items]")?.getAttribute("data-cart-items");

  it("steps, removes and puts back a sample's lines, sending nothing", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const user = userEvent.setup();
    render(
      <CartPreviewProvider storefrontId={LAB_STOREFRONT_ID} config={{}} view={view} drawer="inline">
        <CartPanelSurface theme={panelTheme} />
      </CartPreviewProvider>,
    );
    expect(items()).toBe("2700");
    await user.click(screen.getByRole("button", { name: "One more Mug" }));
    expect(items()).toBe("3700");
    await user.click(screen.getByRole("button", { name: "Remove Plate" }));
    expect(document.querySelectorAll("[data-cart-lines] > li")).toHaveLength(2);
    expect(items()).toBe("3000");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(document.querySelectorAll("[data-cart-lines] > li")).toHaveLength(3);
    expect(items()).toBe("3700");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("invites the seller's note on the canvas and never shows a buyer the invitation", () => {
    render(
      <CartEditProvider cartPage={{}} onChange={() => {}}>
        <CartPreviewProvider storefrontId={LAB_STOREFRONT_ID} config={{}} view={view}>
          <CartPanelSurface theme={panelTheme} />
        </CartPreviewProvider>
      </CartEditProvider>,
    );
    expect(document.querySelector('[data-cart-note="empty"]')?.textContent).toBe("Add a note for your buyers here");
    expect(screen.getByRole("button", { name: "Edit the cart's heading" }).textContent).toBe("Your cart");
    cleanup();
    render(
      <CartPreviewProvider storefrontId={LAB_STOREFRONT_ID} config={{}} view={view}>
        <CartContents theme={panelTheme} />
      </CartPreviewProvider>,
    );
    expect(document.querySelector("[data-cart-note]")).toBeNull();
  });
});

describe("the Cart settings' guess", () => {
  function Panel({ addable }: { addable: number }) {
    const [cartPage, setCartPage] = useState<CartPageConfig>({});
    return (
      <>
        <CartPageSection cartPage={cartPage} onCartPageChange={setCartPage} addable={addable} />
        <output data-testid="config">{JSON.stringify(cartPage)}</output>
      </>
    );
  }

  it("offers Add to cart as the leading button behind one tap, and takes it back with one", async () => {
    const user = userEvent.setup();
    render(<Panel addable={4} />);
    await user.click(screen.getByRole("button", { name: "Lead with Add to cart" }));
    expect(screen.getByTestId("config").textContent).toBe('{"mainButton":"addToCart"}');
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByTestId("config").textContent).toBe("{}");
  });

  it("says nothing for a board with few products a card can add", () => {
    render(<Panel addable={2} />);
    expect(document.querySelector("[data-cart-lead-suggestion]")).toBeNull();
  });
});

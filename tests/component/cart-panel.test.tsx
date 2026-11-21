import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "../setup/render";
import { CartPreviewProvider } from "@/components/cart/CartContext";
import { CartContents, CartSummary, type CartPanelTheme } from "@/components/cart/CartPanel";
import { LAB_SCENARIOS, LAB_SHOPS, LAB_STOREFRONT_ID } from "@/app/dev/cart-lab/fixtures";
import type { CartPageConfig } from "@/types/storefront";
import type { CartView } from "@/types/cart";

/**
 * The cart a buyer sees, drawn from the lab's carts: every problem line says
 * why on the line itself and stops the checkout, the subtotal counts only what
 * can be bought, the stepper keeps to the public limit, and the seller's
 * delivery-bar switch is obeyed.
 */

const shop = LAB_SHOPS[0];
const theme: CartPanelTheme = { ink: shop.ink, cornerRadius: shop.cornerRadius, cta: shop.cta };

function renderCart(view: CartView, config: CartPageConfig = {}) {
  return render(
    <CartPreviewProvider storefrontId={LAB_STOREFRONT_ID} config={config} view={view}>
      <CartContents theme={theme} />
      <CartSummary theme={theme} />
    </CartPreviewProvider>,
  );
}

const checkoutLink = () => document.querySelector<HTMLAnchorElement>("[data-cart-summary] a")!;

afterEach(cleanup);

describe("the cart", () => {
  it("says on each problem line why it cannot be bought, and stops the checkout", () => {
    renderCart(LAB_SCENARIOS.problems.view);
    const problems = [...document.querySelectorAll("[data-cart-line-problem]")].map((node) =>
      node.getAttribute("data-cart-line-problem"),
    );
    expect(problems).toEqual(["sold_out", "insufficient_stock", "not_found"]);
    expect(screen.getByText(/Sold out\. Take it out to check out\./)).toBeTruthy();
    // Only the walnut speaker can be bought: the subtotal is its price alone.
    expect(document.querySelector("[data-cart-items]")!.getAttribute("data-cart-items")).toBe("8900");
    expect(checkoutLink().getAttribute("aria-disabled")).toBe("true");
    expect(checkoutLink().hasAttribute("href")).toBe(false);
    expect(checkoutLink().className).toContain("opacity-60");
  });

  it("offers no stepper on a line that is no longer sold, only a way to take it out", () => {
    renderCart(LAB_SCENARIOS.problems.view);
    const gone = document.querySelector<HTMLElement>('[data-cart-problem="not_found"]')!;
    expect(within(gone).queryByRole("group")).toBeNull();
    expect(within(gone).getByRole("button", { name: /Remove/ })).toBeTruthy();
  });

  it("keeps the stepper between one and the public limit", () => {
    const view = LAB_SCENARIOS.three.view;
    const atLimit: CartView = {
      ...view,
      lines: view.lines.map((line, index) => (index === 1 ? { ...line, quantity: 10, maxQuantity: 10 } : line)),
    };
    renderCart(atLimit);
    // The speaker holds one: nothing fewer.
    expect(screen.getByRole("button", { name: "One fewer Walnut speaker" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "One more Walnut speaker" }).hasAttribute("disabled")).toBe(false);
    // The headphones are at the limit: nothing more.
    expect(screen.getByRole("button", { name: "One more Studio headphones" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "One fewer Studio headphones" }).hasAttribute("disabled")).toBe(false);
  });

  it("shows how far free delivery is, unless the seller switched that off", () => {
    renderCart(LAB_SCENARIOS.three.view);
    expect(document.querySelector("[data-cart-free-gap]")).not.toBeNull();
    expect(checkoutLink().className).not.toContain("opacity-60");
    cleanup();
    renderCart(LAB_SCENARIOS.three.view, { deliveryBar: false });
    expect(document.querySelector("[data-cart-free-gap]")).toBeNull();
  });
});

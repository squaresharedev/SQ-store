import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { cleanup, render, screen, within } from "../setup/render";
import { orderView } from "../setup/order-view";

// The pricing modal as each kind of reader meets it, with the server actions
// stubbed: what it offers depends on the store's plan and on who is looking,
// and pressing an action asks the server, never builds a URL of its own.

vi.mock("@/lib/billing/actions", () => ({
  loadPricingContext: vi.fn(),
  startCheckout: vi.fn(),
  openBillingPortal: vi.fn(),
}));
vi.mock("@/lib/orders/actions", () => ({ markOrderShipped: vi.fn() }));

import { PricingModal, type PricingModalActions } from "@/components/billing/PricingModal";
import { OrderDetail } from "@/components/orders/OrderDetail";
import type { PricingContext } from "@/lib/billing/actions";

afterEach(cleanup);

// jsdom does not implement window.matchMedia; the calculator's slider reads it.
// Same stub as color-picker.test.tsx.
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

const FREE: PricingContext = {
  plan: "free",
  interval: null,
  status: "none",
  cancelAtPeriodEnd: false,
  currentPeriodEnd: null,
  priceCents: null,
  hasSubscription: false,
  canManage: true,
  available: true,
  salesSubtotal30dCents: 0,
  usage: { storefronts: 1, teamSeats: 1 },
};

function actionsFor(context: PricingContext, overrides: Partial<PricingModalActions> = {}): PricingModalActions {
  return {
    loadContext: vi.fn(async () => ({ ok: true as const, context })),
    startCheckout: vi.fn(async () => ({ ok: true as const, url: "https://checkout.stripe.com/c/pay/cs_test_1" })),
    openPortal: vi.fn(async () => ({ url: "https://billing.stripe.com/p/session/1" })),
    navigate: vi.fn(),
    ...overrides,
  };
}

async function openWith(actions: PricingModalActions) {
  render(<PricingModal source="sidebar" onClose={() => {}} actions={actions} />);
  // The cards arrive once the store's context has loaded.
  await screen.findAllByRole("listitem", { name: undefined });
  return screen.getByRole("dialog");
}

describe("PricingModal", () => {
  it("offers a Free owner an upgrade to each paid plan, and asks the server for the checkout", async () => {
    const actions = actionsFor(FREE);
    const user = userEvent.setup();
    const dialog = await openWith(actions);

    expect(actions.loadContext).toHaveBeenCalledWith("sidebar");
    const free = dialog.querySelector("[data-pricing-plan='free']") as HTMLElement;
    expect(within(free).getByText("Current plan")).toBeTruthy();
    expect(within(free).queryByRole("button")).toBeNull();

    await user.click(within(dialog).getByRole("button", { name: /Upgrade to Pro/ }));
    expect(actions.startCheckout).toHaveBeenCalledWith({ plan: "pro", interval: "month", source: "sidebar" });
    expect(actions.navigate).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/cs_test_1");
  });

  it("sends the chosen billing period with the upgrade", async () => {
    const actions = actionsFor(FREE);
    const user = userEvent.setup();
    const dialog = await openWith(actions);
    await user.click(within(dialog).getByRole("button", { name: "Yearly" }));
    await user.click(within(dialog).getByRole("button", { name: /Upgrade to Starter/ }));
    expect(actions.startCheckout).toHaveBeenCalledWith({ plan: "starter", interval: "year", source: "sidebar" });
  });

  it("shows the server's refusal instead of leaving", async () => {
    const actions = actionsFor(FREE, {
      startCheckout: vi.fn(async () => ({
        ok: false as const,
        error: { code: "server_error" as const, message: { key: "Errors.billing.unavailable" as const } },
      })),
    });
    const user = userEvent.setup();
    const dialog = await openWith(actions);
    await user.click(within(dialog).getByRole("button", { name: /Upgrade to Starter/ }));
    expect(await within(dialog).findByText("Paid plans aren't available right now.")).toBeTruthy();
    expect(actions.navigate).not.toHaveBeenCalled();
  });

  it("routes a subscribed owner's changes through the Customer Portal", async () => {
    const actions = actionsFor({
      ...FREE,
      plan: "starter",
      interval: "month",
      status: "active",
      priceCents: 1500,
      hasSubscription: true,
    });
    const dialog = await openWith(actions);
    expect(within(dialog).queryByRole("button", { name: /Upgrade to/ })).toBeNull();
    expect(within(dialog).getByRole("button", { name: /Switch to Pro/ })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /Move to Free/ })).toBeTruthy();
  });

  it("gives a teammate the plans to read and nothing to press", async () => {
    const dialog = await openWith(actionsFor({ ...FREE, canManage: false }));
    expect(within(dialog).queryByRole("button", { name: /Upgrade|Switch|Move to Free/ })).toBeNull();
    expect(within(dialog).getByText("Only the store owner can change its plan.")).toBeTruthy();
  });

  it("marks upgrades Soon where billing is not set up", async () => {
    const dialog = await openWith(actionsFor({ ...FREE, available: false }));
    const upgrade = within(dialog).getByRole("button", { name: /Upgrade to Pro/ });
    expect((upgrade as HTMLButtonElement).disabled).toBe(true);
    expect(within(upgrade).getByText("Soon")).toBeTruthy();
  });

  it("points a store with real sales at the plan that costs it least", async () => {
    const dialog = await openWith(actionsFor({ ...FREE, salesSubtotal30dCents: 20_000 }));
    // €200 a month: Free's fee is still less than any subscription.
    const free = dialog.querySelector("[data-pricing-plan='free']") as HTMLElement;
    expect(within(free).getByText("Current plan")).toBeTruthy();
    expect(dialog.querySelector("[data-cheapest]")?.getAttribute("data-pricing-cost")).toBe("free");
  });
});

describe("the fee on an order", () => {
  it("names the rate the sale was charged at", () => {
    render(<OrderDetail order={orderView({ platformFeeBps: 300, platformFeeCents: 75 })} onClose={() => {}} />);
    expect(screen.getByText("Platform fee (3%)")).toBeTruthy();
  });

  it("keeps the bare label on orders from before plans", () => {
    render(<OrderDetail order={orderView({ platformFeeBps: null })} onClose={() => {}} />);
    expect(screen.getByText("Platform fee")).toBeTruthy();
  });
});

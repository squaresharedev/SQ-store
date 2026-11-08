import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "../setup/render";
import { orderView } from "../setup/order-view";

// With Stripe on, a disputed order takes its owner straight to where the
// dispute is answered. A member who cannot open the store's Stripe account is
// told where it happens and offered nothing that would refuse them.

vi.mock("@/lib/payments/availability", () => ({ STRIPE_CONNECT_AVAILABLE: true }));
const openStripeDashboard = vi.fn(async () => ({ ok: true as const, url: "https://stripe.test/express" }));
vi.mock("@/lib/payments/connect/actions", () => ({ openStripeDashboard: () => openStripeDashboard() }));
const leaveForStripe = vi.fn();
vi.mock("@/components/billing/billing-actions", () => ({ leaveForStripe: (url: string) => leaveForStripe(url) }));
vi.mock("@/lib/orders/actions", () => ({ markOrderShipped: vi.fn(), refundOrder: vi.fn() }));

const { OrderActions } = await import("@/components/orders/OrderActions");
const { OrderRefundProvider } = await import("@/components/orders/OrderRefundProvider");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderDisputed(owner: boolean, storeName: string | null = null) {
  render(
    <OrderRefundProvider allowed={owner} storeName={storeName}>
      <OrderActions order={orderView({ status: "disputed" })} />
    </OrderRefundProvider>,
  );
}

describe("a disputed order", () => {
  it("opens the owner's Stripe dashboard to answer it", async () => {
    renderDisputed(true);
    fireEvent.click(screen.getByRole("button", { name: "Answer in Stripe" }));
    await waitFor(() => expect(leaveForStripe).toHaveBeenCalledWith("https://stripe.test/express"));
  });

  it("says what missing the deadline costs", () => {
    renderDisputed(true);
    expect(screen.getByText(/before its deadline, or the buyer gets the money back/)).toBeInTheDocument();
  });

  it("offers a member no button, only where it is answered and who can", () => {
    renderDisputed(false);
    expect(screen.getByText(/Answer it in your Stripe dashboard/)).toBeInTheDocument();
    expect(screen.getByText("Only the store's owner can answer it.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Answer in Stripe" })).toBeNull();
    cleanup();

    // Working in someone else's store: who to tell, by the store's name.
    renderDisputed(false, "Clay & Co");
    expect(screen.getByText("Only the owner of Clay & Co can answer it. Let them know.")).toBeInTheDocument();
  });
});

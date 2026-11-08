import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "../setup/render";
import { orderView } from "../setup/order-view";
import type { OrderView } from "@/types/order-view";

// The money line is the one a seller trusts most, so it must not overstate:
// Stripe's card fee is still to come on an order paid through Stripe (and is
// not mentioned on one that was not), and a refunded order leaves the seller
// nothing (our fee goes back with the payment).

vi.mock("@/lib/orders/actions", () => ({ markOrderShipped: vi.fn(), refundOrder: vi.fn() }));

import { OrderDetail } from "@/components/orders/OrderDetail";

afterEach(cleanup);

function ledger(order: OrderView) {
  render(<OrderDetail order={order} onClose={vi.fn()} canFulfil={false} />);
  return within(screen.getByText("Amount").closest("dl") as HTMLElement);
}

describe("OrderDetail money ledger", () => {
  const paid = orderView({ amountCents: 4500, platformFeeCents: 225, currency: "EUR", status: "paid" });

  it("a paid order shows what the seller receives, with no Stripe hint when not paid through provider", () => {
    const money = ledger(paid);
    expect(money.getByText("You receive")).toBeInTheDocument();
    expect(money.queryByText("Before Stripe's card fee")).toBeNull();
  });

  it("a paid order through the provider shows the Stripe card fee hint", () => {
    const money = ledger({ ...paid, paidThroughProvider: true });
    expect(money.getByText("You receive")).toBeInTheDocument();
    expect(money.getByText("Before Stripe's card fee")).toBeInTheDocument();
  });

  it("a refunded order shows what went back instead of money the seller has", () => {
    const money = ledger({ ...paid, status: "refunded" });
    expect(money.queryByText("You receive")).toBeNull();
    const line = money.getByText("Refunded").closest("div") as HTMLElement;
    expect(line).toHaveTextContent("45.00");
  });
});

import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { act, cleanup, render, screen } from "../setup/render";
import { orderView } from "../setup/order-view";
import { stubClipboard } from "../setup/clipboard";
import type { OrderView } from "@/types/order-view";

// What a seller is told and handed at each step of dealing with an order beyond
// the ship button itself: the number the buyer quotes, a way to write to them,
// the truth about refunds, what a read-only member is spared, where focus goes
// after each step and how a queue is cleared.

const markOrderShippedMock = vi.fn();
vi.mock("@/lib/orders/actions", () => ({
  markOrderShipped: (...args: unknown[]) => markOrderShippedMock(...args),
}));

import { OrderDetail } from "@/components/orders/OrderDetail";
import { OrderMailProvider } from "@/components/orders/OrderMailProvider";
import { OrderRow } from "@/components/orders/OrderRow";

afterEach(cleanup);

const ADDRESS = {
  name: "Aoife Byrne",
  line1: "12 Harbour Road",
  city: "Dublin",
  postalCode: "D02 X285",
  country: "IE",
};

const waiting = orderView({
  productTitle: "Blue mug",
  shipTo: ADDRESS,
  fulfilment: { status: "unfulfilled", shippedAt: null, trackingNumber: null, carrier: null },
});

function shippedFrom(order: OrderView): OrderView {
  return {
    ...order,
    fulfilment: { status: "shipped", shippedAt: "2026-09-27T10:00:00Z", trackingNumber: null, carrier: null },
  };
}

function renderDetail(
  order: OrderView,
  props: { canFulfil?: boolean; onNext?: () => void; queueDone?: boolean } = {},
) {
  return render(
    <OrderDetail order={order} onClose={vi.fn()} canFulfil={props.canFulfil ?? true} {...props} />,
  );
}

/** Holds the order in state the way the page does, so a ship updates the panel. */
function Harness({ initial, onNext }: { initial: OrderView; onNext?: () => void }) {
  const [order, setOrder] = useState(initial);
  return (
    <OrderDetail order={order} onClose={vi.fn()} canFulfil onOrderChange={setOrder} onNext={onNext} />
  );
}

const playOut = (ms = 5000) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  markOrderShippedMock.mockReset();
});

describe("the number the buyer quotes", () => {
  it("is shown on the order, and copies on its own", async () => {
    const user = userEvent.setup();
    const writeText = stubClipboard();
    renderDetail(waiting);
    expect(document.querySelector("[data-order-number]")).toHaveTextContent("Order AAAAAAAA");
    await user.click(screen.getByRole("button", { name: "Copy order number" }));
    expect(writeText).toHaveBeenCalledWith("AAAAAAAA");
  });
});

describe("writing to the buyer", () => {
  const SUBJECT_LINK = "mailto:buyer@example.com?subject=Your%20order%20AAAAAAAA";
  // A paid order offers it in more than one place (the situation's own note and
  // the refund note under the panel), and they all say the same thing.
  const links = () => screen.getAllByRole("link", { name: "Email the buyer" });

  it("is offered beside a withdrawal, with the order number in the subject", () => {
    renderDetail({ ...waiting, withdrawalRequestedAt: "2026-09-28T09:00:00Z" });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("withdraw");
    expect(alert.querySelector("a")).toHaveAttribute("href", SUBJECT_LINK);
  });

  it("is offered where the address is missing, since asking for it is the only way on", () => {
    renderDetail({ ...waiting, shipTo: null });
    const note = screen.getByText(/no delivery address on this order/i);
    expect(note.parentElement?.querySelector("a")).toHaveAttribute("href", SUBJECT_LINK);
    expect(links().length).toBeGreaterThan(0);
  });

  it("is not offered at all when the order has no buyer email", () => {
    renderDetail({ ...waiting, shipTo: null, buyerEmail: null });
    expect(screen.queryByRole("link", { name: "Email the buyer" })).toBeNull();
  });
});

describe("refunds, while Stripe is not connected", () => {
  it("says how to refund today instead of offering a button that cannot work", () => {
    renderDetail({ ...waiting, fulfilment: shippedFrom(waiting).fulfilment });
    expect(screen.getByText(/can't refund from Square Share yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refund order" })).toBeNull();
    expect(screen.queryByRole("link", { name: /Connect Stripe/ })).toBeNull();
  });

  it("says where a dispute is handled, with nothing to press", () => {
    renderDetail(orderView({ status: "disputed" }));
    expect(screen.getByText(/Disputes are handled in your Stripe dashboard/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Handle dispute" })).toBeNull();
  });

  it("spares a member who cannot fulfil the whole footer", () => {
    renderDetail(waiting, { canFulfil: false });
    expect(screen.queryByText(/can't refund from Square Share yet/)).toBeNull();
    expect(screen.queryByText("No actions are available for this order.")).toBeNull();
  });
});

describe("what the ship form promises", () => {
  it("says the buyer will be emailed, where mail is on", async () => {
    const user = userEvent.setup();
    renderDetail(waiting);
    await user.click(screen.getByRole("button", { name: "Mark as shipped" }));
    expect(screen.getByText(/We'll email the buyer/)).toBeInTheDocument();
  });

  it("says the buyer will NOT be told, where mail is off", async () => {
    const user = userEvent.setup();
    render(
      <OrderMailProvider enabled={false}>
        <OrderDetail order={waiting} onClose={vi.fn()} canFulfil />
      </OrderMailProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Mark as shipped" }));
    expect(screen.getByText(/Email isn't switched on yet, so the buyer won't be told/)).toBeInTheDocument();
    expect(screen.queryByText(/We'll email the buyer/)).toBeNull();
  });

  it("warns on a withdrawn order, which is shipped only by choice", async () => {
    const user = userEvent.setup();
    renderDetail({ ...waiting, withdrawalRequestedAt: "2026-09-28T09:00:00Z" });
    await user.click(screen.getByRole("button", { name: "Mark as shipped" }));
    expect(screen.getByText(/buyer has withdrawn from this purchase. Ship it only if/)).toBeInTheDocument();
  });

  it("does not warn on an ordinary order", async () => {
    const user = userEvent.setup();
    renderDetail(waiting);
    await user.click(screen.getByRole("button", { name: "Mark as shipped" }));
    expect(screen.queryByText(/has withdrawn from this purchase/)).toBeNull();
  });
});

describe("where focus goes", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns to the opening button when the form is cancelled", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderDetail(waiting);
    await user.click(screen.getByRole("button", { name: "Mark as shipped" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Mark as shipped" })).toHaveFocus();
  });

  it("lands on the shipped status once the order has gone, not on the page", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    markOrderShippedMock.mockResolvedValue({
      ok: true,
      order: shippedFrom(waiting),
      buyerEmailed: true,
    });
    render(<Harness initial={waiting} />);
    await user.click(screen.getByRole("button", { name: "Mark as shipped" }));
    await user.click(screen.getByRole("button", { name: "Mark shipped" }));
    await playOut();
    expect(document.querySelector("[data-order-shipped-status]")).toHaveFocus();
  });
});

describe("clearing the queue", () => {
  const sent = shippedFrom(waiting);

  it("offers the next order once this one has gone, and opens it on press", async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    renderDetail(sent, { onNext });
    await user.click(screen.getByRole("button", { name: "Next order to ship" }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("says they are caught up when it was the last", () => {
    renderDetail(sent, { queueDone: true });
    expect(document.querySelector("[data-order-queue-done]")).toHaveTextContent("caught up");
    expect(screen.queryByRole("button", { name: "Next order to ship" })).toBeNull();
  });

  it("says nothing of a queue for an order opened from the full list", () => {
    renderDetail(sent);
    expect(screen.queryByRole("button", { name: "Next order to ship" })).toBeNull();
    expect(document.querySelector("[data-order-queue-done]")).toBeNull();
  });
});

describe("the orders list", () => {
  const inTable = (order: OrderView, view: "all" | "to-ship" = "all") =>
    render(
      <table>
        <tbody>
          <OrderRow order={order} onSelect={vi.fn()} view={view} />
        </tbody>
      </table>,
    );

  it("marks a withdrawn order in the list itself", () => {
    inTable({ ...waiting, withdrawalRequestedAt: "2026-09-28T09:00:00Z" });
    expect(document.querySelector("[data-order-withdrawn]")).toHaveTextContent("Withdrawn");
  });

  it("does not mark an ordinary order", () => {
    inTable(waiting);
    expect(document.querySelector("[data-order-withdrawn]")).toBeNull();
  });

  it("asks for shipping only where the order is one to send", () => {
    // Unpaid: not the seller's job yet, so no loud "To ship" chip on it.
    const { unmount } = inTable({ ...waiting, status: "pending" });
    expect(document.querySelector("[data-fulfilment]")).toBeNull();
    unmount();
    inTable(waiting);
    expect(document.querySelector('[data-fulfilment="unfulfilled"]')).toHaveTextContent("To ship");
  });

  describe("how long it has waited", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      vi.setSystemTime(new Date("2026-09-30T12:00:00Z"));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("is said in the queue, in ink once it is overdue", () => {
      inTable({ ...waiting, createdAt: "2026-09-20T12:00:00Z" }, "to-ship");
      const cue = document.querySelector("[data-order-waiting]");
      expect(cue).toHaveTextContent("10 days ago");
      expect(cue).toHaveAttribute("data-order-waiting", "overdue");
    });

    it("is said plainly while it is recent", () => {
      inTable({ ...waiting, createdAt: "2026-09-30T09:00:00Z" }, "to-ship");
      const cue = document.querySelector("[data-order-waiting]");
      expect(cue).toHaveTextContent("3 hours ago");
      expect(cue).toHaveAttribute("data-order-waiting", "ok");
    });

    it("is left out of the full list, where every order is history", () => {
      inTable({ ...waiting, createdAt: "2026-09-20T12:00:00Z" }, "all");
      expect(document.querySelector("[data-order-waiting]")).toBeNull();
    });
  });
});

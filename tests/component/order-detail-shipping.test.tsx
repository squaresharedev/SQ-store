import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { act, cleanup, render, screen, within } from "../setup/render";
import { orderView } from "../setup/order-view";
import { stubClipboard } from "../setup/clipboard";
import type { OrderView } from "@/types/order-view";

// The order panel as a seller packing a parcel uses it: what goes in the box,
// where it goes (copyable in one go), and the two clicks that mark it shipped.

const markOrderShippedMock = vi.fn();
vi.mock("@/lib/orders/actions", () => ({
  markOrderShipped: (...args: unknown[]) => markOrderShippedMock(...args),
}));

import { OrderDetail } from "@/components/orders/OrderDetail";

afterEach(cleanup);

const ADDRESS = {
  name: "Aoife Byrne",
  line1: "12 Harbour Road",
  line2: "Apartment 4",
  city: "Dublin",
  postalCode: "D02 X285",
  country: "IE",
  phone: "+353 87 123 4567",
};

const waiting = orderView({
  productTitle: "Blue mug",
  quantity: 2,
  selection: [{ label: "Size", value: "Large" }],
  shipTo: ADDRESS,
  fulfilment: { status: "unfulfilled", shippedAt: null, trackingNumber: null, carrier: null },
});

function renderDetail(order: OrderView, options: { canFulfil?: boolean; onOrderChange?: (o: OrderView) => void } = {}) {
  return render(
    <OrderDetail
      order={order}
      onClose={vi.fn()}
      canFulfil={options.canFulfil ?? true}
      onOrderChange={options.onOrderChange}
    />,
  );
}

beforeEach(() => {
  markOrderShippedMock.mockReset();
});

describe("what to pack, and where it goes", () => {
  it("leads with the units and the version", () => {
    renderDetail(waiting);
    expect(screen.getByText("What to pack")).toBeInTheDocument();
    expect(document.querySelector("[data-order-pack]")).toHaveTextContent("2 × Blue mug");
    expect(document.querySelector("[data-order-selection]")).toHaveTextContent("Size:Large");
  });

  it("prints the address as a label, and copies it in one go", async () => {
    const user = userEvent.setup();
    const writeText = stubClipboard();
    renderDetail(waiting);
    const label = document.querySelector("[data-order-ship-to]")!;
    expect(label.textContent).toBe("Aoife Byrne\n12 Harbour Road\nApartment 4\nDublin\nD02 X285\nIreland");

    await user.click(screen.getByRole("button", { name: "Copy address" }));
    expect(writeText).toHaveBeenCalledWith(label.textContent);
    await user.click(screen.getByRole("button", { name: "Copy phone number" }));
    expect(writeText).toHaveBeenCalledWith("+353 87 123 4567");
  });

  it("says plainly when an order has no address", () => {
    renderDetail({ ...waiting, shipTo: null });
    expect(screen.getByText(/no delivery address on this order/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy address" })).toBeNull();
  });

  it("has nothing to pack or address for a download", () => {
    renderDetail(orderView({ fulfilment: { status: "not_required", shippedAt: null, trackingNumber: null, carrier: null } }));
    expect(screen.queryByText("What to pack")).toBeNull();
    expect(screen.queryByText("Ship to")).toBeNull();
    expect(screen.getByText("Nothing to ship for this order.")).toBeInTheDocument();
  });
});

/**
 * Marking shipped plays a sequence (the truck revs, drives across the button,
 * the success holds) before the panel moves on. Real time flows, so nothing
 * that waits on a clock can hang, and `playOut` jumps the rest of it.
 */
const playOut = (ms = 5000) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

describe("marking it shipped", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks for an optional tracking number, then ships and tells the seller the buyer was emailed", async () => {
    const user = userEvent.setup();
    const onOrderChange = vi.fn();
    const after = orderView({
      ...waiting,
      fulfilment: { status: "shipped", shippedAt: "2026-09-27T10:00:00Z", trackingNumber: "RR123456789IE", carrier: null },
    });
    markOrderShippedMock.mockResolvedValue({ ok: true, order: after, buyerEmailed: true });
    renderDetail(waiting, { onOrderChange });

    await user.click(screen.getByRole("button", { name: "Mark as shipped" }));
    const field = screen.getByLabelText("Tracking number (optional)");
    expect(field).toHaveFocus();
    expect(screen.getByText(/We'll email the buyer/)).toBeInTheDocument();

    await user.type(field, "RR123456789IE");
    await user.click(screen.getByRole("button", { name: "Mark shipped" }));

    expect(markOrderShippedMock).toHaveBeenCalledWith(waiting.id, "RR123456789IE", null);
    await playOut();
    expect(onOrderChange).toHaveBeenCalledWith(after);
    expect(await screen.findByText("Marked as shipped. We've emailed the buyer.")).toBeInTheDocument();
  });

  it("takes the carrier from a list, once there is a number for it to describe", async () => {
    const user = userEvent.setup();
    markOrderShippedMock.mockResolvedValue({ ok: true, order: waiting, buyerEmailed: true });
    renderDetail(waiting);

    await user.click(screen.getByRole("button", { name: "Mark as shipped" }));
    const carrier = screen.getByRole("combobox", { name: "Carrier (optional)" });
    // A carrier says where a NUMBER is followed, so it waits for one.
    expect(carrier).toBeDisabled();
    expect(carrier).toHaveTextContent("Other or not listed");

    await user.type(screen.getByLabelText("Tracking number (optional)"), "RR123456789IE");
    expect(carrier).toBeEnabled();
    await user.click(carrier);
    // A pick, never a typed link: the list is the carriers this app can link to.
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(
      expect.arrayContaining(["Other or not listed", "An Post", "DHL", "Royal Mail"]),
    );
    await user.click(screen.getByRole("option", { name: "An Post" }));
    expect(carrier).toHaveTextContent("An Post");

    await user.click(screen.getByRole("button", { name: "Mark shipped" }));
    expect(markOrderShippedMock).toHaveBeenCalledWith(waiting.id, "RR123456789IE", "an-post");
    await playOut();
  });

  it("sends no carrier once the number it described has been cleared", async () => {
    const user = userEvent.setup();
    markOrderShippedMock.mockResolvedValue({ ok: true, order: waiting, buyerEmailed: true });
    renderDetail(waiting);

    await user.click(screen.getByRole("button", { name: "Mark as shipped" }));
    const field = screen.getByLabelText("Tracking number (optional)");
    await user.type(field, "RR123456789IE");
    await user.click(screen.getByRole("combobox", { name: "Carrier (optional)" }));
    await user.click(screen.getByRole("option", { name: "DHL" }));
    await user.clear(field);
    expect(screen.getByRole("combobox", { name: "Carrier (optional)" })).toHaveTextContent("Other or not listed");

    await user.click(screen.getByRole("button", { name: "Mark shipped" }));
    expect(markOrderShippedMock).toHaveBeenCalledWith(waiting.id, "", null);
    await playOut();
  });

  it("does not claim the buyer was told when they were not", async () => {
    const user = userEvent.setup();
    markOrderShippedMock.mockResolvedValue({ ok: true, order: waiting, buyerEmailed: false });
    renderDetail(waiting);
    await user.click(screen.getByRole("button", { name: "Mark as shipped" }));
    await user.click(screen.getByRole("button", { name: "Mark shipped" }));
    await playOut();
    expect(await screen.findByText("Marked as shipped.")).toBeInTheDocument();
    expect(screen.queryByText(/We've emailed the buyer/)).toBeNull();
  });

  it("spins the wheels until the server answers, then drives into a success state and only then moves on", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onOrderChange = vi.fn();
    const after = orderView({
      ...waiting,
      fulfilment: { status: "shipped", shippedAt: "2026-09-27T10:00:00Z", trackingNumber: null, carrier: null },
    });
    let answer!: (value: unknown) => void;
    markOrderShippedMock.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    renderDetail(waiting, { onOrderChange });

    await user.click(screen.getByRole("button", { name: "Mark as shipped" }));
    const confirm = screen.getByRole("button", { name: "Mark shipped" });
    expect(confirm).toHaveAttribute("data-ship", "idle");
    await user.click(confirm);
    expect(confirm).toHaveAttribute("data-ship", "working");
    expect(confirm).toHaveAttribute("aria-busy", "true");

    // Long past the shortest rev, and still no success: the server has not said yes.
    await playOut(3000);
    expect(confirm).toHaveAttribute("data-ship", "working");
    await user.click(confirm);
    expect(markOrderShippedMock).toHaveBeenCalledTimes(1);

    answer({ ok: true, order: after, buyerEmailed: true });
    await playOut(50);
    expect(confirm).toHaveAttribute("data-ship", "delivered");
    // The success is left standing rather than swapped away the instant it lands.
    expect(onOrderChange).not.toHaveBeenCalled();

    await playOut(3000);
    expect(onOrderChange).toHaveBeenCalledWith(after);
  });

  it("shows the server's refusal next to the field and keeps the form open", async () => {
    const user = userEvent.setup();
    markOrderShippedMock.mockResolvedValue({
      ok: false,
      error: {
        code: "invalid_input",
        message: { key: "Validation.referenceCode.trackingNumber", values: { min: 4, max: 40 } },
      },
    });
    renderDetail(waiting);
    await user.click(screen.getByRole("button", { name: "Mark as shipped" }));
    await user.type(screen.getByLabelText("Tracking number (optional)"), "no");
    await user.click(screen.getByRole("button", { name: "Mark shipped" }));
    await playOut(1000);
    expect(await screen.findByRole("alert")).toHaveTextContent("A tracking number is 4 to 40 letters");
    expect(screen.getByLabelText("Tracking number (optional)")).toBeInTheDocument();
    // The truck parks again: a refusal never shows the success.
    expect(screen.getByRole("button", { name: "Mark shipped" })).toHaveAttribute("data-ship", "idle");
  });

  it("cancel closes the form without shipping", async () => {
    const user = userEvent.setup();
    renderDetail(waiting);
    await user.click(screen.getByRole("button", { name: "Mark as shipped" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Mark as shipped" })).toBeInTheDocument();
    expect(markOrderShippedMock).not.toHaveBeenCalled();
  });

  it("offers no controls to a member who may not ship", () => {
    renderDetail(waiting, { canFulfil: false });
    expect(screen.queryByRole("button", { name: "Mark as shipped" })).toBeNull();
    expect(document.querySelector('[data-fulfilment="unfulfilled"]')).toHaveTextContent("To ship");
  });

  it("explains why an unpaid order cannot ship yet", () => {
    renderDetail({ ...waiting, status: "pending" });
    expect(screen.queryByRole("button", { name: "Mark as shipped" })).toBeNull();
    expect(screen.getByText(/payment hasn't gone through yet/)).toBeInTheDocument();
  });
});

describe("a shipped order", () => {
  const sent = orderView({
    ...waiting,
    fulfilment: { status: "shipped", shippedAt: "2026-09-27T10:00:00Z", trackingNumber: "RR123456789IE", carrier: null },
  });

  it("says when it went and how to follow it", () => {
    renderDetail(sent);
    expect(screen.getByText(/^Shipped /)).toBeInTheDocument();
    expect(document.querySelector("[data-order-tracking]")).toHaveTextContent("RR123456789IE");
    expect(screen.getByRole("button", { name: "Copy tracking number" })).toBeInTheDocument();
  });

  it("links the number to its carrier's own tracking page when the carrier is named", () => {
    renderDetail({ ...sent, fulfilment: { ...sent.fulfilment, carrier: "an-post" } });
    expect(screen.getByText("Tracking number (An Post)")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "RR123456789IE" });
    expect(link).toHaveAttribute("href", "https://www.anpost.com/Post-Parcels/Track/History?item=RR123456789IE");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByRole("button", { name: "Copy tracking number" })).toBeInTheDocument();
  });

  it("leaves the number as plain text when no carrier is named", () => {
    renderDetail(sent);
    expect(screen.getByText("Tracking number")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "RR123456789IE" })).toBeNull();
  });

  it("opens the change form with the carrier it already has", async () => {
    const user = userEvent.setup();
    const withCarrier = { ...sent, fulfilment: { ...sent.fulfilment, carrier: "dhl" as const } };
    markOrderShippedMock.mockResolvedValue({ ok: true, order: withCarrier, buyerEmailed: false });
    renderDetail(withCarrier);
    await user.click(screen.getByRole("button", { name: "Change tracking number" }));
    expect(screen.getByRole("combobox", { name: "Carrier (optional)" })).toHaveTextContent("DHL");
    await user.click(screen.getByRole("button", { name: "Save tracking number" }));
    expect(markOrderShippedMock).toHaveBeenCalledWith(sent.id, "RR123456789IE", "dhl");
  });

  it("lets the tracking number be changed, prefilled with the current one", async () => {
    const user = userEvent.setup();
    markOrderShippedMock.mockResolvedValue({ ok: true, order: sent, buyerEmailed: true });
    renderDetail(sent);
    await user.click(screen.getByRole("button", { name: "Change tracking number" }));
    const field = screen.getByLabelText("Tracking number (optional)");
    expect(field).toHaveValue("RR123456789IE");
    await user.clear(field);
    await user.type(field, "RR000000001IE");
    await user.click(screen.getByRole("button", { name: "Save tracking number" }));
    expect(markOrderShippedMock).toHaveBeenCalledWith(sent.id, "RR000000001IE", null);
    expect(
      await screen.findByText("Tracking number saved. We've sent it to the buyer."),
    ).toBeInTheDocument();
  });

  it("offers adding one when it shipped without", () => {
    renderDetail({ ...sent, fulfilment: { ...sent.fulfilment, trackingNumber: null } });
    const shipping = screen.getByText("Shipping").parentElement!;
    expect(within(shipping).getByRole("button", { name: "Add tracking number" })).toBeInTheDocument();
  });
});

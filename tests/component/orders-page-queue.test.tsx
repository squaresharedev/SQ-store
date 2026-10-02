import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { act, cleanup, render, screen, within } from "../setup/render";
import { orderView } from "../setup/order-view";
import type { OrderView } from "@/types/order-view";

// The Orders page as a seller clearing a queue uses it: the list they chose
// stays the list they chose, and each parcel leads to the next without a trip
// back to the table.

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/orders",
  useSearchParams: () => new URLSearchParams(),
}));

const markOrderShippedMock = vi.fn();
vi.mock("@/lib/orders/actions", () => ({
  markOrderShipped: (...args: unknown[]) => markOrderShippedMock(...args),
}));

import { OrdersPage } from "@/components/orders/OrdersPage";
import { OrdersEmptyState } from "@/components/orders/OrdersEmptyState";

afterEach(cleanup);

const toShip = (id: string, title: string): OrderView =>
  orderView({
    id,
    productTitle: title,
    shipTo: { name: "Aoife Byrne", line1: "12 Harbour Road", city: "Dublin", country: "IE" },
    fulfilment: { status: "unfulfilled", shippedAt: null, trackingNumber: null, carrier: null },
  });

const FIRST = toShip("aaaaaaaa-1111-4111-8111-111111111111", "Blue mug");
const SECOND = toShip("bbbbbbbb-2222-4222-8222-222222222222", "Red plate");

const sentVersion = (order: OrderView): OrderView => ({
  ...order,
  fulfilment: { status: "shipped", shippedAt: "2026-09-27T10:00:00Z", trackingNumber: null, carrier: null },
});

function renderPage(rows: OrderView[], view: "to-ship" | "all" = "to-ship") {
  return render(
    <OrdersPage
      view={view}
      toShipCount={rows.length}
      canFulfil
      data={{ rows, total: rows.length, page: 1, pageSize: 25 }}
      filters={{}}
      sort={{ field: "createdAt", direction: "desc" }}
    />,
  );
}

const playOut = (ms = 5000) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  vi.clearAllMocks();
  markOrderShippedMock.mockReset();
  window.history.replaceState(null, "", "/orders");
});

describe("the list you were on", () => {
  it("is named in the address once you have arrived, so a refresh stays put", () => {
    renderPage([FIRST]);
    expect(new URL(window.location.href).searchParams.get("view")).toBe("to-ship");
  });

  it("keeps what else was in the address", () => {
    window.history.replaceState(null, "", "/orders?order=abc");
    renderPage([FIRST]);
    const params = new URL(window.location.href).searchParams;
    expect(params.get("view")).toBe("to-ship");
    expect(params.get("order")).toBe("abc");
  });

  it("leaves a view the address already names alone", () => {
    window.history.replaceState(null, "", "/orders?view=all");
    renderPage([FIRST], "to-ship");
    expect(new URL(window.location.href).searchParams.get("view")).toBe("all");
  });
});

describe("working through To ship", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function shipFirst(user: ReturnType<typeof userEvent.setup>) {
    markOrderShippedMock.mockResolvedValue({ ok: true, order: sentVersion(FIRST), buyerEmailed: true });
    await user.click(screen.getByText("Blue mug"));
    const panel = screen.getByRole("dialog");
    await user.click(within(panel).getByRole("button", { name: "Mark as shipped" }));
    await user.click(within(panel).getByRole("button", { name: "Mark shipped" }));
    await playOut();
    return panel;
  }

  it("leads from one parcel to the next, and the next starts fresh", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPage([FIRST, SECOND]);
    const panel = await shipFirst(user);

    await user.click(within(panel).getByRole("button", { name: "Next order to ship" }));
    // The panel now shows the second order, unshipped, with its own button.
    expect(within(screen.getByRole("dialog")).getByText("1 × Red plate")).toBeInTheDocument();
    expect(document.querySelector("[data-order-number]")).toHaveTextContent("Order BBBBBBBB");
    expect(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Mark as shipped" }),
    ).toBeInTheDocument();
    // And the form state did not come over from the first.
    expect(screen.queryByLabelText("Tracking number (optional)")).toBeNull();
  });

  it("says they are done when that was the last parcel", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPage([FIRST]);
    const panel = await shipFirst(user);
    expect(within(panel).getByText(/all caught up/)).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Next order to ship" })).toBeNull();
  });

  it("does not offer a queue from the full list", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPage([FIRST, SECOND], "all");
    markOrderShippedMock.mockResolvedValue({ ok: true, order: sentVersion(FIRST), buyerEmailed: true });
    await user.click(screen.getByText("Blue mug"));
    const panel = screen.getByRole("dialog");
    await user.click(within(panel).getByRole("button", { name: "Mark as shipped" }));
    await user.click(within(panel).getByRole("button", { name: "Mark shipped" }));
    await playOut();
    expect(within(panel).queryByRole("button", { name: "Next order to ship" })).toBeNull();
    expect(within(panel).queryByText(/all caught up/)).toBeNull();
  });
});

describe("an empty list", () => {
  it("does not say checkout is closed once it is open", () => {
    const { rerender } = render(<OrdersEmptyState filtered={false} />);
    expect(screen.getByText(/checkout isn't open yet/)).toBeInTheDocument();
    rerender(<OrdersEmptyState filtered={false} checkoutOpen />);
    expect(screen.queryByText(/checkout isn't open yet/)).toBeNull();
    expect(screen.getByText(/When someone buys from your store/)).toBeInTheDocument();
  });
});

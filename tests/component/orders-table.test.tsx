import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OrdersTable } from "@/components/orders/OrdersTable";
import type { OrderView } from "@/types/order-view";

// Arriving from universal search MARKS a row, it does not open one. These
// guard the difference: the highlight is announced, it is reachable without
// hunting for it, and it never selects the order on the user's behalf.

afterEach(cleanup);

// jsdom implements neither, and the highlighted row uses both.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    })),
  });
});

function order(overrides: Partial<OrderView> = {}): OrderView {
  return {
    id: "aaaaaaaa-1111-4111-8111-111111111111",
    productTitle: "Lamp",
    amountCents: 2500,
    platformFeeCents: 250,
    currency: "EUR",
    channel: "embed",
    status: "paid",
    buyerEmail: "buyer@example.com",
    createdAt: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

const ROWS = [
  order({ id: "aaaaaaaa-1111-4111-8111-111111111111", productTitle: "Lamp" }),
  order({ id: "bbbbbbbb-2222-4222-8222-222222222222", productTitle: "Chair" }),
];

const rowFor = (title: string) =>
  screen.getByText(title).closest("tr") as HTMLTableRowElement;

describe("OrdersTable — the highlighted row", () => {
  it("marks only the named row, and announces it as the current one", () => {
    render(
      <OrdersTable
        orders={ROWS}
        onSelect={vi.fn()}
        highlightId="bbbbbbbb-2222-4222-8222-222222222222"
      />,
    );
    expect(rowFor("Chair")).toHaveAttribute("aria-current", "true");
    expect(rowFor("Lamp")).not.toHaveAttribute("aria-current");
  });

  it("does NOT open the order — the panel is the user's next move", () => {
    const onSelect = vi.fn();
    render(
      <OrdersTable
        orders={ROWS}
        onSelect={onSelect}
        highlightId="bbbbbbbb-2222-4222-8222-222222222222"
      />,
    );
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("scrolls to the row and focuses it, so one Enter opens it", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <OrdersTable
        orders={ROWS}
        onSelect={onSelect}
        highlightId="bbbbbbbb-2222-4222-8222-222222222222"
      />,
    );
    await waitFor(() => expect(rowFor("Chair")).toHaveFocus());
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();

    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].productTitle).toBe("Chair");
  });

  it("marks nothing when the id is not on this page of rows", () => {
    render(
      <OrdersTable orders={ROWS} onSelect={vi.fn()} highlightId="not-here" />,
    );
    expect(document.querySelector("[aria-current]")).toBeNull();
  });

  it("marks nothing without a highlight, and still opens on click", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<OrdersTable orders={ROWS} onSelect={onSelect} />);
    expect(document.querySelector("[aria-current]")).toBeNull();

    await user.click(rowFor("Lamp"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

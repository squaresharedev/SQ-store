import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { RecentOrders } from "@/components/dashboard/RecentOrders";
import type { DashboardOrder } from "@/lib/dashboard/queries";

// The card's whole job beyond display: every row is a link into the order it
// names. A row that renders but goes nowhere is the bug this guards.

afterEach(cleanup);

function order(overrides: Partial<DashboardOrder> = {}): DashboardOrder {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    product_title: "Lamp",
    channel: "embed",
    status: "paid",
    amount_cents: 2500,
    currency: "EUR",
    created_at: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

describe("RecentOrders", () => {
  it("renders the empty state with no rows", () => {
    render(<RecentOrders orders={[]} />);
    expect(screen.getByText(/No orders yet/i)).toBeInTheDocument();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("links every row to that order's detail on /orders", () => {
    const orders = [
      order({ id: "aaaaaaaa-1111-4111-8111-111111111111", product_title: "Lamp" }),
      order({
        id: "bbbbbbbb-2222-4222-8222-222222222222",
        product_title: "Chair",
        status: "refunded",
      }),
    ];
    render(<RecentOrders orders={orders} />);

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute(
      "href",
      "/orders?order=aaaaaaaa-1111-4111-8111-111111111111",
    );
    expect(links[1]).toHaveAttribute(
      "href",
      "/orders?order=bbbbbbbb-2222-4222-8222-222222222222",
    );
  });

  it("keeps the whole row inside the link (title, meta, status, amount)", () => {
    render(<RecentOrders orders={[order({ product_title: "Lamp" })]} />);
    const link = screen.getByRole("link");
    expect(link).toHaveTextContent("Lamp");
    expect(link).toHaveTextContent("Embed");
    expect(link).toHaveTextContent("Paid");
    expect(link).toHaveTextContent("25");
  });

  it("falls back to the orders list when a row has no id", () => {
    // Defensive: an older cached RPC payload predates the id. Better the list
    // than a link to nowhere.
    const legacy = { ...order() } as Partial<DashboardOrder>;
    delete legacy.id;
    render(<RecentOrders orders={[legacy as DashboardOrder]} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/orders");
  });
});

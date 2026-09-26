import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "../setup/render";
import { RecentOrders } from "@/components/dashboard/RecentOrders";
import type { DashboardOrder } from "@/lib/dashboard/queries";
import type { OrderView } from "@/types/order-view";

// The card's whole job beyond display: every row is a link into the order it
// names, and a plain click opens that order right here. A row that renders but
// goes nowhere is the bug this guards.

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

  describe("opening in place", () => {
    const LAMP_ID = "aaaaaaaa-1111-4111-8111-111111111111";

    function detail(overrides: Partial<OrderView> = {}): OrderView {
      return {
        id: LAMP_ID,
        productTitle: "Lamp",
        selection: [],
        amountCents: 2500,
        platformFeeCents: 125,
        currency: "EUR",
        channel: "embed",
        status: "paid",
        buyerEmail: "buyer@example.com",
        createdAt: "2026-08-01T10:00:00.000Z",
        ...overrides,
      };
    }

    it("a plain click opens the order's detail panel without leaving the page", () => {
      render(
        <RecentOrders orders={[order({ id: LAMP_ID })]} details={[detail()]} />,
      );
      const link = screen.getByRole("link", { name: /Lamp/ });
      expect(link).toHaveAttribute("aria-haspopup", "dialog");

      // fireEvent returns false when the default (the navigation) was prevented.
      expect(fireEvent.click(link)).toBe(false);

      const dialog = screen.getByRole("dialog", { name: /order details/i });
      expect(dialog).toHaveTextContent("buyer@example.com");
      expect(dialog).toHaveTextContent(LAMP_ID);
    });

    it("Escape closes the panel and hands focus back to the row", () => {
      render(
        <RecentOrders orders={[order({ id: LAMP_ID })]} details={[detail()]} />,
      );
      const link = screen.getByRole("link", { name: /Lamp/ });
      link.focus();
      fireEvent.click(link);
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(link).toHaveFocus();
    });

    it("leaves modified clicks to the browser (new tab, new window)", () => {
      render(
        <RecentOrders orders={[order({ id: LAMP_ID })]} details={[detail()]} />,
      );
      const link = screen.getByRole("link", { name: /Lamp/ });
      fireEvent.click(link, { ctrlKey: true });
      fireEvent.click(link, { metaKey: true });
      fireEvent.click(link, { shiftKey: true });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("a row whose detail did not load still follows its link", () => {
      render(
        <RecentOrders
          orders={[
            order({ id: LAMP_ID }),
            order({ id: "bbbbbbbb-2222-4222-8222-222222222222", product_title: "Chair" }),
          ]}
          details={[detail()]}
        />,
      );
      const chair = screen.getByRole("link", { name: /Chair/ });
      expect(chair).not.toHaveAttribute("aria-haspopup");
      expect(fireEvent.click(chair)).toBe(true);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});

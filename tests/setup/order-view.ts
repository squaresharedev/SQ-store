import type { OrderListRow } from "@/types/order-view";

/**
 * One order as the dashboard sees it, for component tests. Defaults to the
 * dullest possible order (paid, already shipped, one unit, no version, no
 * address, no photo) so each test states only the part it is about. A list
 * row, so the same fixture fits the Orders table and the detail panel alike.
 */
export function orderView(overrides: Partial<OrderListRow> = {}): OrderListRow {
  return {
    photoUrl: null,
    id: "aaaaaaaa-1111-4111-8111-111111111111",
    productTitle: "Lamp",
    selection: [],
    quantity: 1,
    shipTo: null,
    fulfilment: {
      status: "shipped",
      shippedAt: "2026-08-02T10:00:00.000Z",
      trackingNumber: null,
      carrier: null,
    },
    amountCents: 2500,
    platformFeeCents: 250,
    platformFeeBps: null,
    currency: "EUR",
    channel: "embed",
    status: "paid",
    buyerEmail: "buyer@example.com",
    createdAt: "2026-08-01T10:00:00.000Z",
    giftMessage: null,
    withdrawalRequestedAt: null,
    discount: null,
    refund: null,
    stockReserved: 0,
    paidThroughProvider: false,
    ...overrides,
  };
}

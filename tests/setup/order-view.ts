import type { OrderView } from "@/types/order-view";

/**
 * One order as the dashboard sees it, for component tests. Defaults to the
 * dullest possible order (paid, already shipped, one unit, no version, no
 * address) so each test states only the part it is about.
 */
export function orderView(overrides: Partial<OrderView> = {}): OrderView {
  return {
    id: "aaaaaaaa-1111-4111-8111-111111111111",
    productTitle: "Lamp",
    selection: [],
    quantity: 1,
    shipTo: null,
    fulfilment: {
      status: "shipped",
      shippedAt: "2026-08-02T10:00:00.000Z",
      trackingNumber: null,
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
    ...overrides,
  };
}

import { BRAND_NAME } from "@/lib/brand";
import { centsToDecimal, toCsv, type CsvValue } from "@/lib/format/csv";
import { formatOrderSelection } from "@/lib/orders/selection";
import { orderNumber } from "@/lib/orders/order-number";
import type { OrderView } from "@/types/order-view";

/**
 * THE ORDERS EXPORT: a store's sales as a CSV, for its bookkeeping. A paid
 * plan perk (PLANS[plan].perks.ordersExport), served by
 * app/api/orders/export/route.ts. Pure, so the file's shape is unit-tested.
 *
 * A LEDGER, NOT A MAILING LIST. It carries what an accountant needs (when,
 * what, how much, the fee, what the seller keeps, the buyer's COUNTRY for VAT)
 * and deliberately not the buyer's email, name or street address. Those stay
 * in the dashboard, where they are shown one order at a time; a file sitting
 * in a downloads folder is the wrong place for a whole customer list.
 *
 * The header row is a data contract (snake_case, English, never translated),
 * so a spreadsheet or script built on one export still reads the next. Add
 * columns at the end; never rename or reorder one.
 */

/** The most orders one export carries, newest first. Bounds the Worker's time
 *  and memory; a store past this is told the file is the newest slice. */
export const ORDERS_EXPORT_MAX_ROWS = 10_000;

/** Response header set when the store had more orders than the file holds. */
export const ORDERS_EXPORT_TRUNCATED_HEADER = "X-Orders-Export-Truncated";

/** One order as the export reads it: the seller's view plus its shipping. */
export type OrderExportRow = OrderView & {
  /** What the buyer paid for delivery, inside amountCents. Null on orders
   *  written before shipping was recorded separately. */
  shippingCents: number | null;
};

/** The columns, in file order. See the note above before changing any. */
export const ORDERS_CSV_COLUMNS = [
  "order_number",
  "placed_at",
  "status",
  "fulfilment",
  "channel",
  "product",
  "options",
  "quantity",
  "currency",
  "amount",
  "shipping",
  "platform_fee",
  "platform_fee_rate_percent",
  "after_platform_fee",
  "buyer_country",
  "shipped_at",
  "tracking_number",
  "tracking_carrier",
] as const;

/** One order's cells, in ORDERS_CSV_COLUMNS order. */
function orderCells(order: OrderExportRow): CsvValue[] {
  return [
    orderNumber(order.id),
    order.createdAt,
    order.status,
    order.fulfilment.status,
    order.channel,
    order.productTitle,
    formatOrderSelection(order.selection),
    order.quantity,
    order.currency,
    centsToDecimal(order.amountCents),
    order.shippingCents === null ? null : centsToDecimal(order.shippingCents),
    centsToDecimal(order.platformFeeCents),
    // Basis points are hundredths of a percent, as cents are of a euro.
    order.platformFeeBps === null ? null : centsToDecimal(order.platformFeeBps),
    centsToDecimal(order.amountCents - order.platformFeeCents),
    order.shipTo?.country ?? null,
    order.fulfilment.shippedAt,
    order.fulfilment.trackingNumber,
    order.fulfilment.carrier,
  ];
}

/** The whole file for `orders` (already scoped to one store and sorted). */
export function ordersCsv(orders: readonly OrderExportRow[]): string {
  return toCsv(ORDERS_CSV_COLUMNS, orders.map(orderCells));
}

/** "square-share-orders-2026-09-30.csv", dated in UTC like the data export. */
export function ordersCsvFileName(now: Date): string {
  const brand = BRAND_NAME.toLowerCase().replace(/\s+/g, "-");
  return `${brand}-orders-${now.toISOString().slice(0, 10)}.csv`;
}

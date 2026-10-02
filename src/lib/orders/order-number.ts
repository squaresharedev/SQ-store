/**
 * THE SHORT ORDER NUMBER: the first eight characters of the order id,
 * upper-cased. The buyer reads it off their order page and their confirmation
 * ("Order 44561113"), and it is what they quote when they write to the seller.
 * Client-safe (no crypto), because the seller's panel and search need it too:
 * a number the buyer can quote and the seller cannot look up is a support
 * request that starts with "which order?".
 *
 * For RECOGNISING an order, never for opening one: an order page is opened by
 * its credential (lib/orders/order-link.ts), which this is not.
 */

export function orderNumber(orderId: string): string {
  return orderId.replace(/-/g, "").slice(0, 8).toUpperCase();
}

/** The number as a short label for a result row: "#44561113". */
export function orderNumberLabel(orderId: string): string {
  return `#${orderNumber(orderId)}`;
}

/** The fewest characters worth treating a search term as an order number.
 *  Below this a hex-looking word ("bad", "add") is far more likely a word. */
const NUMBER_PREFIX_MIN = 4;

/** What a person types when they mean an order number: "44561113", "#44561113"
 *  or the start of one. Hex digits only, four or more. */
const NUMBER_QUERY = /^#?\s*([0-9a-f]{4,8})$/i;

/**
 * The lower-cased hex prefix a search term stands for, or null when the term is
 * not shaped like an order number (or the start of one).
 */
export function parseOrderNumberQuery(raw: string): string | null {
  const match = NUMBER_QUERY.exec(raw.trim());
  return match && match[1]!.length >= NUMBER_PREFIX_MIN ? match[1]!.toLowerCase() : null;
}

/**
 * The uuid range that holds every order whose number starts with `prefix`.
 * The number is the FIRST group of the id, so a prefix is a contiguous range
 * of uuids and needs no computed column or index: two comparisons on `id`.
 */
export function orderNumberRange(prefix: string): { from: string; to: string } {
  return {
    from: `${prefix.padEnd(8, "0")}-0000-0000-0000-000000000000`,
    to: `${prefix.padEnd(8, "f")}-ffff-ffff-ffff-ffffffffffff`,
  };
}

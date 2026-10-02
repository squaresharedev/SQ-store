import { parseOrderNumberQuery } from "@/lib/orders/order-number";

/**
 * Which half of the palette leads: the local registry (pages, settings,
 * actions) or the account's own things (products, orders, stores, people).
 *
 * The registry leads by default, because most queries are a place to go
 * ("settings", "refund"). But some queries cannot be a place at all: an email
 * address or an order number is always somebody's thing, and a seller who pastes
 * the one from a buyer's message wants that order first, not under three
 * settings pages that happened to fuzzy-match a few characters of it.
 *
 * Pure, so the palette can call it inside the render that the keystroke caused.
 */
export function entitiesLead(query: string): boolean {
  const term = query.trim();
  if (!term) return false;
  return /\S@\S/.test(term) || parseOrderNumberQuery(term) !== null;
}

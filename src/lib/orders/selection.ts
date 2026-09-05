import {
  ORDER_SELECTION_LABEL_MAX,
  ORDER_SELECTION_MAX,
  ORDER_SELECTION_VALUE_MAX,
  type OrderSelection,
} from "@/types/order-view";

/**
 * Reading and printing what the buyer picked.
 *
 * Client-safe (types and strings, nothing else), because the same two answers
 * are needed on both sides: the query maps the stored jsonb into the view, and
 * the row and the detail panel print it.
 */

/**
 * The stored `orders.selected_options` blob as a list this app will show.
 *
 * DEGRADES, never throws, on the same reasoning as the product page's own
 * parsers: a malformed blob costs the order its version line, never the order.
 * Orders are written by the service role (a seed today, a checkout webhook
 * tomorrow), so this column is not behind a Zod write boundary the way the
 * product columns are, and the read is the only place that can insist on the
 * shape. Everything is trimmed, capped and truncated here, so what a seller
 * renders is bounded by this file rather than by whatever reached the column.
 */
export function parseOrderSelection(raw: unknown): OrderSelection[] {
  if (!Array.isArray(raw)) return [];
  const parsed: OrderSelection[] = [];
  for (const entry of raw) {
    if (parsed.length >= ORDER_SELECTION_MAX) break;
    if (!entry || typeof entry !== "object") continue;
    const { label, value } = entry as { label?: unknown; value?: unknown };
    if (typeof label !== "string" || typeof value !== "string") continue;
    const trimmedLabel = label.trim().slice(0, ORDER_SELECTION_LABEL_MAX);
    const trimmedValue = value.trim().slice(0, ORDER_SELECTION_VALUE_MAX);
    // A pair missing either half says nothing a seller can pack from.
    if (!trimmedLabel || !trimmedValue) continue;
    parsed.push({ label: trimmedLabel, value: trimmedValue });
  }
  return parsed;
}

/** "Size: Six seater · Colour: Natural oak" — one line, for a table row or a
 *  message. The separator matches the one the dashboard's other summaries use. */
export function formatOrderSelection(selection: readonly OrderSelection[]): string {
  return selection.map((entry) => `${entry.label}: ${entry.value}`).join(" · ");
}

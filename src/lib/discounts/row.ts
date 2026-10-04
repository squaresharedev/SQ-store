import { CURRENCIES, type Currency } from "@/types/product";
import { DISCOUNT_KINDS, DISCOUNT_SCOPES, type DiscountValue, type DiscountView } from "@/types/discount";
import { isDiscountCode } from "@/lib/discounts/code";

/**
 * Reading a `discounts` row. Shared by the seller's reads (queries.ts) and the
 * checkout's (public.ts), so both understand a row the same way.
 *
 * DEGRADES, never throws: the CHECKs already keep rows in shape, and a row
 * that somehow is not reads as null (it applies nowhere and lists as nothing)
 * rather than taking a page down.
 */

/** The columns every read selects. */
export const DISCOUNT_COLUMNS =
  "id, kind, code, share_channel, value_type, percent_off, amount_off_cents, currency, applies_to, product_ids, starts_at, ends_at, usage_limit, enabled, archived_at, created_at" as const;

export type DiscountRow = {
  id: string;
  kind: string;
  code: string | null;
  share_channel: string | null;
  value_type: string;
  percent_off: number | null;
  amount_off_cents: number | null;
  currency: string | null;
  applies_to: string;
  product_ids: string[] | null;
  starts_at: string;
  ends_at: string | null;
  usage_limit: number | null;
  enabled: boolean;
  archived_at: string | null;
  created_at: string;
};

/** What the row takes off, or null when its value columns do not make one. */
export function discountValueOf(row: Pick<DiscountRow, "value_type" | "percent_off" | "amount_off_cents" | "currency">): DiscountValue | null {
  if (row.value_type === "percent" && typeof row.percent_off === "number") {
    return { type: "percent", percentOff: row.percent_off };
  }
  const currency = CURRENCIES.find((code) => code === row.currency);
  if (row.value_type === "amount" && typeof row.amount_off_cents === "number" && currency) {
    return { type: "amount", amountOffCents: row.amount_off_cents, currency };
  }
  return null;
}

/** Whether the row covers `productId`. */
export function coversProduct(row: Pick<DiscountRow, "applies_to" | "product_ids">, productId: string): boolean {
  return row.applies_to === "all" || (row.product_ids ?? []).includes(productId);
}

/** Whether a value can be applied to a product priced in `currency`. */
export function appliesInCurrency(value: DiscountValue, currency: Currency): boolean {
  return value.type === "percent" || value.currency === currency;
}

/** The seller's view of a row, or null for a row that does not parse. */
export function toDiscountView(row: DiscountRow): DiscountView | null {
  const kind = DISCOUNT_KINDS.find((known) => known === row.kind);
  const value = discountValueOf(row);
  const appliesTo = DISCOUNT_SCOPES.find((scope) => scope === row.applies_to);
  if (!kind || !value || !appliesTo) return null;
  const isCode = kind === "code";
  if (isCode && !(row.code && isDiscountCode(row.code))) return null;
  return {
    id: row.id,
    kind,
    code: isCode ? row.code : null,
    shareChannel: isCode ? row.share_channel : null,
    value,
    appliesTo,
    productIds: appliesTo === "products" ? (row.product_ids ?? []) : [],
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    usageLimit: isCode ? row.usage_limit : null,
    enabled: row.enabled,
    createdAt: row.created_at,
  };
}

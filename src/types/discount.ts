import type { Currency } from "@/types/product";

// The discount contract: what a sale or a code is, the bounds it lives in, and
// the shapes the dashboard and the checkout pass around. Types and bounds only,
// client-safe, no message keys (copy lives in the components that print it).
//
// Every bound here is MIRRORED by a CHECK in 20261004_discounts.sql. Edit both.

/** 'automatic': a sale every buyer gets. 'code': a buyer types it at checkout. */
export const DISCOUNT_KINDS = ["automatic", "code"] as const;
export type DiscountKind = (typeof DISCOUNT_KINDS)[number];

/** Which products a discount covers. */
export const DISCOUNT_SCOPES = ["all", "products"] as const;
export type DiscountScope = (typeof DISCOUNT_SCOPES)[number];

/** Percent off: whole percents. 90 is the ceiling on purpose, so a "100" typed
 *  for "10" cannot give the shop away. */
export const DISCOUNT_PERCENT_MIN = 1;
export const DISCOUNT_PERCENT_MAX = 90;
/** Amount off, in cents: the same ceiling as a product's price (PRICE_CENTS_MAX). */
export const DISCOUNT_AMOUNT_MAX_CENTS = 100_000_000;
/** A code is 3 to 24 characters (see lib/discounts/code.ts for the shape). */
export const DISCOUNT_CODE_MIN = 3;
export const DISCOUNT_CODE_MAX = 24;
/** Where a code was shared ("Instagram"): the seller's own words. */
export const SHARE_CHANNEL_MAX = 40;
/** Products one discount can name: the largest plan's product count. */
export const DISCOUNT_PRODUCTS_MAX = 500;
/** The most orders a code can be limited to. */
export const DISCOUNT_USAGE_LIMIT_MAX = 1_000_000;
/** Discounts a store can have that are not deleted. The checkout reads a
 *  store's sales on every product page, so the number stays small. */
export const LIVE_DISCOUNTS_MAX = 100;

/** What a discount takes off. Percent of the price, or a fixed amount in one
 *  currency (it only applies to products priced in that currency). */
export type DiscountValue =
  | { type: "percent"; percentOff: number }
  | { type: "amount"; amountOffCents: number; currency: Currency };

/** A store's running sale, as the checkout gate reads it. Server-side: it
 *  carries the id the order is credited to. */
export type ActiveSale = {
  id: string;
  value: DiscountValue;
  startsAt: string;
  endsAt: string | null;
};

/** A running sale together with what it covers: how a store's sales are read
 *  ONCE and then matched to each product (lib/discounts/public.ts
 *  salesCovering). Server-side, like ActiveSale. */
export type StoreSale = ActiveSale & {
  appliesTo: DiscountScope;
  /** When appliesTo is "products". */
  productIds: string[];
};

/** A code the checkout found valid for this order. Server-side (it has the id). */
export type ResolvedCode = {
  id: string;
  code: string;
  value: DiscountValue;
};

/** What a buyer's browser is told about a code it typed: the terms, never an
 *  id, a channel or how often it was used. */
export type CodeTerms = {
  code: string;
  value: DiscountValue;
};

/** Where a discount stands right now, worked out by lib/discounts/status.ts. */
export type DiscountStatus = "scheduled" | "active" | "paused" | "used_up" | "ended";

/** One discount as the seller sees it in the dashboard. */
export type DiscountView = {
  id: string;
  kind: DiscountKind;
  /** Codes only. */
  code: string | null;
  /** Codes only: where it was shared. */
  shareChannel: string | null;
  value: DiscountValue;
  appliesTo: DiscountScope;
  /** When appliesTo is "products". */
  productIds: string[];
  startsAt: string;
  endsAt: string | null;
  /** Codes only. */
  usageLimit: number | null;
  /** Codes only can be switched off; a sale is always on until it ends. */
  enabled: boolean;
  createdAt: string;
};

/** Money in one currency. A store can sell in EUR and USD, so totals that add
 *  up orders are kept per currency rather than summed across them. */
export type MoneyTotal = { currency: string; cents: number };

/** What one discount brought in, from its orders (discount_performance). */
export type DiscountPerformance = {
  discountId: string;
  /** Every order that used it, whatever happened later: what a limit counts. */
  uses: number;
  /** Paid orders. */
  orders: number;
  revenue: MoneyTotal[];
  /** How much less buyers paid than the regular price. */
  given: MoneyTotal[];
  lastOrderAt: string | null;
};

/** A product a discount can be pointed at, for the form's picker. */
export type DiscountProductChoice = {
  id: string;
  title: string;
  priceCents: number;
  currency: Currency;
  /** The cover photo, signed for the dashboard (dashboard-only, short-lived),
   *  or null/absent for a product without one. */
  imageUrl?: string | null;
};

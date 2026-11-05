import type { AddOnCard, ProductPageImage, ProductPageProduct } from "@/types/product";
import type { ProductPageReportScopes, ProductPageStorefront } from "@/types/product-page";
import type { CheckoutPageConfig } from "@/types/storefront";
import type { TrackingLink } from "@/types/order-view";
import type { CodeTerms } from "@/types/discount";

// What the checkout RENDERS. Client-safe types only, like types/product-page.ts:
// the public loader (lib/checkout/page.ts) builds one for a buyer and the
// editor builds one from the seller's live edits, so the view has one
// contract and no server import.

export type CheckoutStorefront = ProductPageStorefront & {
  checkoutPage: CheckoutPageConfig;
};

export type CheckoutPageData = {
  storefront: CheckoutStorefront;
  /** The same buyer-safe product the product page shows, from the same
   *  builder, so the checkout cannot describe it differently. */
  product: ProductPageProduct;
  /** Which of the page's wider report targets apply; absent in the editor. */
  reportScopes?: ProductPageReportScopes;
  /** "Add to your order": the add-ons on offer with this product (the same
   *  cards the product page showed). Which of them are in THIS order rides in
   *  `?a=`. Absent in the editor. */
  addOns?: AddOnCard[];
};

/** Why an order was refused, as the checkout's order route reports it. The
 *  quote's reasons plus the route's own. */
export type CheckoutErrorCode =
  | "not_found"
  | "sold_out"
  | "options"
  | "quantity"
  | "insufficient_stock"
  | "not_shipped_here"
  | "no_shipping_rates"
  | "consent"
  | "invalid"
  | "rate_limited"
  | "unavailable"
  | "failed"
  /** A discount code that does not apply to this order (any reason). */
  | "discount_invalid"
  /** The total changed since the page was opened (a sale ended, a price
   *  moved). Nothing was charged; the buyer sees the new total first. */
  | "price_changed"
  /** Something added to the order can no longer be sold with it (gone, sold
   *  out, or that version is not available). Nothing was charged. */
  | "add_on_unavailable";

/** The discount-code check's answer: the code's terms, or one refusal for
 *  every reason it cannot be used (nothing here says whether a code exists). */
export type DiscountCheckResponse =
  | { ok: true; terms: CodeTerms }
  | { ok: false; error: "discount_invalid" | "rate_limited" | "unavailable" };

/** The order route's answer. `fields` names the inputs to mark, by form name. */
export type PlaceOrderResponse =
  | { ok: true; orderUrl: string }
  | { ok: false; error: CheckoutErrorCode; fields?: string[] };

/** One order, as its buyer sees it on their order page. Built by
 *  lib/orders/order-page.ts field by field: nothing here is a key, an owner
 *  id or a full address. */
export type BuyerOrder = {
  /** The order's credential, for the download and withdrawal routes. */
  ref: string;
  /** The short number a buyer can quote. */
  number: string;
  placedAt: string;
  /** For the footer's report link; null once the product has been deleted. */
  productId: string | null;
  productTitle: string;
  photo: ProductPageImage | null;
  quantity: number;
  selection: { label: string; value: string }[];
  amountCents: number;
  currency: string;
  /** "j***@example.com": enough to recognise, not enough to harvest. */
  maskedEmail: string | null;
  /** The first word of the delivery name, for "Thank you, Aoife!". */
  firstName: string | null;
  /** Town and country only: an order page never prints a street address. */
  destination: { city: string; country: string } | null;
  isDigital: boolean;
  /** "PDF", never a name or key. */
  digitalFormat: string | null;
  fulfilment: "unfulfilled" | "shipped" | "not_required";
  shippedAt: string | null;
  trackingNumber: string | null;
  /** Where the parcel is followed, when the seller named its carrier: the
   *  carrier's name and its own page for this parcel (lib/orders/carriers.ts). */
  trackingLink: TrackingLink | null;
  /** The seller's own dispatch line for this product, if any. */
  dispatch: string | null;
  withdrawal: BuyerWithdrawal;
  /** Where the MONEY stands, as a buyer needs to know it: still being
   *  confirmed, paid, or given back. (A dispute is between the buyer and their
   *  bank and reads as paid.) */
  payment: "pending" | "paid" | "refunded";
  /** When the seller refunded the order, if they have. */
  refundedAt: string | null;
  /** Whether the confirmation email was actually sent. The page says "on its
   *  way to j***@..." only then. */
  confirmationSent: boolean;
  /** Whether the buyer can review the product (lib/reviews/eligibility.ts),
   *  already has, or cannot. The editor's sample order is always "open". */
  review?: "open" | "done" | "closed";
  /** The stars this order's review gave, once it has one. */
  reviewRating?: number;
  /** The one review reminder email the buyer can ask for
   *  (lib/reviews/reminders.ts): not asked for, asked for, or sent, and when
   *  it falls due once that is known (null while the parcel has not been
   *  sent). Absent where none can be offered: mail or the scheduler is off,
   *  the order has no email address, it cannot be reviewed, or it is too late. */
  reviewReminder?: { status: "off" | "on" | "sent"; dueAt: string | null };
  /** "Add to your order": what else this order bought, in the seller's
   *  order. Absent or empty for most orders. */
  addOns?: BuyerOrderAddOn[];
};

/** One add-on line on a buyer's order page. */
export type BuyerOrderAddOn = {
  /** The line's own id: what the download route's `?item=` names. Not a
   *  credential on its own; the order's ref is. */
  id: string;
  productTitle: string;
  photo: ProductPageImage | null;
  quantity: number;
  selection: { label: string; value: string }[];
  /** "PDF" for a download line, never a name or key; null for a parcel. */
  digitalFormat: string | null;
};

export type OrderPageData = {
  /** `detached`: the seller has deleted the storefront this was bought
   *  from. The order page still answers, in the default design, with no
   *  link back to a shop that is gone. */
  storefront: CheckoutStorefront & { detached?: boolean };
  order: BuyerOrder;
};

/** Whether, and until when, a buyer may withdraw from an order (CRD art. 11a
 *  and 9). Worked out by lib/orders/withdrawal.ts. */
export type BuyerWithdrawal = {
  /** When the buyer withdrew, if they have. */
  requestedAt: string | null;
  /** Whether the withdrawal function is offered right now. */
  available: boolean;
  /** The last moment it is offered, once that is known (the parcel has been
   *  sent, or it is a download); null while the clock has not started. */
  until: string | null;
  /** The withdrawal period in days, for "until N days after it arrives". */
  days: number;
};

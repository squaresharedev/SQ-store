import { z } from "zod";
import {
  discountCode,
  emailAddress,
  multiLineText,
  singleLineText,
  uuidField,
} from "@/lib/validation/inputs";
import { issueKey } from "@/lib/validation/messages";
import { PURCHASE_QUANTITY_MAX } from "@/lib/validation/product";
import { isCourierPhone } from "@/lib/orders/ship-to";
import { ADD_ONS_MAX, OPTIONS_TOTAL_MAX } from "@/types/product";
import { SHIP_TO_MAX } from "@/types/order-view";
import { GIFT_MESSAGE_MAX } from "@/types/storefront";
import { SHIPPING_COUNTRY_CODES } from "@/lib/settings/constants";
import { LINK_CHANNELS } from "@/lib/storefront/product-page-url";
import { LOCALES } from "@/i18n/locales";
import { CART_LINES_MAX, CART_OPTIONS_PER_LINE } from "@/lib/cart/limits";
import { ORDER_LINE_SOURCES } from "@/lib/checkout/lines";

// What the hosted checkout's order route accepts. The SERVER boundary for the
// one public write that starts a payment: strict objects throughout (an
// unexpected key is a refusal, not something ignored), every field from the
// input primitives, every bound matching the column it ends up in.
//
// Note what is NOT here: a price, a currency, a seller. The route looks all of
// those up (lib/checkout/quote.ts). The one money figure a body may carry is
// `expectedTotalCents`, the total the buyer was SHOWN, and it can only refuse
// an order (when it differs from the quote), never set what is charged.

export const shipToSchema = z.strictObject({
  name: singleLineText({ field: "buyerName", max: SHIP_TO_MAX.name }),
  line1: singleLineText({ field: "addressLine1", max: SHIP_TO_MAX.line1 }),
  line2: singleLineText({ field: "addressLine2", max: SHIP_TO_MAX.line2 }).optional(),
  city: singleLineText({ field: "city", max: SHIP_TO_MAX.city }),
  region: singleLineText({ field: "region", max: SHIP_TO_MAX.region }).optional(),
  postalCode: singleLineText({ field: "postalCode", max: SHIP_TO_MAX.postalCode }).optional(),
  // A country checkout can deliver to at all: the platform's shipping list,
  // which every seller's delivery rows are drawn from. Whether THIS seller
  // delivers there is the quote's question (quoteShipping), not this one's.
  country: z.enum(SHIPPING_COUNTRY_CODES),
  // For the courier, and only if the buyer chose to give one. A number, not
  // free text: it is shown to the seller and copied into a carrier's form.
  phone: singleLineText({ field: "phone", max: SHIP_TO_MAX.phone })
    .refine(isCourierPhone, { error: issueKey("Validation.text.phone.unsupported") })
    .optional(),
});

/** What every order body carries, whatever is being bought. */
const orderBuyerFields = {
  /** Minted when the checkout rendered; keys the payment (see provider.ts). */
  attemptId: uuidField("checkoutAttempt"),
  email: emailAddress("buyer"),
  /** The buyer's language, for their mail. */
  locale: z.enum(LOCALES),
  shipTo: shipToSchema.optional(),
  giftMessage: multiLineText({ field: "giftMessage", max: GIFT_MESSAGE_MAX, min: 1 }).optional(),
  supplyConsent: z.boolean().optional(),
  /** How the buyer arrived (`?via=`), for the order's channel. Attribution
   *  only: the quote never reads it, so it cannot touch the price or the fee. */
  channel: z.enum(LINK_CHANNELS).optional(),
  /** A code the buyer applied, normalised. Looked up by the quote. */
  discountCode: discountCode("code").optional(),
  /** The total on the Pay button. Optional so a tab opened before this field
   *  existed still pays; when sent, a different quote refuses the order. */
  expectedTotalCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
};

/** "Buy now": one product, its version and quantity, and what was taken from
 *  its "Add to your order". */
export const placeOrderSchema = z.strictObject({
  ...orderBuyerFields,
  optionIds: z.array(uuidField("option")).max(OPTIONS_TOTAL_MAX),
  quantity: z.number().int().min(1).max(PURCHASE_QUANTITY_MAX),
  /** "Add to your order": other products taken with this one, each with its
   *  version. Only ids: the quote prices them. */
  addOns: z
    .array(
      z.strictObject({
        productId: uuidField("product"),
        optionIds: z.array(uuidField("option")).max(OPTIONS_TOTAL_MAX),
      }),
    )
    .max(ADD_ONS_MAX)
    .optional(),
});

/** One line of a cart's order, exactly as the checkout showed it. */
export const orderLineSchema = z.strictObject({
  productId: uuidField("product"),
  optionIds: z.array(uuidField("option")).max(CART_OPTIONS_PER_LINE),
  quantity: z.number().int().min(1).max(PURCHASE_QUANTITY_MAX),
  source: z.enum(ORDER_LINE_SOURCES),
});

/** A cart's order: the lines the checkout showed (re-priced by the quote,
 *  never taken as they are), and the cart they came from, which payment
 *  closes. */
export const placeCartOrderSchema = z.strictObject({
  ...orderBuyerFields,
  cartId: uuidField("cart"),
  lines: z.array(orderLineSchema).min(1).max(CART_LINES_MAX),
});

/** The checkout's "Apply" for a discount code: the code, and the order's
 *  other products, so the answer can say which of them it covers. */
export const discountCheckSchema = z.strictObject({
  code: discountCode("code"),
  productIds: z.array(uuidField("product")).max(CART_LINES_MAX).optional(),
});

export type PlaceOrderInput = z.infer<typeof placeOrderSchema>;
export type PlaceCartOrderInput = z.infer<typeof placeCartOrderSchema>;

/** An order's credential or short number, as typed or carried by a page. The
 *  route proves it (lib/orders/order-link.ts); this only bounds it. */
export const orderReference = singleLineText({ field: "orderReference", max: 100 });

/** The withdrawal function's form (CRD art. 11a): who, which order, and the
 *  email it was placed with. */
export const withdrawSchema = z.strictObject({
  orderRef: orderReference,
  name: singleLineText({ field: "buyerName", max: SHIP_TO_MAX.name }),
  email: emailAddress("buyer"),
  locale: z.enum(LOCALES),
});

/** "Email me my order link": the address and the number on the order. */
export const orderLookupSchema = z.strictObject({
  storefrontId: uuidField("storefrontId"),
  email: emailAddress("buyer"),
  number: orderReference,
  locale: z.enum(LOCALES),
});

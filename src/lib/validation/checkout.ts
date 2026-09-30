import { z } from "zod";
import {
  emailAddress,
  multiLineText,
  singleLineText,
  uuidField,
} from "@/lib/validation/inputs";
import { PURCHASE_QUANTITY_MAX } from "@/lib/validation/product";
import { OPTIONS_TOTAL_MAX } from "@/types/product";
import { SHIP_TO_MAX } from "@/types/order-view";
import { GIFT_MESSAGE_MAX } from "@/types/storefront";
import { SHIPPING_COUNTRY_CODES } from "@/lib/settings/constants";
import { LOCALES } from "@/i18n/locales";

// What the hosted checkout's order route accepts. The SERVER boundary for the
// one public write that starts a payment: strict objects throughout (an
// unexpected key is a refusal, not something ignored), every field from the
// input primitives, every bound matching the column it ends up in.
//
// Note what is NOT here: a price, a total, a currency, a seller. The route
// looks all of those up (lib/checkout/quote.ts); a body cannot even say them.

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
});

export const placeOrderSchema = z.strictObject({
  /** Minted when the checkout rendered; keys the payment (see provider.ts). */
  attemptId: uuidField("checkoutAttempt"),
  optionIds: z.array(uuidField("option")).max(OPTIONS_TOTAL_MAX),
  quantity: z.number().int().min(1).max(PURCHASE_QUANTITY_MAX),
  email: emailAddress("buyer"),
  /** The buyer's language, for their mail. */
  locale: z.enum(LOCALES),
  shipTo: shipToSchema.optional(),
  giftMessage: multiLineText({ field: "giftMessage", max: GIFT_MESSAGE_MAX, min: 1 }).optional(),
  supplyConsent: z.boolean().optional(),
});

export type PlaceOrderInput = z.infer<typeof placeOrderSchema>;

/** An order's credential or short number, as typed or carried by a page. The
 *  route proves it (lib/orders/order-link.ts); this only bounds it. */
const orderReference = singleLineText({ field: "orderReference", max: 100 });

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

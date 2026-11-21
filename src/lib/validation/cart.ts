import { z } from "zod";
import { uuidField } from "@/lib/validation/inputs";
import { PURCHASE_QUANTITY_MAX } from "@/lib/validation/product";
import { CART_OPTIONS_PER_LINE } from "@/lib/cart/limits";
import { ORDER_LINE_SOURCES } from "@/lib/checkout/lines";
import { LINK_CHANNELS } from "@/lib/storefront/product-page-url";

// What the cart routes (app/api/cart) accept. Strict objects throughout, like
// the checkout's: a request names products, versions and quantities, never a
// price, and an unexpected key is a refusal.

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** A line's key (lib/checkout/lines.ts lineKey): a product id and up to
 *  CART_OPTIONS_PER_LINE option ids, dot separated. */
const lineKeySchema = z
  .string()
  .max(40 * (CART_OPTIONS_PER_LINE + 1))
  .regex(new RegExp(`^${UUID}(\\.${UUID}){0,${CART_OPTIONS_PER_LINE}}$`));

const quantity = z.number().int().min(1).max(PURCHASE_QUANTITY_MAX);

export const cartChangeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("add"),
    productId: uuidField("product"),
    optionIds: z.array(uuidField("option")).max(CART_OPTIONS_PER_LINE),
    quantity,
    source: z.enum(ORDER_LINE_SOURCES),
  }),
  /** 0 takes the line out. */
  z.strictObject({ kind: z.literal("set"), key: lineKeySchema, quantity: z.number().int().min(0).max(PURCHASE_QUANTITY_MAX) }),
  z.strictObject({ kind: z.literal("remove"), key: lineKeySchema }),
  z.strictObject({ kind: z.literal("clear") }),
  /** Bring another cart of this storefront's into this one, which then
   *  carries on (a buyer arriving from the embed with a cart of their own). */
  z.strictObject({ kind: z.literal("merge"), fromCartId: uuidField("cart") }),
]);

export const cartWriteSchema = z.strictObject({
  /** Null for a buyer without a cart yet: the first add starts one. */
  cartId: uuidField("cart").nullable(),
  change: cartChangeSchema,
  /** How the buyer arrived (`?via=`, or the embed frame itself), for the
   *  "Added to cart" figure's channel. Attribution only, never authority:
   *  absent is direct. */
  via: z.enum(LINK_CHANNELS).optional(),
});

export const cartViewSchema = z.strictObject({
  cartId: uuidField("cart"),
});

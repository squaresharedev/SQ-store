import { z } from "zod";
import {
  boundedInt,
  discountCode,
  isoInstant,
  optionalSingleLineText,
  uniqueList,
  uuidField,
} from "@/lib/validation/inputs";
import { issueKey } from "@/lib/validation/messages";
import { CURRENCIES } from "@/types/product";
import {
  DISCOUNT_AMOUNT_MAX_CENTS,
  DISCOUNT_PERCENT_MAX,
  DISCOUNT_PERCENT_MIN,
  DISCOUNT_PRODUCTS_MAX,
  DISCOUNT_SCOPES,
  DISCOUNT_USAGE_LIMIT_MAX,
  SHARE_CHANNEL_MAX,
} from "@/types/discount";

/**
 * THE WRITE BOUNDARY for a discount, as the form sends it to
 * lib/discounts/actions.ts. Strict objects throughout, every bound the one the
 * matching CHECK in 20261004_discounts.sql enforces.
 *
 * What is NOT here, on purpose: an owner (the action uses the active store),
 * and anything about orders. Rules that depend on the clock (a start in the
 * past, a started sale's frozen terms) are the action's, because a schema
 * cannot know what "now" means for the row it is about to change.
 */

const percentValue = z.strictObject({
  type: z.literal("percent"),
  percentOff: boundedInt({ field: "percentOff", min: DISCOUNT_PERCENT_MIN, max: DISCOUNT_PERCENT_MAX }),
});

const amountValue = z.strictObject({
  type: z.literal("amount"),
  amountOffCents: boundedInt({ field: "amountOff", min: 1, max: DISCOUNT_AMOUNT_MAX_CENTS }),
  currency: z.enum(CURRENCIES),
});

export const discountValueSchema = z.discriminatedUnion("type", [percentValue, amountValue]);

/** What every discount has, whichever kind. */
const shared = {
  value: discountValueSchema,
  appliesTo: z.enum(DISCOUNT_SCOPES),
  productIds: uniqueList(uuidField("product"), { field: "discountProducts", max: DISCOUNT_PRODUCTS_MAX }),
  /** Null means "now": the server sets it, so a seller's clock never decides. */
  startsAt: isoInstant("startsAt").nullable(),
  endsAt: isoInstant("endsAt").nullable(),
};

export const discountInputSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("automatic"), ...shared }),
    z.strictObject({
      kind: z.literal("code"),
      ...shared,
      code: discountCode("code"),
      /** Empty means none. */
      shareChannel: optionalSingleLineText({ field: "shareChannel", max: SHARE_CHANNEL_MAX }),
      usageLimit: boundedInt({ field: "usageLimit", min: 1, max: DISCOUNT_USAGE_LIMIT_MAX }).nullable(),
      enabled: z.boolean(),
    }),
  ])
  // Zod runs these even when a field above failed, so each one checks the
  // shape it reads before trusting it.
  .refine(
    (input) =>
      !Array.isArray(input.productIds) ||
      (input.appliesTo === "products" ? input.productIds.length > 0 : input.productIds.length === 0),
    { error: issueKey("Validation.discount.productsRequired"), path: ["productIds"] },
  )
  .refine(
    (input) => {
      if (typeof input.endsAt !== "string") return true;
      const start = typeof input.startsAt === "string" ? Date.parse(input.startsAt) : Date.now();
      return Date.parse(input.endsAt) > start;
    },
    { error: issueKey("Validation.discount.endBeforeStart"), path: ["endsAt"] },
  );

export type DiscountInput = z.infer<typeof discountInputSchema>;

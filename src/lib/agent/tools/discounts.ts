import { z } from "zod";
import { presentDiscount } from "@/lib/agent/present";
import { DESTRUCTIVE, READ, ToolFailure, WRITE, defineTool, unwrap } from "@/lib/agent/tool";
import {
  createDiscount,
  deleteDiscount,
  endSale,
  setCodeEnabled,
  updateDiscount,
} from "@/lib/discounts/actions";
import { getDiscount, getDiscountPerformance, listDiscounts } from "@/lib/discounts/queries";
import { invalidInput, notFound } from "@/lib/errors";
import { firstIssue } from "@/lib/validation/messages";
import { discountInputSchema } from "@/lib/validation/discounts";

const discountId = z.string().describe("The discount's id.");

const STARTED_SALES_KEEP_THEIR_TERMS =
  "A sale that has started keeps its terms by law: only its end can move, and not into the past. To change a running sale, end it and create another.";

const discountInput = z
  .record(z.string(), z.unknown())
  .describe(
    "kind automatic (a sale) or code; value {type:percent,percentOff} 1 to 90, or {type:amount,amountOffCents,currency}; appliesTo all or products with productIds; startsAt and endsAt ISO instants or null. A code also takes code, shareChannel, usageLimit and enabled. See get_schema with of=discount.",
  );

function assertValid(input: unknown): void {
  const parsed = discountInputSchema.safeParse(input);
  if (!parsed.success) throw new ToolFailure(invalidInput(firstIssue(parsed.error)));
}

export const discountTools = [
  defineTool({
    name: "list_discounts",
    title: "List discounts",
    description: "The store's sales and discount codes. Codes are the store's secrets: only share one if the seller asks you to. One discount applies per order, never two.",
    scope: "store:read",
    permission: "store.read",
    annotations: READ,
    input: z.strictObject({}),
    handler: async () => ({ discounts: (await listDiscounts()).map(presentDiscount) }),
  }),

  defineTool({
    name: "get_discount",
    title: "Get a discount",
    description: "One sale or code.",
    scope: "store:read",
    permission: "store.read",
    annotations: READ,
    input: z.strictObject({ id: discountId }),
    handler: async ({ id }) => {
      const discount = await getDiscount(id);
      if (!discount) throw new ToolFailure(notFound("discount"));
      return presentDiscount(discount);
    },
  }),

  defineTool({
    name: "get_discount_performance",
    title: "Get discount performance",
    description: "What each discount brought in. Revenue and amount given are per currency and must not be added across currencies. Each paid order is credited once.",
    scope: "store:read",
    permission: "store.read",
    annotations: READ,
    input: z.strictObject({}),
    handler: async () => ({ performance: [...(await getDiscountPerformance()).values()] }),
  }),

  defineTool({
    name: "create_discount",
    title: "Create a discount",
    description: `Start a sale or a discount code. ${STARTED_SALES_KEEP_THEIR_TERMS}`,
    scope: "discounts:write",
    permission: "products.write",
    annotations: WRITE,
    input: z.strictObject({ discount: discountInput }),
    handler: async ({ discount }) => {
      assertValid(discount);
      return unwrap(await createDiscount(discount));
    },
  }),

  defineTool({
    name: "update_discount",
    title: "Update a discount",
    description: `Change a discount. Send the whole discount. ${STARTED_SALES_KEEP_THEIR_TERMS}`,
    scope: "discounts:write",
    permission: "products.write",
    annotations: WRITE,
    input: z.strictObject({ id: discountId, discount: discountInput }),
    handler: async ({ id, discount }) => {
      assertValid(discount);
      return unwrap(await updateDiscount(id, discount));
    },
  }),

  defineTool({
    name: "set_code_enabled",
    title: "Switch a code on or off",
    description: "Switch a discount code on or off. Codes only: a sale has no off switch, use end_sale.",
    scope: "discounts:write",
    permission: "products.write",
    annotations: { ...WRITE, idempotentHint: true },
    input: z.strictObject({ id: discountId, enabled: z.boolean() }),
    handler: async ({ id, enabled }) => unwrap(await setCodeEnabled(id, enabled)),
  }),

  defineTool({
    name: "end_sale",
    title: "End a sale",
    description: "End a running sale now.",
    scope: "discounts:write",
    permission: "products.write",
    annotations: WRITE,
    input: z.strictObject({ id: discountId }),
    handler: async ({ id }) => unwrap(await endSale(id)),
  }),

  defineTool({
    name: "delete_discount",
    title: "Delete a discount",
    description: "Remove a discount from the list. It is archived, so its orders stay counted. Confirm with the seller first.",
    scope: "destructive",
    permission: "products.write",
    annotations: DESTRUCTIVE,
    input: z.strictObject({ id: discountId }),
    handler: async ({ id }) => unwrap(await deleteDiscount(id)),
  }),
];

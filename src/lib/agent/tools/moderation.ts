import { z } from "zod";
import { WRITE, defineTool, unwrap } from "@/lib/agent/tool";
import { fileModerationAppeal } from "@/lib/moderation/appeals";
import { requestModerationReview } from "@/lib/moderation/review-request";

export const moderationTools = [
  defineTool({
    name: "request_moderation_review",
    title: "Ask for a takedown to be reviewed",
    description: "After fixing what a takedown named on a product or storefront, ask for it to be checked again. get_product and get_storefront report a takedown as takenDown.",
    scope: "moderation:write",
    permission: "store.read",
    annotations: WRITE,
    input: z.strictObject({
      targetType: z.enum(["product", "storefront"]),
      id: z.string(),
    }),
    handler: async ({ targetType, id }) => unwrap(await requestModerationReview(targetType, id)),
  }),

  defineTool({
    name: "file_moderation_appeal",
    title: "Appeal a moderation decision",
    description: "File the seller's appeal against a decision: their statement that it was wrong. It is the seller's legal right and their words, so write it only from what they told you, and show it to them first.",
    scope: "moderation:write",
    permission: "store.read",
    annotations: WRITE,
    input: z.strictObject({
      decisionId: z.string(),
      message: z.string().max(2000),
    }),
    handler: async ({ decisionId, message }) => unwrap(await fileModerationAppeal(decisionId, message)),
  }),
];

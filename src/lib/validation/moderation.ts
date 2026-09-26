import { z } from "zod";
import { multiLineText, uuidField } from "@/lib/validation/inputs";

/**
 * A seller's appeal against a moderation decision (lib/moderation/appeals.ts).
 *
 * The bounds mirror the moderation_appeals.message CHECK. The floor is not
 * pedantry: an appeal is read by a person who has to decide on it, and "wrong"
 * gives them nothing to decide with. Twenty characters is one real sentence.
 */
export const APPEAL_MESSAGE_MIN = 20;
export const APPEAL_MESSAGE_MAX = 2000;

export const appealSchema = z.strictObject({
  decisionId: uuidField("moderationDecision"),
  message: multiLineText({
    field: "appealMessage",
    min: APPEAL_MESSAGE_MIN,
    max: APPEAL_MESSAGE_MAX,
  }),
});

export type AppealInput = z.infer<typeof appealSchema>;

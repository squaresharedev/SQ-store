import { createTranslator } from "next-intl";
import type { z } from "zod";
import { isValidationKey, issueMessage, type ValidationKey } from "@/lib/validation/messages";
import validation from "../../../messages/en/validation.json";

/**
 * A BRIDGE, not a pattern. Schemas speak in Validation keys (./messages.ts),
 * but a few replies are still English strings end to end: the two-factor
 * actions (lib/auth/mfa-actions.ts) and the report endpoint
 * (app/api/report/route.ts). They resolve an issue here, to exactly the
 * English it carried before its schema moved to keys, until their own copy
 * moves into the catalogue and they can hand the render site a MessageRef like
 * everything else.
 *
 * Server-only in practice: nothing in a browser bundle should need English
 * regardless of its reader's language.
 */

const englishValidation = createTranslator({
  locale: "en",
  messages: { Validation: validation },
  timeZone: "UTC",
});

/** One issue as English. A message that is not one of our keys is passed through. */
export function issueInEnglish(issue: z.core.$ZodIssue): string {
  if (!isValidationKey(issue.message)) return issue.message;
  const ref = issueMessage(issue);
  return englishValidation(ref.key as ValidationKey, ref.values);
}

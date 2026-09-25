import type { z } from "zod";
import { msg, type MessageKey, type MessageRef, type MessageValues } from "@/i18n/types";
import catalogue from "../../../messages/en/validation.json";

/**
 * VALIDATION MESSAGES ARE KEYS, NOT SENTENCES.
 *
 * Schemas are shared by the browser (typing hints) and the server actions (the
 * real gate), and whatever an issue says is shown in the READER'S language,
 * which neither of them knows. So a schema stores a message KEY in the Validation
 * namespace as its Zod message, and {@link issueMessage} turns the issue back
 * into a MessageRef for the render site.
 *
 * Numbers an issue already carries (`minimum`, `maximum`, a refine's `params`)
 * become the ref's values, so a message says "{maximum} characters or fewer"
 * and the bound lives in one place: the schema.
 */

/** Any message in the Validation namespace. */
export type ValidationKey = Extract<MessageKey, `Validation.${string}`>;

/** The Zod message for a schema check. Typed, so a misspelt key fails tsc. */
export function issueKey(key: ValidationKey): string {
  return key;
}

/**
 * Whether a Zod issue message is one of ours. Checked against the catalogue
 * itself rather than by prefix: an issue message is a plain string by the time
 * it comes back out of Zod, and only the catalogue can say it names a message.
 */
export function isValidationKey(value: string): value is ValidationKey {
  const [namespace, ...path] = value.split(".");
  if (namespace !== "Validation" || path.length === 0) return false;
  let node: unknown = catalogue;
  for (const segment of path) {
    if (typeof node !== "object" || node === null || !Object.hasOwn(node, segment)) {
      return false;
    }
    node = (node as Record<string, unknown>)[segment];
  }
  return typeof node === "string";
}

function issueValues(issue: z.core.$ZodIssue): MessageValues {
  const values: MessageValues = {};
  if (issue.code === "too_small") values.minimum = Number(issue.minimum);
  if (issue.code === "too_big") values.maximum = Number(issue.maximum);
  if (issue.code === "custom" && issue.params) {
    for (const [name, value] of Object.entries(issue.params)) {
      if (typeof value === "string" || typeof value === "number") values[name] = value;
    }
  }
  return values;
}

/**
 * One Zod issue as a message to show.
 *
 * An issue with no message of ours (Zod's own default, e.g. a wrong type on a
 * field no form can send wrong) gets the generic message rather than Zod's
 * text: that text is English whatever the reader's language, and it describes
 * the schema to a developer rather than the form to a seller.
 */
export function issueMessage(issue: z.core.$ZodIssue): MessageRef {
  if (!isValidationKey(issue.message)) return msg("Validation.generic.invalid");
  const values = issueValues(issue);
  return Object.keys(values).length > 0 ? msg(issue.message, values) : msg(issue.message);
}

/**
 * The first problem with a submission: what a form shows, one line at a time.
 * `fallback` answers the (theoretical) failed parse that reports no issue.
 */
export function firstIssue(
  error: z.ZodError,
  fallback: MessageRef = msg("Validation.checkForm"),
): MessageRef {
  const issue = error.issues[0];
  return issue ? issueMessage(issue) : fallback;
}

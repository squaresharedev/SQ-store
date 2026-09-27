import { failed, invalidInput, type ActionState } from "@/lib/errors";
import { msg } from "@/i18n/types";

/**
 * FIELD WHITELIST (privilege-escalation guard) for server actions: refuse any
 * submitted field the action does not expect, by name. Paired with strict Zod
 * schemas and column-by-column writes, there is no path for a form to smuggle
 * a column the action never meant to touch. React's own `$ACTION_*`
 * bookkeeping keys are ignored.
 */
export function unknownField(formData: FormData, allowed: readonly string[]): ActionState | null {
  for (const key of formData.keys()) {
    if (key.startsWith("$ACTION")) continue;
    if (!allowed.includes(key)) {
      return failed(invalidInput(msg("Errors.form.unexpectedField", { field: key })));
    }
  }
  return null;
}

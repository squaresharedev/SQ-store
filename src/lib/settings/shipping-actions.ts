"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/session";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import {
  compactShippingPolicy,
  shippingPolicySchema,
} from "@/lib/validation/shipping-policy";
import { firstIssue } from "@/lib/validation/messages";
import {
  actionError,
  failed,
  invalidInput,
  succeeded,
  type ActionState,
} from "@/lib/errors";
import { msg } from "@/i18n/types";

/**
 * SAVING THE ACCOUNT'S SHIPPING AND RETURNS TERMS.
 *
 * Its own module rather than another function in `settings/actions.ts`: this
 * one writes a jsonb document rather than a column, so it carries a different
 * shape of boundary (a size guard and a JSON parse before the schema), and
 * keeping that reasoning next to the code rather than eleven functions deep in
 * a shared file is worth one more file.
 *
 * WHY ONE JSON FIELD, when every other settings form posts named inputs. The
 * policy holds two LISTS the seller adds to and removes from (destinations,
 * and the named shipping profiles products point at). Indexed field names
 * ("destinations.2.area") would put array reassembly — the exact thing that
 * goes wrong quietly — in the action, and would still need the same strict
 * schema afterwards. One document, parsed and then bounded by
 * `shippingPolicySchema`, is a smaller boundary and a stricter one: the schema
 * is a strict object all the way down, so an unknown key anywhere in the tree
 * is a rejected write rather than a stored one.
 *
 * The field whitelist below is doing the same job it does everywhere else in
 * settings — nothing but `policy` gets through, so there is no path from this
 * form to `id`, `is_seller` or any other profile column.
 */

const SIGNED_OUT: ActionState = failed(
  actionError("session_expired", msg("Errors.form.sessionExpired")),
);
const SAVE_FAILED: ActionState = failed(
  actionError("server_error", msg("Errors.form.saveFailed")),
);
const TOO_MANY: ActionState = failed(
  actionError("rate_limited", msg("Errors.form.tooManyChanges")),
);
const MALFORMED: ActionState = failed(invalidInput(msg("Errors.form.malformed")));

/**
 * Refused before `JSON.parse` ever runs. The column's own CHECK caps the
 * STORED value at 16 KB, but that fires after this action has already spent
 * the work of parsing and validating; a cheap length gate here means a junk
 * payload costs a string comparison instead. Generous next to the largest
 * policy the form can produce (four 2000-char fields, six destinations and
 * eight profiles), so it can only ever catch something that did not come from
 * the form.
 */
const MAX_PAYLOAD_BYTES = 64_000;

export async function saveShippingPolicy(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;

  for (const key of formData.keys()) {
    if (key.startsWith("$ACTION")) continue;
    if (key !== "policy") {
      return failed(invalidInput(msg("Errors.form.unexpectedField", { field: key })));
    }
  }

  const raw = formData.get("policy");
  if (typeof raw !== "string" || raw.length > MAX_PAYLOAD_BYTES) return MALFORMED;

  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch {
    return MALFORMED;
  }

  // Compact BEFORE parsing: the form posts every field it has, and the schema's
  // text fields are min-1, so an untouched field would otherwise be an error
  // where the seller meant "blank".
  const parsed = shippingPolicySchema.safeParse(compactShippingPolicy(document));
  if (!parsed.success) return failed(invalidInput(firstIssue(parsed.error)));

  if (!(await rateLimit("settings_write", RATE_LIMITS.settingsWrite))) return TOO_MANY;

  // An account that cleared every field stores NULL, not `{}`. "Never written
  // anything" and "wrote nothing" are the same fact to every reader, and the
  // migration normalises the same way, so there is one representation of it.
  const empty = Object.keys(parsed.data).length === 0;

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      shipping_policy: empty ? null : parsed.data,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id); // owner id from the session; RLS enforces it again
  if (error) return SAVE_FAILED;

  revalidatePath("/settings/shipping");
  // The hosted product pages print these terms, and the designer's panel shows
  // a summary of them. Neither is under /settings, so neither is revalidated
  // by the line above.
  revalidatePath("/s", "layout");
  return succeeded(msg("Settings.shipping.success.shippingSaved"));
}

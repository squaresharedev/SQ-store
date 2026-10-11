// SERVER ONLY. Seller text that is CHECKED BEFORE IT IS STORED.
//
// A product or a storefront may sit behind the moderation wall as "pending"
// while it is checked. The words on a seller's profile cannot: the trader
// name, the bio and the shipping terms print on every product page that seller
// has, so a pending state there would blink a whole store out for a settings
// edit. They are also short, text only and rarely edited. So they take the
// simpler rule: the words are judged first, and stored only if they are clean.
//
// The database holds up its half (guard_seller_text, 20261012_auto_moderation:
// only the service role may write these columns), which is what makes going
// around this file impossible rather than merely impolite.

import { actionError, invalidInput, type ActionError } from "@/lib/errors";
import { msg } from "@/i18n/types";
import { SUPPORT_EMAIL } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  checkAvatar,
  checkHandle,
  checkSellerText,
  type StandaloneVerdict,
} from "@/lib/moderation/auto/check";
import type { TablesUpdate } from "@/types";

/** The profile columns only the server may write. Mirror of guard_seller_text. */
export const GUARDED_SELLER_COLUMNS = ["tax_business_name", "seller_bio", "shipping_policy"] as const;

/** Why a standalone check did not pass, as something a form can show. */
function refusal(verdict: StandaloneVerdict, what: "text" | "image"): ActionError | null {
  if (verdict?.verdict === "clean") return null;
  // No answer could be obtained. Not an approval, and not the seller's fault.
  if (!verdict) {
    return actionError(
      "server_error",
      msg("Errors.moderation.checkUnavailable", { what }),
      msg("Errors.moderation.checkUnavailableFix"),
    );
  }
  return verdict.verdict === "violation"
    ? invalidInput(
        msg("Errors.moderation.refused", { what }),
        msg("Errors.moderation.refusedFix", { email: SUPPORT_EMAIL }),
      )
    : invalidInput(
        msg("Errors.moderation.notApproved", { what }),
        msg("Errors.moderation.notApprovedFix", { email: SUPPORT_EMAIL }),
      );
}

/**
 * Every string inside a value, keyed by where it sits ("shipping.returns",
 * "shipping.destinations.area"). Array positions are left out, so two rows of
 * a list share a field and are judged together.
 */
export function textLeaves(prefix: string, value: unknown, into: Record<string, string> = {}) {
  if (typeof value === "string") {
    if (value.trim() !== "") into[prefix] = into[prefix] ? `${into[prefix]}\n${value}` : value;
  } else if (Array.isArray(value)) {
    for (const item of value) textLeaves(prefix, item, into);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) textLeaves(`${prefix}.${key}`, child, into);
  }
  return into;
}

/**
 * Judge seller text before it is stored. Null means it may be saved; anything
 * else is the reason it may not, ready to hand back to the form.
 */
export async function sellerTextRefusal(fields: Record<string, string>): Promise<ActionError | null> {
  return refusal(await checkSellerText(fields), "text");
}

/** The same for a handle, which is approved by value (see checkHandle). */
export async function handleRefusal(handle: string): Promise<ActionError | null> {
  return refusal(await checkHandle(handle), "text");
}

/** The same for a profile picture already stored at the public URL the
 *  profile will point at (see checkAvatar). */
export async function avatarRefusal(url: string): Promise<ActionError | null> {
  return refusal(await checkAvatar(url, url), "image");
}

/**
 * Write a seller's own profile row.
 *
 * In two steps when the update carries guarded seller text. The session's own
 * write goes first, so RLS and the two-factor policy decide whether this
 * caller may write the row at all; only then does the service role add the
 * columns a session cannot. The caller must already have passed the text
 * through {@link sellerTextRefusal}: this function writes what it is given.
 */
export async function writeOwnProfile(
  userId: string,
  update: TablesUpdate<"profiles">,
): Promise<boolean> {
  const guarded: TablesUpdate<"profiles"> = {};
  const open: TablesUpdate<"profiles"> = { ...update };
  for (const column of GUARDED_SELLER_COLUMNS) {
    if (column in update) {
      Object.assign(guarded, { [column]: update[column] });
      delete open[column];
    }
  }

  const supabase = await createClient();
  const write = supabase
    .from("profiles")
    .update({ ...open, updated_at: new Date().toISOString() })
    .eq("id", userId); // owner id from the session, RLS enforces it again
  if (Object.keys(guarded).length === 0) {
    const { error } = await write;
    return !error;
  }

  // The row has to come BACK: an update RLS filtered out is no error and no
  // row, and going on to the service role then would write for a session
  // that was not allowed to.
  const { data: own, error } = await write.select("id").maybeSingle();
  if (error || !own) return false;

  const { error: guardedError } = await createAdminClient()
    .from("profiles")
    .update(guarded)
    .eq("id", userId);
  if (guardedError) console.error("[moderation] seller text write failed:", guardedError.message);
  return !guardedError;
}

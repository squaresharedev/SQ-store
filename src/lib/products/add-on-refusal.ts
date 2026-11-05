import { invalidInput, serverError, type ActionError } from "@/lib/errors";
import { msg } from "@/i18n/types";
import type { createClient } from "@/lib/supabase/server";

/**
 * Every add-on must be ANOTHER product of the active store. A foreign id would
 * be inert (the buyer path only ever offers the store's own products), but it
 * would be a lie in the list, so it is refused here with words; the database
 * holds the same line (guard_add_on_ids) for a write that skips this check.
 */
export async function addOnRefusal(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accountId: string,
  ids: readonly string[] | undefined,
  selfId: string | null,
): Promise<ActionError | null> {
  if (!ids || ids.length === 0) return null;
  const refused = invalidInput(msg("Validation.product.addOnNotYours"));
  if (selfId && ids.includes(selfId)) return refused;
  const { count, error } = await supabase
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", accountId)
    .in("id", [...ids]);
  if (error) {
    console.error("[products] add-on check failed", error);
    return serverError("saveProduct");
  }
  return count === ids.length ? null : refused;
}

// SERVER ONLY. A store's products that the automatic check has not judged yet,
// settled by the seller's own visits to the products list.
//
// WHY. Only a few rows of a CSV import are checked while it saves (a request may
// make only so many calls out); the rest wait for the scheduled sweep, which in
// practice runs hours apart. A seller who imports a catalogue then sits on a
// list of "Checking" badges that do not move. Each visit to the list now asks
// about a few more of THEIR waiting products after the page has been sent, so
// the list catches up as they look at it.
//
// Bounded per visit, oldest first, and only rows nobody has judged yet
// ("pending"): one waiting for a person ("review") is a person's to decide.

import { checkMany } from "@/lib/moderation/auto/check";
import { createAdminClient } from "@/lib/supabase/admin";

/** How many waiting products one visit asks the check about: the same few a
 *  save may check itself. */
const PER_VISIT = 8;

export async function settleWaitingProducts(ownerId: string): Promise<void> {
  try {
    const { data, error } = await createAdminClient()
      .from("products")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("moderation_status", "pending")
      .order("updated_at", { ascending: true })
      .limit(PER_VISIT);
    if (error) {
      console.error("[products] waiting products read failed", error.message);
      return;
    }
    if (!data || data.length === 0) return;
    await checkMany(
      "product",
      data.map((row) => row.id),
    );
  } catch (error) {
    // After the response: nothing to tell the seller, and the sweep is still
    // there behind this.
    console.error("[products] settling waiting products failed", error instanceof Error ? error.message : error);
  }
}

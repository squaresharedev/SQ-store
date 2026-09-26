import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types";
import type { ModerationAppealSummary, ProductRemoval } from "@/types/product";

// Reading a seller's own appeals, for the banner that shows where one stands.
// The write lives in appeals.ts (a server action); this is its read half, kept
// apart because a "use server" module may only export actions.
//
// Always the SELLER'S session and always scoped to the active account
// explicitly: RLS lets a team member read every store they belong to, so the
// filter is what says "this store" (see lib/team/account-context.ts).

const APPEAL_SUMMARY_SELECT = "decision_id, status, created_at, decided_at, decision_note" as const;

type AppealRow = {
  status: string;
  created_at: string;
  decided_at: string | null;
  decision_note: string | null;
};

/** One appeal row as the seller is shown it. */
export function appealSummary(row: AppealRow): ModerationAppealSummary {
  return {
    // An unrecognised status reads as still open: the seller is then told to
    // wait, never that they won or lost something nobody decided.
    status: row.status === "upheld" || row.status === "overturned" ? row.status : "open",
    filedAt: row.created_at,
    decidedAt: row.decided_at,
    note: row.decision_note,
  };
}

/** The appeals filed against these decisions, keyed by decision id. A failed
 *  read is an empty map: the banner then offers the appeal button, and the
 *  action itself refuses a second appeal if one exists. */
export async function appealsByDecision(
  supabase: SupabaseClient<Database>,
  accountId: string,
  decisionIds: readonly string[],
): Promise<Map<string, ModerationAppealSummary>> {
  const found = new Map<string, ModerationAppealSummary>();
  if (decisionIds.length === 0) return found;
  const { data, error } = await supabase
    .from("moderation_appeals")
    .select(APPEAL_SUMMARY_SELECT)
    .eq("owner_id", accountId)
    .in("decision_id", [...decisionIds]);
  if (error) {
    console.error("[moderation] appeal read failed", error.message);
    return found;
  }
  for (const row of data ?? []) found.set(row.decision_id, appealSummary(row));
  return found;
}

/** `removal` with its appeal attached, when the seller filed one. */
export function withAppeal(
  removal: ProductRemoval,
  appeals: Map<string, ModerationAppealSummary>,
): ProductRemoval {
  const appeal = removal.decisionId ? appeals.get(removal.decisionId) : undefined;
  return { ...removal, appeal: appeal ?? null };
}

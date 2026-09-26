"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { appealSchema } from "@/lib/validation/moderation";
import { firstIssue } from "@/lib/validation/messages";
import {
  failure,
  invalidInput,
  notFound,
  permissionDenied,
  rateLimited,
  serverError,
  sessionExpired,
  type ActionError,
} from "@/lib/errors";
import { msg } from "@/i18n/types";
import { pingAdminModeration } from "@/lib/moderation/admin-ping";
import { takedownKind } from "@/lib/moderation/removal";
import { appealSummary } from "@/lib/moderation/appeals-read";
import { PRODUCTS_PATH, productEditPath } from "@/lib/products/paths";
import { STOREFRONT_LIST_PATH } from "@/lib/storefront/paths";
import type { ModerationAppealSummary } from "@/types/product";

// THE SELLER'S APPEAL. "I think you got this wrong", about one decision.
//
// EU Digital Services Act Art. 20 asks a platform that restricts someone's
// content for a complaint system that is electronic, free, easy to reach, and
// decided by a person rather than a script. This is its front door: the
// seller writes why, it lands in the admin panel's queue, and staff uphold or
// overturn the decision (Admin decideAppeal), which tells the seller either
// way.
//
// SAME SHAPE AS review-request.ts, for the same reason. The seller's OWN
// session answers every question first (may they edit this, does this
// decision belong to their store, is it still the one in force), and only
// then does the service role write the one row. moderation_appeals is
// read-only to authenticated: a seller able to insert directly could file
// against somebody else's decision or rewrite an appeal after it was answered.
//
// WHAT IT DOES NOT DO: put anything back. The content stays hidden until a
// person has read the appeal and decided.

export type AppealResult =
  | { ok: true; appeal: ModerationAppealSummary }
  | { ok: false; error: ActionError };

const TARGETS = {
  product: {
    table: "products",
    permission: "products.write",
    capability: "editThisProduct",
    paths: (id: string) => [PRODUCTS_PATH, productEditPath(id)],
  },
  storefront: {
    table: "storefronts",
    permission: "storefront.write",
    capability: "editThisStorefront",
    paths: () => [STOREFRONT_LIST_PATH],
  },
} as const;

export async function fileModerationAppeal(
  decisionId: string,
  message: string,
): Promise<AppealResult> {
  const account = await getActiveAccount();
  if (!account) return failure(sessionExpired());

  // A Server Action argument is attacker-controlled whatever its TS type says.
  const parsed = appealSchema.safeParse({ decisionId, message });
  if (!parsed.success) return failure(invalidInput(firstIssue(parsed.error)));

  // Read with the SELLER'S session, scoped to the active account explicitly.
  // If their session cannot see the decision, it is not theirs to appeal.
  const supabase = await createClient();
  const { data: decision, error: decisionError } = await supabase
    .from("moderation_decisions")
    .select("id, target_type, target_id, owner_id")
    .eq("id", parsed.data.decisionId)
    .eq("owner_id", account.accountId)
    .maybeSingle();
  if (decisionError) {
    console.error("[moderation] appeal decision read failed", decisionError.message);
    return failure(serverError("fileAppeal"));
  }
  if (!decision) return failure(notFound("item"));

  const targetType = decision.target_type === "storefront" ? "storefront" : "product";
  const target = TARGETS[targetType];
  // Appealing is acting for the store, so it takes the same permission as
  // fixing the content would. A read-only member sees the decision, and the
  // banner tells them who can answer it.
  if (!can(account.role, target.permission)) {
    return failure(permissionDenied(account.role, target.capability));
  }

  if (!(await rateLimit("moderation_appeal", RATE_LIMITS.moderationAppeal))) {
    return failure(rateLimited("fileAppeal"));
  }

  // Only the decision in force can be appealed. One that a later decision
  // replaced (paused again, then removed) or that staff already reversed has
  // nothing left to argue about, and an appeal against it would sit in the
  // staff queue asking a question with no live answer.
  const { data: content, error: contentError } = await supabase
    .from(target.table)
    .select("moderation_status, moderation_decision_id")
    .eq("id", decision.target_id)
    .eq("owner_id", account.accountId)
    .maybeSingle();
  if (contentError) {
    console.error("[moderation] appeal content read failed", contentError.message);
    return failure(serverError("fileAppeal"));
  }
  if (
    !content ||
    !takedownKind(content.moderation_status) ||
    content.moderation_decision_id !== decision.id
  ) {
    return failure(
      invalidInput(
        msg("Errors.moderation.decisionSuperseded"),
        msg("Errors.moderation.decisionSupersededFix"),
      ),
    );
  }

  const admin = createAdminClient();
  const { data: inserted, error: insertError } = await admin
    .from("moderation_appeals")
    .insert({
      decision_id: decision.id,
      target_type: targetType,
      target_id: decision.target_id,
      owner_id: account.accountId,
      filed_by: account.userId,
      message: parsed.data.message,
    })
    .select("status, created_at, decided_at, decision_note")
    .single();

  if (insertError) {
    // 23505 is the one-appeal-per-decision constraint: it was already filed
    // (a double submit, or a teammate got there first). Answer with the
    // appeal that stands rather than an error, the way review-request does.
    if (insertError.code === "23505") {
      const { data: existing } = await admin
        .from("moderation_appeals")
        .select("status, created_at, decided_at, decision_note")
        .eq("decision_id", decision.id)
        .maybeSingle();
      if (existing) return { ok: true, appeal: appealSummary(existing) };
    }
    console.error("[moderation] appeal insert failed", insertError.message);
    return failure(serverError("fileAppeal"));
  }

  // Staff hear about it now rather than at the next scheduled scan. After the
  // response, and unable to fail it: the appeal is already recorded.
  after(pingAdminModeration);

  for (const path of target.paths(decision.target_id)) revalidatePath(path);
  return { ok: true, appeal: appealSummary(inserted) };
}


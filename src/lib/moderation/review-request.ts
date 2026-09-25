"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { uuidField } from "@/lib/validation/inputs";
import {
  failure,
  invalidInput,
  notFound,
  permissionDenied,
  rateLimited,
  serverError,
  sessionExpired,
  type ActionError,
  type PermissionCapability,
} from "@/lib/errors";
import { msg } from "@/i18n/types";
import { pingAdminModeration } from "@/lib/moderation/admin-ping";

// THE SELLER'S WAY BACK FROM A PAUSE.
//
// Staff paused something and said what to change. The seller changes it, then
// presses one button to put it back in front of a person. This is that button's
// server half, and the only write a seller can make to moderation state.
//
// WHY service_role FOR THE WRITE. guard_moderation_columns refuses any change
// to a moderation_* column from the seller's own role, and that has to stay
// true: a seller able to set moderation_review_requested_at directly could set
// it on a REMOVED item, which is a final decision, and put it back in front of
// staff as often as they liked. So the column stays staff-only in the
// database, and this action is the narrow door: it checks everything with the
// seller's OWN session first, and only then writes one column, only on a row
// that is paused, only from null.
//
// WHAT IT DOES NOT DO: put anything back live. The row stays hidden until a
// person looks at it. A button that restored content on the seller's say-so
// would make pausing pointless.

export type ReviewRequestTarget = "product" | "storefront";

export type ReviewRequestResult =
  | { ok: true; requestedAt: string }
  | { ok: false; error: ActionError };

const TARGETS: Record<
  ReviewRequestTarget,
  {
    table: "products" | "storefronts";
    permission: "products.write" | "storefront.write";
    /** What a refused permission check says this caller cannot do. */
    capability: PermissionCapability;
    paths: (id: string) => string[];
  }
> = {
  product: {
    table: "products",
    permission: "products.write",
    capability: "editThisProduct",
    paths: (id) => ["/products", `/products/${id}/edit`],
  },
  storefront: {
    table: "storefronts",
    permission: "storefront.write",
    capability: "editThisStorefront",
    paths: () => ["/storefront"],
  },
};

export async function requestModerationReview(
  targetType: ReviewRequestTarget,
  id: string,
): Promise<ReviewRequestResult> {
  const target = TARGETS[targetType];
  // A Server Action argument is attacker-controlled whatever its TS type says.
  if (!target) return failure(notFound("item"));

  const account = await getActiveAccount();
  if (!account) return failure(sessionExpired());
  if (!can(account.role, target.permission)) {
    return failure(permissionDenied(account.role, target.capability));
  }
  if (!uuidField().safeParse(id).success) return failure(notFound(targetType));

  if (!(await rateLimit("moderation_review", RATE_LIMITS.productWrite))) {
    return failure(rateLimited("requestReview"));
  }

  // Read with the SELLER'S session, scoped to the active account explicitly
  // (RLS lets a team member read more than one store, so the filter is what
  // says "this store"). If they cannot see it, they cannot ask about it.
  const supabase = await createClient();
  const { data: row, error: readError } = await supabase
    .from(target.table)
    .select("id, moderation_status, moderation_review_requested_at")
    .eq("id", id)
    .eq("owner_id", account.accountId)
    .maybeSingle();
  if (readError) {
    console.error("[moderation] review request read failed", readError.message);
    return failure(serverError("sendForReview"));
  }
  if (!row) return failure(notFound(targetType));

  if (row.moderation_status !== "paused") {
    return failure(
      row.moderation_status === "removed"
        ? invalidInput(
            msg("Errors.moderation.removedNotPaused", { target: targetType }),
            msg("Errors.moderation.removedFix"),
          )
        : invalidInput(
            msg("Errors.moderation.notPaused", { target: targetType }),
            msg("Errors.moderation.notPausedFix"),
          ),
    );
  }

  // Asking twice is not asking louder. The first request stands.
  if (row.moderation_review_requested_at) {
    return { ok: true, requestedAt: row.moderation_review_requested_at };
  }

  const requestedAt = new Date().toISOString();
  const admin = createAdminClient();
  const { error: writeError } = await admin
    .from(target.table)
    .update({ moderation_review_requested_at: requestedAt })
    .eq("id", id)
    .eq("owner_id", account.accountId)
    // Re-checked IN the write, so a staff decision landing between the read
    // above and this line (a removal, say) cannot be turned back into a
    // pending request.
    .eq("moderation_status", "paused")
    .is("moderation_review_requested_at", null);
  if (writeError) {
    console.error("[moderation] review request write failed", writeError.message);
    return failure(serverError("sendForReview"));
  }

  // Staff hear about it now rather than at the next scheduled scan. After the
  // response, and unable to fail it: the request is already recorded.
  after(pingAdminModeration);

  for (const path of target.paths(id)) revalidatePath(path);
  return { ok: true, requestedAt };
}

"use server";

import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import {
  failure,
  invalidInput,
  permissionDenied,
  rateLimited,
  sessionExpired,
  type ActionFailure,
} from "@/lib/errors";
import { msg } from "@/i18n/types";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { badgeLabelSchema } from "@/lib/validation/product";
import { badgeRefusal } from "@/lib/products/badge-moderation";

/**
 * Judge the words of a badge the seller just wrote, before the form adds it.
 *
 * "Don't let anyone make an inappropriate badge" starts here: a refused badge
 * never joins the form, so it is never part of a save. It is a courtesy check,
 * not the gate: the save judges every badge again (cached, so this answer is
 * what it finds), and the database wall holds anything written around both.
 *
 * `{ ok: true }` also when no answer could be obtained, because refusing to
 * add a badge over a classifier outage helps nobody; the save will ask again.
 */
export async function checkBadgeLabel(label: unknown): Promise<{ ok: true } | ActionFailure> {
  const account = await getActiveAccount();
  if (!account) return failure(sessionExpired());
  if (!can(account.role, "products.write")) {
    return failure(permissionDenied(account.role, "editProducts"));
  }
  if (!(await rateLimit("badge_check", RATE_LIMITS.badgeCheck))) {
    return failure(rateLimited("editProducts"));
  }
  const parsed = badgeLabelSchema.safeParse(label);
  if (!parsed.success) {
    return failure(
      invalidInput(msg("Errors.products.invalid.message"), msg("Errors.products.invalid.fix")),
    );
  }
  const refused = await badgeRefusal([parsed.data]);
  return refused ? failure(refused) : { ok: true };
}

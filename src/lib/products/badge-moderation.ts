// SERVER ONLY. Badges are judged before the product carrying them is saved.
//
// THE WALL STILL HOLDS EVERY BADGE: they live in `details`, which the
// database fingerprints with the rest of the row's text, so nothing written
// around the app is ever public unchecked. This is the friendlier half in
// front of it. A badge is a few words a seller adds to a listing that may
// already be live, and letting a bad one through to the wall would hide the
// whole product (and pause it) over one pill. So each badge is judged on its
// own first, and a save carrying one that is not clean is refused with the
// badge named, while the live product stays exactly as it was.
//
// "Not clean" includes "unsure": a badge is short marketing copy, and the
// right answer to doubt about one is other words, not a listing held for a
// person. No answer at all (the classifier is down) is not a refusal: the save
// goes on and the wall decides, the same as for every other edit.

import { invalidInput, type ActionError } from "@/lib/errors";
import { msg } from "@/i18n/types";
import { SUPPORT_EMAIL } from "@/lib/site";
import { checkBadgeText } from "@/lib/moderation/auto/check";

/**
 * Why these badges may not be saved, or null when they may. In the seller's
 * order, so the refusal names the first badge they would look at.
 */
export async function badgeRefusal(labels: readonly string[]): Promise<ActionError | null> {
  const unique = [...new Set(labels.map((label) => label.trim()).filter(Boolean))];
  if (unique.length === 0) return null;
  const verdicts = await Promise.all(unique.map((label) => checkBadgeText(label)));
  for (const [index, verdict] of verdicts.entries()) {
    if (!verdict || verdict.verdict === "clean") continue;
    const label = unique[index]!;
    return verdict.verdict === "violation"
      ? invalidInput(
          msg("Errors.products.badgeRefused.message", { label }),
          msg("Errors.products.badgeRefused.fix", { email: SUPPORT_EMAIL }),
        )
      : invalidInput(
          msg("Errors.products.badgeNotApproved.message", { label }),
          msg("Errors.products.badgeNotApproved.fix", { email: SUPPORT_EMAIL }),
        );
  }
  return null;
}

import { headers } from "next/headers";
import { after } from "next/server";
import { getTranslations } from "next-intl/server";
import type { z } from "zod";
import { msg, type MessageRef } from "@/i18n/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { isContentVisible } from "@/lib/moderation/removal";
import { pingAdminModeration } from "@/lib/moderation/admin-ping";
import { REPORT_ISSUE_KEYS, reportSchema } from "@/lib/validation/reports";
import { isValidationKey, issueMessage } from "@/lib/validation/messages";
import { reporterHash } from "@/lib/moderation/reporter-hash";
import { RATE_LIMITS, clientKey, rateLimitKey } from "@/lib/rate-limit";

/**
 * POST /api/report: a buyer telling us something is wrong with a listing.
 *
 * THE ONLY UNAUTHENTICATED WRITE IN THE APP, and the reason it has to be: a
 * buyer on a hosted product page arrived from a link in someone's bio. They
 * have no account, they are not going to make one to report a listing, and a
 * report system that only signed-in users can reach is a report system nobody
 * uses. The marketplace's own endpoint stays authenticated (its users are
 * already signed in); both write to the same `reports` table.
 *
 * WHAT THAT COSTS, AND HOW IT IS PAID FOR, in order:
 *
 *   - Shape first. Nothing touches the database until the body parses.
 *   - Rate limited per client IP, fail-closed, before any read.
 *   - The target must exist AND be publicly visible right now. Reports on
 *     things a person could not have seen are noise at best and an id-probing
 *     oracle at worst.
 *   - One open report per reporter per target, enforced by a unique index
 *     rather than by asking. A duplicate is swallowed and answered exactly
 *     like a first report.
 *
 * THE RESPONSE IS ALWAYS THE SAME. Success, duplicate, already-removed: all
 * 202. A reporter learning which of those happened learns whether a target
 * exists, whether someone else already reported it, and eventually whether
 * staff acted. None of that is theirs to know, and the difference is exactly
 * what a brigade would tune against.
 *
 * IN THE REPORTER'S LANGUAGE. The dialog shows `message` and `error` as they
 * arrive, so they are resolved here from the request (cookie, then
 * Accept-Language): the buyer's language, never the seller's.
 */

/** The one answer this endpoint gives when it has accepted responsibility for
 *  a notice, whatever happened underneath. */
function accepted(message: string) {
  return Response.json({ ok: true, message }, { status: 202 });
}

/** Refusals that are about the REQUEST rather than the content, so the client
 *  can show the person what to fix. */
function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

/**
 * A failed parse's issue as a message, or null when the issue carries Zod's
 * own wording instead of one of our keys. That only happens for a request the
 * dialog cannot send (an unknown field, a body that is not an object), and
 * the caller passes Zod's text through exactly as this endpoint always has.
 */
function issueRef(issue: z.core.$ZodIssue): MessageRef | null {
  if (isValidationKey(issue.message)) return issueMessage(issue);
  const own = Object.values(REPORT_ISSUE_KEYS).find((key) => key === issue.message);
  return own ? msg(own) : null;
}

/** The row a report is filed as, in the shared table's vocabulary. */
type ReportRowTarget = { target_type: "product" | "storefront" | "profile"; target_id: string };

/**
 * Is this target something the reporter could actually have been looking at,
 * and what does it go on file as?
 *
 * Checks existence and current public visibility in one read. Note what is NOT
 * checked: whether the product is `active`, or placed on a storefront. A
 * seller who pulls a listing the moment it is reported should not thereby
 * erase the report, and a buyer reporting from a page they had open a minute
 * ago is not lying.
 *
 * A SELLER is reported through the storefront the buyer was on: that
 * storefront must be visible, and the report is filed against the account
 * that owns it (`profile`, the same target the marketplace uses for people).
 * The account id never travels to or from the browser.
 *
 * Returns null on a read error, which drops the notice. That is the one place
 * this file does not fail safe for the reporter, and it is the right trade:
 * the alternative is writing rows for unverified ids from an unauthenticated
 * caller, which is a queue-flooding primitive.
 */
async function reportableTarget(
  targetType: "product" | "storefront" | "seller",
  targetId: string,
): Promise<ReportRowTarget | null> {
  const table = targetType === "product" ? "products" : "storefronts";
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from(table)
      .select("id, owner_id, moderation_status")
      .eq("id", targetId)
      .maybeSingle();
    if (error) {
      console.error("[report] target check failed:", error.message);
      return null;
    }
    if (!data) return null;
    // Already taken down: nothing to report, and the answer to the caller is
    // the same 202 either way, so this is not a disclosure.
    if (!isContentVisible(data.moderation_status as string | null)) return null;
    return targetType === "seller"
      ? { target_type: "profile", target_id: data.owner_id }
      : { target_type: targetType, target_id: data.id };
  } catch (err) {
    console.error(
      "[report] target check threw:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  const t = await getTranslations("ProductPage.report.api");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest(t("unreadable"));
  }

  const parsed = reportSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (!issue) return badRequest(t("invalid"));
    const ref = issueRef(issue);
    if (!ref) return badRequest(issue.message);
    // Validation keys are full paths, so they resolve from the catalogue root.
    const resolve = await getTranslations();
    return badRequest(resolve(ref.key, ref.values));
  }
  const { targetType, targetId, reason, details, reporterEmail } = parsed.data;

  const headerList = await headers();
  const who = await clientKey(headerList);
  if (!(await rateLimitKey(who, "content_report", RATE_LIMITS.contentReport))) {
    return Response.json(
      { error: t("rateLimited") },
      { status: 429, headers: { "Retry-After": "3600" } },
    );
  }

  const target = await reportableTarget(targetType, targetId);
  if (!target) return accepted(t("accepted"));

  // Bound to the target, so the same person reporting two listings produces
  // two unrelated digests and this column cannot be used to follow someone
  // around the platform. See lib/moderation/reporter-hash.ts.
  const hash = await reporterHash(target.target_id, [
    who,
    headerList.get("user-agent"),
  ]);

  try {
    const admin = createAdminClient();
    const { error } = await admin.from("reports").insert({
      ...target,
      reason,
      details,
      reporter_hash: hash,
      ...(reporterEmail ? { reporter_email: reporterEmail } : {}),
    });
    if (error) {
      // 23505 is the per-reporter dedupe index doing its job. Indistinguishable
      // from a first report in the response, on purpose.
      if (error.code === "23505") return accepted(t("accepted"));
      console.error("[report] insert failed:", error.message);
      return Response.json({ error: t("submitFailed") }, { status: 503 });
    }
  } catch (err) {
    console.error(
      "[report] insert threw:",
      err instanceof Error ? err.message : String(err),
    );
    return Response.json({ error: t("submitFailed") }, { status: 503 });
  }

  // Staff are told now rather than at the admin panel's next scheduled scan.
  // After the response and unable to fail it: the notice is already recorded,
  // and the ping carries nothing about it (see lib/moderation/admin-ping.ts).
  // Only for a NEW row: the duplicate and unreportable branches above return
  // early, so a reporter hammering the button cannot turn this into a way to
  // hammer staff phones.
  after(pingAdminModeration);

  return accepted(t("accepted"));
}

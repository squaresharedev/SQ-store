import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { isSameOriginRequest } from "@/lib/security/same-origin";
import { readBoundedJson } from "@/lib/security/read-json";
import { uuidField } from "@/lib/validation/inputs";
import { REVIEW_IMPORT_CHECK_BODY_MAX, REVIEW_IMPORT_CHECK_IDS_MAX, REVIEW_IMPORT_ROWS_MAX } from "@/lib/reviews/limits";
import { importedReviewProducts, reviewsInStore } from "@/lib/reviews/import-existing";

/**
 * POST /api/sellers/import-reviews/check: which reviews in a file the store
 * already has, so the import page can say so before anything is sent.
 *
 * Body: `{ ids }`, the file's review fingerprints as every app
 * (lib/reviews/import.ts reviewFingerprints). Answers
 * `{ existing: [{ id, productId }] }`, and the page lays that over its own
 * product matching, so changing a match needs no second call.
 *
 * Or `{ reviewIds }`, the ids in this app's own export (lib/reviews/import.ts
 * readSquareShareExport). Answers `{ here }`, those that are this store's.
 *
 * ADVISORY. It reads only the active store's reviews and writes nothing; the
 * import route asks the same question again before it writes.
 */

const FINGERPRINT = /^[0-9a-f]{64}$/;
const reviewIdSchema = uuidField();

function reply(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request)) return reply({ ok: false, error: "forbidden" }, 403);
  const account = await getActiveAccount();
  if (!account) return reply({ ok: false, error: "unauthorized" }, 401);
  if (!can(account.role, "products.write")) return reply({ ok: false, error: "forbidden" }, 403);
  if (!(await rateLimit("review_import_check", RATE_LIMITS.reviewImportCheck))) {
    return reply({ ok: false, error: "rate_limited" }, 429);
  }

  const body = await readBoundedJson(request, REVIEW_IMPORT_CHECK_BODY_MAX);
  if (!body.ok) return reply({ ok: false, error: body.reason === "too_large" ? "too_large" : "invalid" }, 400);
  const { ids, reviewIds } = (body.value ?? {}) as Record<string, unknown>;

  if (reviewIds !== undefined) {
    if (
      !Array.isArray(reviewIds) ||
      reviewIds.length > REVIEW_IMPORT_ROWS_MAX ||
      !reviewIds.every((id) => reviewIdSchema.safeParse(id).success)
    ) {
      return reply({ ok: false, error: "invalid" }, 400);
    }
    const here = await reviewsInStore(account.accountId, reviewIds as string[]);
    if (!here) return reply({ ok: false, error: "failed" }, 503);
    return reply({ ok: true, here: [...here] }, 200);
  }

  if (
    !Array.isArray(ids) ||
    ids.length > REVIEW_IMPORT_CHECK_IDS_MAX ||
    !ids.every((id) => typeof id === "string" && FINGERPRINT.test(id))
  ) {
    return reply({ ok: false, error: "invalid" }, 400);
  }

  const found = await importedReviewProducts(account.accountId, ids as string[]);
  if (!found) return reply({ ok: false, error: "failed" }, 503);
  const existing = [...found].flatMap(([id, products]) => [...products].map((productId) => ({ id, productId })));
  return reply({ ok: true, existing }, 200);
}

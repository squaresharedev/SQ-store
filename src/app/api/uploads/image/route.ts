import { getTranslations } from "next-intl/server";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import {
  buildObjectKey,
  hasR2Credentials,
  putObject,
  r2FailureMessage,
} from "@/lib/r2";
import { IMAGE_CONTENT_TYPES, IMAGE_MAX_BYTES } from "@/lib/validation/product";
import { sniffImage } from "@/lib/uploads/sniff";
import { moderateUpload, QUARANTINE_PREFIX } from "@/lib/moderation";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";

/**
 * POST /api/uploads/image — upload a product display image THROUGH the server.
 *
 * WHY NOT A PRESIGNED BROWSER PUT (which is what this replaces):
 *
 *  1. It never worked anywhere but one origin. A cross-origin PUT to R2 needs
 *     the bucket's CORS allowlist to name the exact origin; ours listed only
 *     http://localhost:3000, so every other dev port and every deployed domain
 *     failed at preflight and the browser dropped the upload. Not one uploaded
 *     image had ever reached the database. A same-origin POST has no preflight
 *     to fail, so this cannot regress when a new origin appears.
 *  2. The bytes never passed through us, so nothing could inspect them. Content
 *     moderation is only possible at a point that holds the file — this route
 *     is that point (see lib/moderation).
 *  3. A presigned PUT can bind neither Content-Type nor Content-Length, so the
 *     type and size were whatever the client chose to send. Here we hold the
 *     bytes, so both are FACTS: size is measured and the type is sniffed from
 *     magic bytes.
 *
 * Digital files still use the presign route: at up to 200 MB they cannot be
 * buffered through a Worker. They are never displayed publicly and are only
 * released to a buyer after purchase, so they carry different risk.
 */

/** The one multipart field this route accepts. */
const FIELD = "image";

function bad(status: number, error: string, fix?: string) {
  return Response.json({ error, fix }, { status });
}

export async function POST(request: Request) {
  const t = await getTranslations("Errors.uploadRoute");
  const account = await getActiveAccount();
  if (!account) return bad(401, t("signIn.image"));
  if (!can(account.role, "products.write")) {
    return bad(403, t("permissionDenied"));
  }

  // Same budget as presigning: each call authorises bytes into R2. After the
  // permission checks, so a caller who may not upload never spends it.
  if (!(await rateLimit("upload_presign", RATE_LIMITS.uploadPresign))) {
    return bad(429, t("rateLimited.shared"));
  }

  if (!hasR2Credentials()) {
    console.error(
      "[uploads] R2 is not configured — set R2_ACCOUNT_ID, R2_BUCKET_NAME, " +
        "R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY in .env.local (see .env.example).",
    );
    return bad(503, t("notConfigured.image"));
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return bad(400, t("unreadable"), t("fix.tryAgain"));
  }

  // Unknown fields are a sign the caller is not our form; refuse rather than
  // ignore, so a future field can never be silently accepted.
  for (const key of form.keys()) {
    if (key !== FIELD) return bad(400, t("unexpectedFields"));
  }

  const file = form.get(FIELD);
  if (!(file instanceof File)) return bad(400, t("missing.image"));

  // Cheap rejection before reading the body into memory.
  if (file.size <= 0) return bad(400, t("empty.image"), t("fix.pickFile"));
  if (file.size > IMAGE_MAX_BYTES) {
    const maxMb = Math.round(IMAGE_MAX_BYTES / 1024 / 1024);
    return bad(
      413,
      t("tooLarge.image"),
      t("tooLargeFix.image", { maxMb }),
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  // The measured length is the one that counts: `file.size` is a claim in the
  // multipart headers, this is what we actually received.
  if (bytes.byteLength > IMAGE_MAX_BYTES || bytes.byteLength === 0) {
    return bad(413, t("tooLarge.image"));
  }

  // What the file IS, not what it says it is.
  const sniffed = sniffImage(bytes);
  const allowed: readonly string[] = IMAGE_CONTENT_TYPES;
  if (!sniffed || !allowed.includes(sniffed.mime)) {
    return bad(
      415,
      t("unsupported.image"),
      t("unsupportedFix.image"),
    );
  }

  // The moderation choke point. Before storage, with the real bytes in hand.
  let verdict;
  try {
    verdict = await moderateUpload({
      kind: "product-image",
      bytes,
      contentType: sniffed.mime,
      uploaderId: account.userId,
      accountId: account.accountId,
    });
  } catch (error) {
    // A moderation provider that is down must not silently publish content.
    console.error("[uploads] moderation failed", error);
    return bad(
      503,
      t("moderationUnavailable"),
      t("fix.tryAgainInAFewMinutes"),
    );
  }

  if (verdict.decision === "reject") {
    return bad(422, t(`moderationRejected.${verdict.code}`), t("fix.pickImage"));
  }

  const key = buildObjectKey("image", account.userId, file.name || `image.${sniffed.ext}`);

  if (verdict.decision === "review") {
    // Stored out of reach: the quarantine prefix can never satisfy
    // isOwnedObjectKey, so a held image cannot be attached to a product even
    // if the key leaked back to a client.
    try {
      await putObject(`${QUARANTINE_PREFIX}/${key}`, bytes, sniffed.mime);
    } catch (error) {
      console.error("[uploads] quarantine store failed:", r2FailureMessage(error));
    }
    // 202 Accepted: we took the file, but it yields no key, so the caller
    // cannot attach it to anything. The client treats "2xx without a key" as
    // not-usable-yet rather than success — see lib/products/upload.ts.
    return bad(
      202,
      t("inReview"),
      t("inReviewFix"),
    );
  }

  try {
    await putObject(key, bytes, sniffed.mime);
  } catch (error) {
    console.error("[uploads] store failed:", r2FailureMessage(error));
    return bad(502, t("storeFailed.image"), t("fix.tryAgainInAMoment"));
  }

  return Response.json({ key });
}

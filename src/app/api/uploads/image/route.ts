import { getTranslations } from "next-intl/server";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { hasR2Credentials } from "@/lib/r2";
import { IMAGE_MAX_BYTES } from "@/lib/validation/product";
import { storeImage } from "@/lib/uploads/store-image";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { declaredLengthExceeds } from "@/lib/security/read-json";

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
 *  2. The bytes never passed through us, so nothing could inspect them. This
 *     route holds the file, which is what lets it tell an animation from a
 *     still (see CONTENT MODERATION below).
 *  3. A presigned PUT can bind neither Content-Type nor Content-Length, so the
 *     type and size were whatever the client chose to send. Here we hold the
 *     bytes, so both are FACTS: size is measured and the type is sniffed from
 *     magic bytes.
 *
 * Digital files still use the presign route: at up to 200 MB they cannot be
 * buffered through a Worker. They are never displayed publicly and are only
 * released to a buyer after purchase, so they carry different risk.
 *
 * CONTENT MODERATION does not happen here. A photo is judged when the row
 * that uses it is saved: the moderation wall (20261012_auto_moderation,
 * lib/moderation/auto) keeps that row hidden until every image on it has been
 * approved, whichever route the image arrived by. What this route adds is the
 * one fact only the holder of the bytes knows: whether the classifier can see
 * the whole image. It is shown the first frame of an animation and cannot open
 * an AVIF, so those are recorded as needing a person before the key is handed
 * back.
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

  // Refuse an honest oversized body before formData() buffers it all.
  if (declaredLengthExceeds(request, IMAGE_MAX_BYTES)) {
    const maxMb = Math.round(IMAGE_MAX_BYTES / 1024 / 1024);
    return bad(413, t("tooLarge.image"), t("tooLargeFix.image", { maxMb }));
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

  // Real size check: the body is already buffered here. The declared-length
  // check above is what saves the read for an honest oversized caller.
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

  // What the file IS, not what it says it is, and the moderation hold: one
  // place for both, shared with an assistant's upload_image.
  const stored = await storeImage(bytes, file.name, account.userId);
  if (!stored.ok) {
    switch (stored.reason) {
      case "empty":
      case "too_large":
        return bad(413, t("tooLarge.image"));
      case "unsupported":
        return bad(415, t("unsupported.image"), t("unsupportedFix.image"));
      case "store_failed":
        return bad(502, t("storeFailed.image"), t("fix.tryAgainInAMoment"));
      case "moderation_unavailable":
        return bad(503, t("moderationUnavailable"), t("fix.tryAgainInAFewMinutes"));
    }
  }

  return Response.json({ key: stored.key });
}

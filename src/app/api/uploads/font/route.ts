import { getTranslations } from "next-intl/server";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { hasR2Credentials } from "@/lib/r2";
import { FONT_MAX_BYTES } from "@/lib/validation/product";
import { storeFont } from "@/lib/uploads/store-font";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { isSameOriginRequest } from "@/lib/security/same-origin";
import { declaredLengthExceeds } from "@/lib/security/read-json";

/**
 * POST /api/uploads/font: upload a storefront's own typeface THROUGH the
 * server, same shape as the image route (same origin, so no CORS preflight to
 * get wrong; bytes in hand, so the type and size are facts rather than claims).
 *
 * WHY THIS IS NOT THE IMAGE ROUTE WITH A WIDER ALLOWLIST: the two differ in
 * every check that matters. A font is gated on `storefront.write` (it is
 * storefront chrome, not catalogue content), capped an order of magnitude
 * tighter (FONT_MAX_BYTES, because this file is fetched by every buyer), and sniffed
 * against sfnt/WOFF headers rather than image ones. It also does NOT go through
 * content moderation: that classifier reads pictures, and a font carries none.
 * What protects the buyer here is the format check plus the size cap.
 */

/** The one multipart field this route accepts. */
const FIELD = "font";

function bad(status: number, error: string, fix?: string) {
  return Response.json({ error, fix }, { status });
}

export async function POST(request: Request) {
  const t = await getTranslations("Errors.uploadRoute");
  // A multipart POST needs no preflight, so a page on a sibling squareshare.eu
  // site would arrive with the seller's cookie. Only our own pages upload.
  if (!isSameOriginRequest(request)) return bad(403, t("permissionDenied"));
  const account = await getActiveAccount();
  if (!account) return bad(401, t("signIn.font"));
  if (!can(account.role, "storefront.write")) {
    return bad(403, t("permissionDenied"));
  }

  // Same budget as every other route that authorises bytes into R2, and taken
  // after the permission checks so a caller who may not upload never spends it.
  if (!(await rateLimit("upload_presign", RATE_LIMITS.uploadPresign))) {
    return bad(429, t("rateLimited.shared"));
  }

  if (!hasR2Credentials()) {
    console.error(
      "[uploads] R2 is not configured: set R2_ACCOUNT_ID, R2_BUCKET_NAME, " +
        "R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY in .env.local (see .env.example).",
    );
    return bad(503, t("notConfigured.font"));
  }

  // Refuse an honest oversized body before formData() buffers it all.
  if (declaredLengthExceeds(request, FONT_MAX_BYTES)) {
    const maxMb = Math.round(FONT_MAX_BYTES / 1024 / 1024);
    return bad(413, t("tooLarge.font"), t("tooLargeFix.font", { maxMb }));
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
  if (!(file instanceof File)) return bad(400, t("missing.font"));

  // Real size check: the body is already buffered here. The declared-length
  // check above is what saves the read for an honest oversized caller.
  if (file.size <= 0) return bad(400, t("empty.font"), t("fix.pickFile"));
  const maxMb = Math.round(FONT_MAX_BYTES / 1024 / 1024);
  if (file.size > FONT_MAX_BYTES) {
    return bad(
      413,
      t("tooLarge.font"),
      t("tooLargeFix.font", { maxMb }),
    );
  }

  // What the file IS, not what it says it is, measured on the bytes we
  // actually received (`file.size` is a claim in the multipart headers): one
  // function, shared with an assistant's upload_font.
  const stored = await storeFont(new Uint8Array(await file.arrayBuffer()), file.name, account.userId);
  if (!stored.ok) {
    switch (stored.reason) {
      case "empty":
      case "too_large":
        return bad(413, t("tooLarge.font"));
      case "unsupported":
        return bad(415, t("unsupported.font"), t("unsupportedFix.font"));
      case "store_failed":
        return bad(502, t("storeFailed.font"), t("fix.tryAgainInAMoment"));
    }
  }

  return Response.json({ key: stored.key });
}

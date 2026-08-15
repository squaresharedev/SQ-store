import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { buildObjectKey, hasR2Credentials, putObject } from "@/lib/r2";
import { FONT_CONTENT_TYPES, FONT_MAX_BYTES } from "@/lib/validation/product";
import { sniffFont } from "@/lib/uploads/sniff";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";

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
  const account = await getActiveAccount();
  if (!account) return bad(401, "Sign in to upload fonts.");
  if (!can(account.role, "storefront.write")) {
    return bad(403, "You don't have permission to upload here.");
  }

  // Same budget as every other route that authorises bytes into R2, and taken
  // after the permission checks so a caller who may not upload never spends it.
  if (!(await rateLimit("upload_presign", RATE_LIMITS.uploadPresign))) {
    return bad(429, "Too many uploads right now. Try again shortly.");
  }

  if (!hasR2Credentials()) {
    console.error(
      "[uploads] R2 is not configured: set R2_ACCOUNT_ID, R2_BUCKET_NAME, " +
        "R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY in .env.local (see .env.example).",
    );
    return bad(503, "Font uploads are not configured yet. Contact the site owner.");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return bad(400, "That upload could not be read.", "Try again.");
  }

  // Unknown fields are a sign the caller is not our form; refuse rather than
  // ignore, so a future field can never be silently accepted.
  for (const key of form.keys()) {
    if (key !== FIELD) return bad(400, "Unexpected upload fields.");
  }

  const file = form.get(FIELD);
  if (!(file instanceof File)) return bad(400, "No font was uploaded.");

  // Cheap rejection before reading the body into memory.
  if (file.size <= 0) return bad(400, "That font file is empty.", "Pick a different file.");
  const maxMb = Math.round(FONT_MAX_BYTES / 1024 / 1024);
  if (file.size > FONT_MAX_BYTES) {
    return bad(
      413,
      "That font file is too large.",
      `Use a font under ${maxMb} MB. A WOFF2 is usually well under 100 KB.`,
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  // The measured length is the one that counts: `file.size` is a claim in the
  // multipart headers, this is what we actually received.
  if (bytes.byteLength > FONT_MAX_BYTES || bytes.byteLength === 0) {
    return bad(413, "That font file is too large.");
  }

  // What the file IS, not what it says it is.
  const sniffed = sniffFont(bytes);
  const allowed: readonly string[] = FONT_CONTENT_TYPES;
  if (!sniffed || !allowed.includes(sniffed.mime)) {
    return bad(
      415,
      "That file is not a supported font.",
      "Use a WOFF2, WOFF, TTF, or OTF file.",
    );
  }

  const key = buildObjectKey("font", account.userId, file.name || `font.${sniffed.ext}`);
  try {
    await putObject(key, bytes, sniffed.mime);
  } catch (error) {
    console.error("[uploads] font store failed", error);
    return bad(502, "The font could not be stored.", "Try again in a moment.");
  }

  return Response.json({ key });
}

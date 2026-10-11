import { getTranslations } from "next-intl/server";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { buildObjectKey, deleteObject, hasR2Credentials, putObject } from "@/lib/r2";
import {
  ELEMENT_CONTENT_TYPES,
  ELEMENT_MAX_BYTES,
} from "@/lib/validation/product";
import { classifierCanSee, sniffImage, sniffSvg } from "@/lib/uploads/sniff";
import { holdForPerson } from "@/lib/moderation/auto/check";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";

/**
 * POST /api/uploads/element — upload a seller's own artwork for the storefront
 * canvas: a logo, an icon, a graphic. Same shape as the image and font routes
 * (same-origin, so no CORS preflight to get wrong; bytes in hand, so type and
 * size are facts rather than claims).
 *
 * WHY THIS IS NOT THE IMAGE ROUTE WITH A WIDER ALLOWLIST — the reason matters,
 * because this is the ONLY route in the app that accepts markup:
 *
 *  1. DIFFERENT PERMISSION. An element is storefront chrome, not catalogue
 *     content, so it is gated on `storefront.write` like a font — not on
 *     `products.write`, which is what the image route hardcodes.
 *  2. DIFFERENT PREFIX. Elements land under `elements/`, so `isOwnedObjectKey`
 *     keeps them structurally distinct from product photos. An SVG can never be
 *     linked as a product image or a background, and a product photo can never
 *     be rendered as an element.
 *  3. DIFFERENT CAP. ELEMENT_MAX_BYTES is an order of magnitude tighter than a
 *     product photo's: every buyer who loads the storefront fetches this.
 *  4. DIFFERENT SNIFFER. SVG has no magic number, so `sniffSvg` reads the
 *     document and refuses anything carrying script, event handlers, external
 *     references or entity declarations.
 *
 * CONTENT MODERATION does not happen here: artwork is judged when the
 * storefront that uses it is saved (the moderation wall, lib/moderation/auto).
 * AN SVG IS ALWAYS HELD FOR A PERSON. The classifier reads pixels, and markup
 * shown to it produces noise rather than a verdict, so this route records an
 * SVG (and an animation or AVIF, as the image route does) as something only a
 * person can approve. `sniffSvg` is still what keeps the file inert.
 */

/** The one multipart field this route accepts. */
const FIELD = "element";

function bad(status: number, error: string, fix?: string) {
  return Response.json({ error, fix }, { status });
}

export async function POST(request: Request) {
  const t = await getTranslations("Errors.uploadRoute");
  const account = await getActiveAccount();
  if (!account) return bad(401, t("signIn.element"));
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
    return bad(503, t("notConfigured.element"));
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
  if (file.size <= 0) return bad(400, t("empty.file"), t("fix.pickFile"));
  const maxMb = Math.round(ELEMENT_MAX_BYTES / 1024 / 1024);
  if (file.size > ELEMENT_MAX_BYTES) {
    return bad(
      413,
      t("tooLarge.image"),
      t("tooLargeFix.image", { maxMb }),
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  // The measured length is the one that counts: `file.size` is a claim in the
  // multipart headers, this is what we actually received.
  if (bytes.byteLength > ELEMENT_MAX_BYTES || bytes.byteLength === 0) {
    return bad(413, t("tooLarge.image"));
  }

  // What the file IS, not what it says it is. SVG first: it is the only kind
  // with no magic number, so it has to be identified by structure, and a file
  // that is not one falls through to the raster signatures.
  const svg = sniffSvg(bytes);
  const sniffed = svg ?? sniffImage(bytes);
  const allowed: readonly string[] = ELEMENT_CONTENT_TYPES;
  if (!sniffed || !allowed.includes(sniffed.mime)) {
    // The fix deliberately names the SVG rules: "not supported" alone would
    // read as a format problem when the usual cause is an export carrying script.
    return bad(415, t("unsupported.image"), t("unsupportedFix.element"));
  }

  const key = buildObjectKey(
    "element",
    account.userId,
    file.name || `element.${sniffed.ext}`,
  );

  try {
    // `attachment` on SVG only: it changes nothing about how an `<img>` loads
    // the artwork, and makes a presigned URL opened directly in a tab download
    // rather than render as a document. See putObject.
    await putObject(
      key,
      bytes,
      sniffed.mime,
      svg ? "attachment" : undefined,
    );
  } catch (error) {
    console.error("[uploads] element store failed", error);
    return bad(502, t("storeFailed.image"), t("fix.tryAgainInAMoment"));
  }

  // Markup, and any raster the classifier cannot fully see, goes to a person.
  // Unrecorded, it would be judged on what a classifier could make of it, so
  // an upload whose hold cannot be written is refused.
  if ((svg || !classifierCanSee(bytes, sniffed.mime)) && !(await holdForPerson(key))) {
    await deleteObject(key).catch(() => {});
    return bad(503, t("moderationUnavailable"), t("fix.tryAgainInAFewMinutes"));
  }

  return Response.json({ key });
}

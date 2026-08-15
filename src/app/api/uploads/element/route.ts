import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { buildObjectKey, hasR2Credentials, putObject } from "@/lib/r2";
import {
  ELEMENT_CONTENT_TYPES,
  ELEMENT_MAX_BYTES,
} from "@/lib/validation/product";
import { sniffImage, sniffSvg } from "@/lib/uploads/sniff";
import { moderateUpload, QUARANTINE_PREFIX } from "@/lib/moderation";
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
 * SVG SKIPS CONTENT MODERATION, and rasters do not. The classifier is a vision
 * model: it reads pixels, and handing it markup produces noise rather than a
 * verdict. `sniffSvg` is that path's gate. Rasters are ordinary pictures and go
 * through `moderateUpload` exactly like a product photo, fail-closed.
 */

/** The one multipart field this route accepts. */
const FIELD = "element";

function bad(status: number, error: string, fix?: string) {
  return Response.json({ error, fix }, { status });
}

/** What a seller is told when the bytes are neither a raster nor a safe SVG.
 *  Deliberately names the SVG rules: "not supported" alone would read as a
 *  format problem when the usual cause is an export carrying script. */
const WRONG_TYPE_FIX =
  "Use a PNG, JPEG, WebP, GIF, AVIF, or an SVG with no scripts, " +
  "external links, or embedded images.";

export async function POST(request: Request) {
  const account = await getActiveAccount();
  if (!account) return bad(401, "Sign in to upload elements.");
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
    return bad(503, "Element uploads are not configured yet. Contact the site owner.");
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
  if (!(file instanceof File)) return bad(400, "No image was uploaded.");

  // Cheap rejection before reading the body into memory.
  if (file.size <= 0) return bad(400, "That file is empty.", "Pick a different file.");
  const maxMb = Math.round(ELEMENT_MAX_BYTES / 1024 / 1024);
  if (file.size > ELEMENT_MAX_BYTES) {
    return bad(
      413,
      "That image is too large.",
      `Use an image under ${maxMb} MB. Compress or resize it, then try again.`,
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  // The measured length is the one that counts: `file.size` is a claim in the
  // multipart headers, this is what we actually received.
  if (bytes.byteLength > ELEMENT_MAX_BYTES || bytes.byteLength === 0) {
    return bad(413, "That image is too large.");
  }

  // What the file IS, not what it says it is. SVG first: it is the only kind
  // with no magic number, so it has to be identified by structure, and a file
  // that is not one falls through to the raster signatures.
  const svg = sniffSvg(bytes);
  const sniffed = svg ?? sniffImage(bytes);
  const allowed: readonly string[] = ELEMENT_CONTENT_TYPES;
  if (!sniffed || !allowed.includes(sniffed.mime)) {
    return bad(415, "That file is not a supported image.", WRONG_TYPE_FIX);
  }

  const key = buildObjectKey(
    "element",
    account.userId,
    file.name || `element.${sniffed.ext}`,
  );

  // Rasters only — see the header for why a vision classifier has nothing to
  // say about markup.
  if (!svg) {
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
      console.error("[uploads] element moderation failed", error);
      return bad(
        503,
        "Images can't be checked right now.",
        "Try again in a few minutes.",
      );
    }

    if (verdict.decision === "reject") {
      return bad(422, verdict.reason, "Pick a different image.");
    }

    if (verdict.decision === "review") {
      // Stored out of reach: the quarantine prefix can never satisfy
      // isOwnedObjectKey, so a held image cannot be attached to a storefront
      // even if the key leaked back to a client.
      try {
        await putObject(`${QUARANTINE_PREFIX}/${key}`, bytes, sniffed.mime);
      } catch (error) {
        console.error("[uploads] element quarantine store failed", error);
      }
      // 202 Accepted: we took the file, but it yields no key, so the caller
      // cannot attach it to anything.
      return bad(
        202,
        "That image is being checked before it goes live.",
        "You'll be able to use it once it's approved.",
      );
    }
  }

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
    return bad(502, "The image could not be stored.", "Try again in a moment.");
  }

  return Response.json({ key });
}

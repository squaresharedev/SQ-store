// SERVER ONLY. The uploads a storefront config links to, and the rules every
// writer of that config shares: the designer's save (actions.ts) and the page
// settings routes (page-config-route.ts, the API a future agent holds). One
// copy of "is this key really theirs, and really an image" and of "clean up
// what was let go", so the two writers cannot disagree about either.
//
// A config stores only an R2 object KEY. A key that differs from the one
// already saved must be a NEW upload by this user: ownership is enforced and
// the stored object's real size and type are re-checked (upload-time checks
// alone are not a boundary), and objects a save lets go of are evicted.

import { deleteObject, headObject } from "@/lib/r2";
import {
  uploadFailed,
  invalidInput,
  serverError,
  type ActionError,
  type ServerErrorOperation,
} from "@/lib/errors";
import { msg } from "@/i18n/types";
import {
  isAllowedContentType,
  isOwnedObjectKey,
  maxBytesForKind,
  type UploadKind,
} from "@/lib/validation/product";

/** Best-effort R2 cleanup: never fails the parent operation. */
export async function evictObject(key: string): Promise<void> {
  await deleteObject(key).catch((error) =>
    console.warn("[storefront] failed to evict object", key, error),
  );
}

/** Where each verifiable upload's copy lives (Errors.storefront.upload.*) and
 *  which operation a failed check names. Keeps {@link verifyUpload} one
 *  function rather than copies that drift. */
const UPLOAD_COPY = {
  image: { copy: "backgroundImage", verify: "verifyBackgroundImage" },
  font: { copy: "font", verify: "verifyFont" },
  element: { copy: "element", verify: "verifyImage" },
} as const satisfies Partial<
  Record<UploadKind, { copy: string; verify: ServerErrorOperation }>
>;

/**
 * Post-upload boundary for a NEW object key on a config, mirroring the product
 * image rules: the key must be one this user uploaded, and the stored object's
 * REAL size and type are checked via HEAD. Anything oversized or of the wrong
 * type is evicted and never linked to a config.
 */
export async function verifyUpload(
  key: string,
  kind: keyof typeof UPLOAD_COPY,
  uploaderId: string,
): Promise<{ ok: true } | { ok: false; error: ActionError }> {
  const { copy, verify } = UPLOAD_COPY[kind];
  const missingFix = msg(`Errors.storefront.upload.${copy}.missingFix`);
  if (!isOwnedObjectKey(key, kind, uploaderId)) {
    return {
      ok: false,
      error: invalidInput(msg(`Errors.storefront.upload.${copy}.notOwned`), missingFix),
    };
  }

  let meta;
  try {
    meta = await headObject(key);
  } catch (error) {
    console.error(`[storefront] ${kind} verification failed`, error);
    return { ok: false, error: serverError(verify) };
  }
  if (!meta) {
    return {
      ok: false,
      error: uploadFailed(msg(`Errors.storefront.upload.${copy}.unfinished`), missingFix),
    };
  }
  const tooBig =
    !Number.isFinite(meta.size) ||
    meta.size <= 0 ||
    meta.size > maxBytesForKind(kind);
  const wrongType = !isAllowedContentType(kind, meta.contentType);
  if (tooBig || wrongType) {
    await evictObject(key);
    return {
      ok: false,
      error: tooBig
        ? uploadFailed(
            msg(`Errors.storefront.upload.${copy}.tooLarge`),
            msg(`Errors.storefront.upload.${copy}.tooLargeFix`),
          )
        : uploadFailed(
            msg("Errors.upload.typeNotSupported"),
            msg(`Errors.storefront.upload.${copy}.wrongTypeFix`),
          ),
    };
  }
  return { ok: true };
}

/**
 * The photos the hosted pages hold as their backdrop, inside a stored
 * (untrusted) config jsonb: the product page's and the checkout's (which the
 * thank-you page shares). Read field by field, because this runs against
 * whatever is already in the column.
 */
export function storedPagePhotoKeys(config: unknown): Set<string> {
  const keys = new Set<string>();
  if (typeof config !== "object" || config === null) return keys;
  for (const member of ["productPage", "checkoutPage"] as const) {
    const photo = (config as Record<string, { backgroundImage?: { key?: unknown } } | undefined>)[member]
      ?.backgroundImage;
    if (typeof photo?.key === "string") keys.add(photo.key);
  }
  return keys;
}

/**
 * Settle a write's page photos against what was stored: verify each key that
 * is new to this storefront (ownership, real size, real type), and report the
 * keys the write lets go of. Eviction is the caller's, AFTER the row is saved,
 * so a refused or failed save never costs a seller the photo they still have.
 */
export async function settlePagePhotos(
  previousConfig: unknown,
  nextConfig: unknown,
  uploaderId: string,
): Promise<{ ok: true; released: string[] } | { ok: false; error: ActionError }> {
  const previous = storedPagePhotoKeys(previousConfig);
  const next = storedPagePhotoKeys(nextConfig);
  for (const key of next) {
    if (previous.has(key)) continue;
    const verified = await verifyUpload(key, "image", uploaderId);
    if (!verified.ok) return verified;
  }
  return { ok: true, released: [...previous].filter((key) => !next.has(key)) };
}

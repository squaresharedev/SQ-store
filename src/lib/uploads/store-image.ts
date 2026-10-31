import { buildObjectKey, deleteObject, putObject, r2FailureMessage } from "@/lib/r2";
import { holdForPerson } from "@/lib/moderation/auto/check";
import { classifierCanSee, sniffImage } from "@/lib/uploads/sniff";
import { IMAGE_CONTENT_TYPES, IMAGE_MAX_BYTES } from "@/lib/validation/product";

/**
 * Storing a product image, once, for everything that accepts one: the upload
 * route and an assistant's upload_image tool. What the bytes ARE decides whether
 * they are stored, and an image the automatic check cannot fully see (an
 * animation) is held for a person, so neither door is a way around that.
 */
export type StoreImageResult =
  | { ok: true; key: string }
  | { ok: false; reason: "empty" | "too_large" | "unsupported" | "store_failed" | "moderation_unavailable" };

export async function storeImage(
  bytes: Uint8Array<ArrayBuffer>,
  filename: string | undefined,
  uploaderId: string,
): Promise<StoreImageResult> {
  if (bytes.byteLength === 0) return { ok: false, reason: "empty" };
  if (bytes.byteLength > IMAGE_MAX_BYTES) return { ok: false, reason: "too_large" };

  const sniffed = sniffImage(bytes);
  const allowed: readonly string[] = IMAGE_CONTENT_TYPES;
  if (!sniffed || !allowed.includes(sniffed.mime)) return { ok: false, reason: "unsupported" };

  const key = buildObjectKey("image", uploaderId, filename || `image.${sniffed.ext}`);
  try {
    await putObject(key, bytes, sniffed.mime);
  } catch (error) {
    console.error("[uploads] store failed:", r2FailureMessage(error));
    return { ok: false, reason: "store_failed" };
  }

  // Left unflagged, an animation would be approved on the strength of its first
  // frame, so if the hold cannot be recorded the upload is refused.
  if (!classifierCanSee(bytes, sniffed.mime) && !(await holdForPerson(key))) {
    await deleteObject(key).catch(() => {});
    return { ok: false, reason: "moderation_unavailable" };
  }
  return { ok: true, key };
}

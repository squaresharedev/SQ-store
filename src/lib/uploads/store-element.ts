import { buildObjectKey, deleteObject, putObject } from "@/lib/r2";
import { holdForPerson } from "@/lib/moderation/auto/check";
import { classifierCanSee, sniffImage, sniffSvg } from "@/lib/uploads/sniff";
import { ELEMENT_CONTENT_TYPES, ELEMENT_MAX_BYTES } from "@/lib/validation/product";

/**
 * Storing a seller's artwork for the canvas, once, for everything that accepts
 * one: the upload route and an assistant's upload_element tool. What the bytes
 * ARE decides whether they are stored. SVG is the only markup this app takes, so
 * sniffSvg refuses anything active in it, and an SVG (or an image the classifier
 * cannot fully see) is held for a person, so neither door is a way around that.
 */
export type StoreElementResult =
  | { ok: true; key: string }
  | { ok: false; reason: "empty" | "too_large" | "unsupported" | "store_failed" | "moderation_unavailable" };

export async function storeElement(
  bytes: Uint8Array<ArrayBuffer>,
  filename: string | undefined,
  uploaderId: string,
): Promise<StoreElementResult> {
  if (bytes.byteLength === 0) return { ok: false, reason: "empty" };
  // The measured length is the one that counts: a declared size is a claim.
  if (bytes.byteLength > ELEMENT_MAX_BYTES) return { ok: false, reason: "too_large" };

  // SVG first: it is the only kind with no magic number, so it has to be
  // identified by structure, and a file that is not one falls through to the
  // raster signatures.
  const svg = sniffSvg(bytes);
  const sniffed = svg ?? sniffImage(bytes);
  const allowed: readonly string[] = ELEMENT_CONTENT_TYPES;
  if (!sniffed || !allowed.includes(sniffed.mime)) return { ok: false, reason: "unsupported" };

  const key = buildObjectKey("element", uploaderId, filename || `element.${sniffed.ext}`);
  try {
    // `attachment` on SVG only: it changes nothing about how an `<img>` loads
    // the artwork, and makes a presigned URL opened directly in a tab download
    // rather than render as a document. See putObject.
    await putObject(key, bytes, sniffed.mime, svg ? "attachment" : undefined);
  } catch (error) {
    console.error("[uploads] element store failed", error);
    return { ok: false, reason: "store_failed" };
  }

  // Markup, and any raster the classifier cannot fully see, goes to a person.
  // Unrecorded, it would be judged on what a classifier could make of it, so
  // an upload whose hold cannot be written is refused.
  if ((svg || !classifierCanSee(bytes, sniffed.mime)) && !(await holdForPerson(key))) {
    await deleteObject(key).catch(() => {});
    return { ok: false, reason: "moderation_unavailable" };
  }
  return { ok: true, key };
}

import { isAwaitingCheck, takedownKind } from "@/lib/moderation/removal";
import { parseGallery } from "@/lib/products/detail";
import { getObject } from "@/lib/r2";
import { createClient } from "@/lib/supabase/server";
import { storeElement } from "@/lib/uploads/store-element";
import { storeImage } from "@/lib/uploads/store-image";
import { ELEMENT_MAX_BYTES, IMAGE_MAX_BYTES, OBJECT_KEY_PATTERN, objectKeyPrefix } from "@/lib/validation/product";

/**
 * A STORE'S OWN PRODUCT PHOTO, ON ONE OF ITS STOREFRONTS, without an upload.
 *
 * An assistant only ever sees a product photo as a signed link that expires
 * within hours, so placing one as artwork used to mean fetching it and
 * uploading it again. This copies it instead, server side, under the prefix
 * the place it is going to demands: `elements/` for an image block (artwork),
 * `images/` for a band's or the board's photo. The copy is the caller's own
 * new upload, never a second reference to the product's file, so saving or
 * deleting either never touches the other, and saveStorefront's checks
 * (verifyUpload: the uploader's key, its real size and type) pass exactly as
 * for a file the seller uploaded.
 *
 * Who may: the photo is read through the product row under row level
 * security AND the store's owner id, so only this store's products are found;
 * a product taken down or paused is refused, so a takedown cannot be walked
 * around by turning its photo into artwork. The bytes then go through the same
 * function the upload routes use (storeElement, storeImage): the same type
 * sniffing, size cap and moderation hold. Never takes a key or a URL from the
 * assistant: a product id and which of its photos.
 */

/** What the copy is for: artwork for add_image, or a photo for a background. */
export const PRODUCT_PHOTO_USES = ["artwork", "photo"] as const;
export type ProductPhotoUse = (typeof PRODUCT_PHOTO_USES)[number];

export type CopiedPhoto =
  | { ok: true; key: string }
  | {
      ok: false;
      reason:
        | "no_product"
        | "taken_down"
        | "no_photo"
        | "not_copyable"
        | "too_large"
        | "unsupported"
        | "unavailable";
      /** How many photos the product has, for "no_photo". */
      photos?: number;
    };

/** The prefix, the cap and the storing function for each use. */
const USES = {
  artwork: { maxBytes: ELEMENT_MAX_BYTES, store: storeElement },
  photo: { maxBytes: IMAGE_MAX_BYTES, store: storeImage },
} as const;

/** The photo keys of a product, main photo first, then the gallery in order. */
function photoKeys(row: { image_key: string | null; gallery: unknown }): string[] {
  return [...(row.image_key ? [row.image_key] : []), ...parseGallery(row.gallery).map((image) => image.key)];
}

/** The file name a copy carries: the original's, without its key's two ids. */
function nameOf(key: string): string {
  const last = key.slice(key.lastIndexOf("/") + 1);
  return last.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/, "");
}

export async function copyProductPhoto(input: {
  productId: string;
  /** 0 is the main photo; 1 and on, the gallery in the seller's order. */
  photo: number;
  use: ProductPhotoUse;
  accountId: string;
  /** Who the copy is uploaded as: the person behind the grant. */
  uploaderId: string;
}): Promise<CopiedPhoto> {
  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("products")
    .select("id, image_key, gallery, moderation_status")
    .eq("id", input.productId)
    .eq("owner_id", input.accountId)
    .maybeSingle();
  if (error) throw new Error(`Reading a product photo failed: ${error.message}`);
  if (!row) return { ok: false, reason: "no_product" };
  // Only a decision AGAINST the product refuses: one still waiting on its
  // check is copied, and the copy is judged afresh when the storefront using
  // it is saved (the moderation wall reads every image on the row).
  const takedown = takedownKind(row.moderation_status);
  if (takedown && !isAwaitingCheck(takedown)) return { ok: false, reason: "taken_down" };

  const keys = photoKeys(row);
  const key = keys[input.photo];
  if (key === undefined) return { ok: false, reason: "no_photo", photos: keys.length };
  // A product photo is always under images/. Anything else (a seed script's
  // stock-photo address) is not a file of ours to copy.
  if (!OBJECT_KEY_PATTERN.test(key) || !key.startsWith(`${objectKeyPrefix("image")}/`)) {
    return { ok: false, reason: "not_copyable" };
  }

  const use = USES[input.use];
  const read = await getObject(key, use.maxBytes);
  if (!read.ok) return { ok: false, reason: read.reason === "too_large" ? "too_large" : "not_copyable" };

  const stored = await use.store(read.bytes, nameOf(key), input.uploaderId);
  if (stored.ok) return { ok: true, key: stored.key };
  switch (stored.reason) {
    case "too_large":
      return { ok: false, reason: "too_large" };
    case "empty":
    case "unsupported":
      return { ok: false, reason: "unsupported" };
    default:
      return { ok: false, reason: "unavailable" };
  }
}

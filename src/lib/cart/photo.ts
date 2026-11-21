// SERVER ONLY. One line's photo, for the cart and the checkout's lines.

import { presignGetUrl } from "@/lib/r2";
import { parseGallery } from "@/lib/products/detail";
import type { PurchasableItem } from "@/lib/products/purchasable";
import type { ProductPageImage } from "@/types/product";

/** The photo the seller tied to the chosen version, else the cover. One
 *  signed photo per line (never the whole gallery): what a cart or a
 *  checkout's line shows. */
export async function linePhoto(item: PurchasableItem, optionIds: readonly string[]): Promise<ProductPageImage | null> {
  const tied = parseGallery(item.row.gallery).find(
    (photo) => photo.optionId !== undefined && optionIds.includes(photo.optionId),
  );
  const key = tied?.key ?? item.row.image_key;
  if (!key) return null;
  const url = await presignGetUrl(key);
  return url ? { url, alt: tied?.alt || item.row.title } : null;
}

import { parseGallery, parseOptionGroups } from "@/lib/products/detail";
import type { OrderSelection } from "@/types/order-view";

/**
 * The R2 key of the photo to show for an order: the bought version's own photo
 * when the product has one, else the cover. Null when the product has neither.
 * Shared by the buyer's order page and the seller's Recent orders thumbnails so
 * both always agree on which picture an order is.
 */
export function orderPhotoKey(
  product: { image_key: string | null; gallery: unknown; option_groups: unknown },
  selection: OrderSelection[],
): string | null {
  const groups = parseOptionGroups(product.option_groups);
  const chosen = new Set(
    groups.flatMap((group) =>
      group.options
        .filter((option) => selection.some((row) => row.label === group.name && row.value === option.name))
        .map((option) => option.id),
    ),
  );
  const own = parseGallery(product.gallery).find((image) => image.optionId && chosen.has(image.optionId));
  return own?.key ?? product.image_key ?? null;
}

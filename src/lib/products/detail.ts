import { z } from "zod";
import {
  collectOptionIds,
  documentSchema,
  galleryImageSchema,
  optionGroupSchema,
  productDetailsSchema,
  productOptionSchema,
} from "@/lib/validation/product";
import {
  DOCUMENTS_MAX,
  GALLERY_MAX,
  OPTION_GROUPS_MAX,
  OPTIONS_PER_GROUP_MAX,
  type GalleryImage,
  type ProductDetails,
  type ProductDocument,
  type ProductOptionGroup,
} from "@/types/product";

// Reading the product-page jsonb columns back off a row. Every write goes
// through productWriteSchema, but a row can predate the columns (defaults),
// be written by the service role (seed scripts, tests) or be edited by hand,
// so the read side re-parses and degrades to EMPTY rather than throwing: a
// malformed blob costs the seller a gallery, never the product.
//
// THE LISTS ARE CAPPED HERE TOO, not only on write. The public product page
// presigns one URL per photo and per document (an HMAC each) for anyone who
// opens it, so the length of these arrays is work an anonymous request can
// ask for. A write can never exceed the caps, but a service-role seed or a
// hand-edited row can, and truncating on the way out means the page's cost is
// bounded by the schema rather than by whatever is in the column. Truncate
// rather than reject: an over-long list should cost the extra entries, not the
// whole gallery.
//
// Client-safe: only Zod and types.

const galleryListSchema = z.array(galleryImageSchema);
const documentListSchema = z.array(documentSchema);

/**
 * The write schema's group, minus the per-group option cap.
 *
 * Same bargain as the lists above: a write can never exceed the cap, but a
 * seed or a hand-edited row can, and rejecting the whole tree over it would
 * cost the seller every option rather than the extra ones. The cap is applied
 * by slicing below, so what an anonymous page load pays for is still bounded
 * by the schema.
 */
const optionGroupListSchema = z.array(
  optionGroupSchema.extend({ options: z.array(productOptionSchema).min(1) }),
);

export function parseGallery(raw: unknown): GalleryImage[] {
  const parsed = galleryListSchema.safeParse(raw);
  return parsed.success ? parsed.data.slice(0, GALLERY_MAX) : [];
}

export function parseOptionGroups(raw: unknown): ProductOptionGroup[] {
  const parsed = optionGroupListSchema.safeParse(raw);
  if (!parsed.success) return [];
  // Duplicate ids cannot be written, but a hand-edited row could carry them;
  // keep the first, so an id still names exactly one thing and a photo tie
  // still resolves. Trimming to the caps for the same reason parseGallery
  // does: the page's cost has to be bounded by the schema, not by the column.
  const seen = new Set<string>();
  const groups: ProductOptionGroup[] = [];
  for (const group of parsed.data.slice(0, OPTION_GROUPS_MAX)) {
    if (seen.has(group.id)) continue;
    seen.add(group.id);
    const options = [];
    for (const option of group.options.slice(0, OPTIONS_PER_GROUP_MAX)) {
      if (seen.has(option.id)) continue;
      seen.add(option.id);
      options.push(option);
    }
    // A group whose every option was a duplicate has nothing left to pick.
    if (options.length > 0) groups.push({ ...group, options });
  }
  return groups;
}

export function parseDetails(raw: unknown): ProductDetails {
  const parsed = productDetailsSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

export function parseDocuments(raw: unknown): ProductDocument[] {
  const parsed = documentListSchema.safeParse(raw);
  return parsed.success ? parsed.data.slice(0, DOCUMENTS_MAX) : [];
}

/** Drop a photo's option tie when that option no longer exists, so a stale
 *  reference hides nothing: the photo simply shows whatever is picked. */
export function reconcileGalleryOptions(
  gallery: GalleryImage[],
  optionGroups: ProductOptionGroup[],
): GalleryImage[] {
  const ids = collectOptionIds(optionGroups);
  return gallery.map((image) =>
    image.optionId && !ids.has(image.optionId)
      ? { key: image.key, alt: image.alt }
      : image,
  );
}

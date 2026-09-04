import { EU_COUNTRY_CODES } from "@/lib/settings/constants";
import {
  DEFAULT_PRODUCT_PAGE_CONFIG,
  PRODUCT_PAGE_SECTION_IDS,
  type ProductPageConfig,
  type ProductPageSectionEntry,
  type ProductPageSectionId,
  type StorefrontConfig,
  type StorefrontSeller,
} from "@/types/storefront";

// Pure helpers for the product page's config. Client-safe (no server imports):
// the editor, the public loader and the embed route all read the same
// resolution so "what does an absent field mean" is answered in one place.

export const PRODUCT_PAGE_SECTION_LABELS: Record<ProductPageSectionId, string> = {
  description: "Description",
  specs: "Specifications",
  documents: "Documents",
  shipping: "Shipping",
  returns: "Returns",
  safety: "Safety and compliance",
  seller: "Seller",
};

/**
 * Every section exactly once, in the FIXED order of PRODUCT_PAGE_SECTION_IDS.
 *
 * The stored order is deliberately ignored. That list runs from what a buyer
 * reaches for first (the specifications) to what they reach for last (the
 * trader's address), which is one sensible answer, and offering to rearrange
 * it cost fourteen arrow buttons in a panel a seller has to scan. What the
 * stored entries still carry is the only thing that matters: whether each
 * section is SHOWN.
 *
 * Unknown ids are dropped, duplicates keep their first appearance, and a
 * section the stored list lacks comes back HIDDEN, so a config saved before a
 * section existed does not suddenly grow a block the seller never chose.
 */
export function normalizeSections(
  sections: readonly ProductPageSectionEntry[] | undefined,
): ProductPageSectionEntry[] {
  const shown = new Map<ProductPageSectionId, boolean>();
  for (const entry of sections ?? []) {
    if (!(PRODUCT_PAGE_SECTION_IDS as readonly string[]).includes(entry.id)) continue;
    if (shown.has(entry.id)) continue;
    shown.set(entry.id, entry.show);
  }
  return PRODUCT_PAGE_SECTION_IDS.map((id) => ({ id, show: shown.get(id) ?? false }));
}

/** The effective product page options for a config: stored values over the
 *  defaults, sections normalised. Absent member = the defaults verbatim. */
export function resolveProductPage(
  config: Pick<StorefrontConfig, "productPage">,
): ProductPageConfig {
  const stored = config.productPage;
  if (!stored) return DEFAULT_PRODUCT_PAGE_CONFIG;
  return {
    ...DEFAULT_PRODUCT_PAGE_CONFIG,
    ...stored,
    sections: normalizeSections(stored.sections),
  };
}

/** Whether a config equals the defaults field for field, so an untouched page
 *  can stay absent from the saved jsonb (byte-identical to before it existed). */
export function isDefaultProductPage(config: ProductPageConfig): boolean {
  return (
    JSON.stringify({ ...config, sections: normalizeSections(config.sections) }) ===
    JSON.stringify(DEFAULT_PRODUCT_PAGE_CONFIG)
  );
}

// `moveSection` and `pinSectionFirst` lived here. Both are gone with the
// reorder arrows: normalizeSections now returns the fixed order, so there is
// no stored arrangement left for anything to rearrange.

/**
 * Trim every string field, drop the ones left empty, and answer `undefined`
 * when nothing remains. What the editor writes for policies and seller
 * details, so an emptied field disappears from the jsonb instead of being
 * stored as "" (which the email gate would rightly refuse).
 */
export function compactText<T extends Record<string, string | undefined>>(
  value: T,
): T | undefined {
  const compact: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (trimmed) compact[key] = trimmed;
  }
  return Object.keys(compact).length > 0 ? (compact as T) : undefined;
}

/** EU sellers owe buyers the statutory withdrawal and conformity lines. */
export function isEuSeller(seller: StorefrontSeller | undefined): boolean {
  return Boolean(seller?.country) && (EU_COUNTRY_CODES as string[]).includes(seller!.country!);
}

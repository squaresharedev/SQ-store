import type { ProductOption, ProductOptionGroup, ProductPageImage } from "@/types/product";

// Which version of a product an order is for. Pure and client-safe: the
// checkout page, its editor preview and the server-side quote all read the
// same answer from here.

export type Selection = Record<string, ProductOption>;

/**
 * The version a buyer ASKED FOR, held to the standard an order needs: exactly
 * one option in every group, each one real and available. `null` for anything
 * else (a missing group, two options in one group, an id from another product,
 * an option the seller marked unavailable).
 *
 * Deliberately stricter than the product page, which fills a gap with the
 * first available option so there is always something to look at. An ORDER
 * must never be for a version the buyer did not choose, so nothing is filled
 * in here: a gap sends the buyer back to choose.
 */
export function strictSelection(
  groups: readonly ProductOptionGroup[],
  requestedIds: readonly string[],
): Selection | null {
  const requested = new Set(requestedIds);
  const selection: Selection = {};
  let matched = 0;
  for (const group of groups) {
    const chosen = group.options.filter((option) => requested.has(option.id));
    if (chosen.length !== 1 || !chosen[0].available) return null;
    selection[group.id] = chosen[0];
    matched += 1;
  }
  // Every id asked for must have landed in a group: an id this product does
  // not have is a request for something else.
  return matched === requested.size ? selection : null;
}

/**
 * A version to SHOW when nobody has chosen one: the editor's checkout
 * artboard, which previews the design against the first available option of
 * each group. Never used to decide an order.
 */
export function previewSelection(groups: readonly ProductOptionGroup[]): Selection {
  const selection: Selection = {};
  for (const group of groups) {
    const chosen = group.options.find((option) => option.available) ?? group.options[0];
    if (chosen) selection[group.id] = chosen;
  }
  return selection;
}

/**
 * The version as the checkout DRAWS it: one chip per group, in group order,
 * each carrying the chosen option's colour when its group is shown as
 * swatches and the seller gave it one. The group's name stays on the chip for
 * assistive tech and a hover, so "Colour: Sage" reads as a sage dot beside the
 * word rather than as a sentence.
 */
export type SelectionChip = { label: string; value: string; swatch?: string };

export function selectionChips(
  groups: readonly ProductOptionGroup[],
  selection: Selection,
): SelectionChip[] {
  return groups.flatMap((group) => {
    const chosen = selection[group.id];
    const label = group.name.trim();
    const value = chosen?.name.trim();
    if (!label || !value) return [];
    return [
      {
        label,
        value,
        ...(group.display === "swatch" && chosen.swatch ? { swatch: chosen.swatch } : {}),
      },
    ];
  });
}

/** The ids of a selection, in group order, for the `?o=` a link carries. */
export function selectionIds(groups: readonly ProductOptionGroup[], selection: Selection): string[] {
  return groups.flatMap((group) => (selection[group.id] ? [selection[group.id].id] : []));
}

/**
 * The one photo that stands for this version: the first photo tied to a
 * chosen option, else the first photo tied to none (the cover or a shared
 * shot), else whatever there is. The same rule the gallery follows, reduced to
 * a single picture for a summary.
 */
export function photoForSelection(
  images: readonly ProductPageImage[],
  selection: Selection,
): ProductPageImage | null {
  const chosen = new Set(Object.values(selection).map((option) => option.id));
  return (
    images.find((image) => image.optionId && chosen.has(image.optionId)) ??
    images.find((image) => !image.optionId) ??
    images[0] ??
    null
  );
}

import type {
  ProductDetails,
  ProductOption,
  ProductOptionGroup,
  ProductSpec,
} from "@/types/product";

/**
 * WHICH FACTS APPLY TO THE VERSION ON SCREEN.
 *
 * A product's details are written once, for the product. An option may then
 * state what IT changes (see ProductOptionDetails), and this is the one place
 * that folds the two together, so the public page, the editor's preview and
 * anything else that prints a spec table can never disagree about what a buyer
 * looking at "Large" is being told.
 *
 * Pure and client-safe: it takes the selection the page already holds and
 * returns a plain ProductDetails, so the caller renders exactly what it would
 * have rendered for a product sold in one version.
 */

/** The chosen option in each group, in the SELLER's group order. */
function selectedOptions(
  groups: ProductOptionGroup[],
  selectedIds: ReadonlySet<string>,
): ProductOption[] {
  const chosen: ProductOption[] = [];
  for (const group of groups) {
    const option = group.options.find((candidate) => selectedIds.has(candidate.id));
    if (option) chosen.push(option);
  }
  return chosen;
}

/** Spec labels are matched loosely, because "Seats" and "seats " are the same
 *  row to everyone except a string comparison. */
function labelKey(spec: ProductSpec): string {
  return spec.label.trim().toLowerCase();
}

/**
 * The product's details with the chosen options' overrides folded in.
 *
 * Dimensions and weight are single values, so the FIRST group that supplies one
 * wins: the seller ordered the axes themselves (that order is what the picker
 * prints), so when two of them both claim a weight the one they put first is
 * the one the page believes. In practice only one axis ever carries
 * measurements, and this only decides the case nobody should be in.
 *
 * Specs are a list, so they MERGE: a row whose name matches one the product
 * already has replaces it (a "Seats" of 6 rather than a second "Seats" row),
 * and a name the product does not have is appended, in group order.
 *
 * Everything else passes through untouched: materials, care, contents, origin
 * and the safety block belong to the product, not to a version of it.
 */
export function resolveDetailsForSelection(
  details: ProductDetails,
  groups: ProductOptionGroup[],
  selectedIds: ReadonlySet<string>,
): ProductDetails {
  const overriding = selectedOptions(groups, selectedIds)
    .map((option) => option.details)
    .filter((own) => own !== undefined);
  if (overriding.length === 0) return details;

  const resolved: ProductDetails = { ...details };

  // A version's own measurement beats the product's, which is the entire point
  // of stating one. Between two versions that both claim it, the earlier group
  // wins, so the first assignment is the one that stands.
  let dimensionsTaken = false;
  let weightTaken = false;
  for (const own of overriding) {
    if (own.dimensions && !dimensionsTaken) {
      resolved.dimensions = own.dimensions;
      dimensionsTaken = true;
    }
    if (own.weight && !weightTaken) {
      resolved.weight = own.weight;
      weightTaken = true;
    }
  }

  const specs = (details.specs ?? []).map((spec) => ({ ...spec }));
  for (const own of overriding) {
    for (const spec of own.specs ?? []) {
      const at = specs.findIndex((candidate) => labelKey(candidate) === labelKey(spec));
      if (at === -1) specs.push({ ...spec });
      else specs[at] = { ...spec };
    }
  }
  if (specs.length > 0) resolved.specs = specs;

  return resolved;
}

/**
 * "Size: Large", "Colour: Natural oak": the version being described, as spec
 * rows. The picker says the same thing above the fold, and this is deliberate
 * repetition: the spec table is the reference block a buyer scrolls back to
 * (and prints, and screenshots), and a table of measurements that does not say
 * which version it measured is a table you cannot use.
 *
 * Groups with no name are skipped rather than printed as ": Large".
 */
export function optionSummaryRows(
  groups: ProductOptionGroup[],
  selection: Record<string, ProductOption>,
): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  for (const group of groups) {
    const chosen = selection[group.id];
    const label = group.name.trim();
    const value = chosen?.name.trim();
    if (label && value) rows.push({ label, value });
  }
  return rows;
}

/** Whether any option states facts of its own, which is what lets the page
 *  keep a specs section for a product whose measurements live entirely on its
 *  versions. */
export function hasOptionDetails(groups: ProductOptionGroup[]): boolean {
  return groups.some((group) =>
    group.options.some((option) => optionDetailsFilled(option.details)),
  );
}

/** An override that carries nothing is the same as no override: the form can
 *  hand back an empty object once a seller opens a version and types nothing. */
export function optionDetailsFilled(details: ProductOption["details"]): boolean {
  if (!details) return false;
  return Boolean(details.dimensions || details.weight || (details.specs?.length ?? 0) > 0);
}

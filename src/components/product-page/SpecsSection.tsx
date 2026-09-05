"use client";

import { optionSummaryRows, resolveDetailsForSelection } from "@/lib/products/option-details";
import type { ProductDetails } from "@/types/product";
import { useOptionSelection } from "./OptionContext";
import { SpecsTable } from "./SpecsTable";

/**
 * The specs table, for the version the buyer is looking at.
 *
 * The only reason this is a client component is the selection: a table sold in
 * two sizes has two sets of measurements, and the one on screen has to follow
 * the picker the way the gallery already does. Everything it renders is static
 * markup (SpecsTable), so what crosses the boundary is the fold, not the page.
 */
export function SpecsSection({
  details,
  ruleColor,
}: {
  details: ProductDetails;
  ruleColor: string;
}) {
  const { groups, selection, selectedIds } = useOptionSelection();
  return (
    <SpecsTable
      details={resolveDetailsForSelection(details, groups, selectedIds)}
      ruleColor={ruleColor}
      leadingRows={optionSummaryRows(groups, selection)}
    />
  );
}

"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import {
  LEGACY_VARIANT_QUERY_PARAM,
  OPTION_QUERY_PARAM,
} from "@/lib/storefront/product-page-url";
import type { ProductOption, ProductOptionGroup } from "@/types/product";

/**
 * The one piece of client state on a product page: which option is chosen in
 * each of the product's groups. The gallery filters by it, the picker sets it
 * and the buy button reads whether the whole choice is available. Held in a
 * provider so the rest of the page can stay server rendered and simply sit
 * inside it.
 *
 * One choice PER GROUP, always: a product sold in a colour and a size has a
 * colour and a size chosen at all times, because "no size picked" is not a
 * thing a buyer can order. The choice is DERIVED rather than stored (see
 * below), so a group with nothing picked resolves to its first available
 * option instead of leaving a hole.
 *
 * In preview mode (the editor) the URL is left alone: a `?o=` on the editor's
 * own address would mean nothing there.
 */
type OptionSelection = {
  groups: ProductOptionGroup[];
  /** Group id -> the option chosen in it. Every group has an entry, because
   *  the schema refuses a group with no options to choose from. */
  selection: Record<string, ProductOption>;
  /** Every chosen option id, which is what the gallery filters photos by. */
  selectedIds: ReadonlySet<string>;
  select: (groupId: string, optionId: string) => void;
  /** The first group whose chosen option is marked unavailable, or null when
   *  the whole combination can be bought. The button names it. */
  unavailableIn: ProductOptionGroup | null;
};

const OptionSelectionContext = createContext<OptionSelection | null>(null);

export function OptionProvider({
  groups,
  initialOptionIds,
  syncUrl,
  children,
}: {
  groups: ProductOptionGroup[];
  /** From `?o=` (and the legacy `?v=`), already checked against this product's
   *  own options by the server. Ids the product does not have never arrive. */
  initialOptionIds: readonly string[];
  /** Reflect the choice in the address bar so a shared link opens on it. */
  syncUrl: boolean;
  children: ReactNode;
}) {
  // What the viewer has PICKED, by group. May be empty, and may name options
  // that no longer exist if the product changed under an open tab.
  const [picked, setPicked] = useState<Record<string, string>>({});
  // Identity-stable across renders, so a caller passing a fresh array literal
  // (the editor artboard does) cannot invalidate the memo below every frame.
  const requestedKey = initialOptionIds.join(",");
  const requested = useMemo(
    () => new Set(requestedKey ? requestedKey.split(",") : []),
    [requestedKey],
  );

  const resolved = useMemo(
    () => resolveSelection(groups, picked, requested),
    [groups, picked, requested],
  );

  const select = useCallback(
    (groupId: string, optionId: string) => {
      const group = groups.find((candidate) => candidate.id === groupId);
      if (!group?.options.some((option) => option.id === optionId)) return;
      const next = { ...picked, [groupId]: optionId };
      setPicked(next);
      if (!syncUrl || typeof window === "undefined") return;
      // The WHOLE selection, in group order, so the address always describes
      // the version on screen rather than only the last thing clicked. Run
      // through the same resolver the render uses, so a group the viewer has
      // never touched still contributes the option they are looking at.
      const { selection } = resolveSelection(groups, next, requested);
      const ids = groups.map((candidate) => selection[candidate.id]?.id ?? "").filter(Boolean);
      const url = new URL(window.location.href);
      url.searchParams.set(OPTION_QUERY_PARAM, ids.join(","));
      // Never carried forward: a link that still named the old parameter would
      // keep overriding the new one on every reload.
      url.searchParams.delete(LEGACY_VARIANT_QUERY_PARAM);
      window.history.replaceState(window.history.state, "", url);
    },
    [groups, picked, requested, syncUrl],
  );

  const value = useMemo<OptionSelection>(
    () => ({ groups, ...resolved, select }),
    [groups, resolved, select],
  );

  return (
    <OptionSelectionContext.Provider value={value}>{children}</OptionSelectionContext.Provider>
  );
}

/**
 * What is chosen in each group, given what the viewer has clicked and what the
 * URL asked for. A pure function, so the render and the URL writer can never
 * disagree about which option is showing.
 *
 * The choice is DERIVED, not stored: the editor's artboard paints before its
 * options have loaded, and a selection captured on that first render would
 * leave the page with nothing chosen once they arrived. Order of preference:
 * what the viewer clicked, what the URL asked for, the first available option,
 * then the first option at all — so a group whose every option is sold out
 * still shows which one it is talking about.
 */
function resolveSelection(
  groups: ProductOptionGroup[],
  picked: Record<string, string>,
  requested: ReadonlySet<string>,
): { selection: Record<string, ProductOption>; selectedIds: Set<string>; unavailableIn: ProductOptionGroup | null } {
  const selection: Record<string, ProductOption> = {};
  const selectedIds = new Set<string>();
  let unavailableIn: ProductOptionGroup | null = null;

  for (const group of groups) {
    const chosen =
      group.options.find((option) => option.id === picked[group.id]) ??
      group.options.find((option) => requested.has(option.id)) ??
      group.options.find((option) => option.available) ??
      group.options[0];
    if (!chosen) continue;
    selection[group.id] = chosen;
    selectedIds.add(chosen.id);
    if (!chosen.available && !unavailableIn) unavailableIn = group;
  }
  return { selection, selectedIds, unavailableIn };
}

export function useOptionSelection(): OptionSelection {
  const value = useContext(OptionSelectionContext);
  if (!value) {
    throw new Error("useOptionSelection must be used inside OptionProvider.");
  }
  return value;
}

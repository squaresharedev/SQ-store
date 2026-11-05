"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { addOnSelectionIds } from "@/lib/checkout/selection";
import {
  ADD_ON_QUERY_PARAM,
  addOnsParam,
  type AddOnPick,
} from "@/lib/storefront/product-page-url";
import type { AddOnCard } from "@/types/product";

/**
 * "Add to your order": which of the offered add-ons the buyer has taken, and
 * in which version. Shared by the cards that set it, the buy button that
 * carries it to the checkout, and the checkout's lines and total.
 *
 * Held like the version and the quantity (OptionContext, QuantityContext): the
 * PICKS are derived each render from what the buyer tapped and the add-ons on
 * offer, so an add-on that stops being offered simply drops out, and a version
 * that is gone falls back to the first available one. A request, never a
 * price: the checkout re-reads every add-on and the quote prices only the main
 * product's own.
 *
 * `?a=` is rewritten as the buyer taps (history.replaceState), so a reload or
 * a shared link keeps the order they were building. Not in the editor, whose
 * own address it is not.
 */
type AddOnsState = {
  offered: readonly AddOnCard[];
  /** What is taken, in the seller's order, each with a full version. */
  picks: AddOnPick[];
  isAdded: (productId: string) => boolean;
  toggle: (productId: string) => void;
  /** Take one in a version of the buyer's choosing (the details dialog). */
  add: (productId: string, optionIds: readonly string[]) => void;
  remove: (productId: string) => void;
  /** Change one group's option on an add-on that is taken. */
  choose: (productId: string, groupId: string, optionId: string) => void;
};

const AddOnsContext = createContext<AddOnsState | null>(null);

/** What the buyer asked for, by product id: the option ids they want. */
type Requested = Record<string, string[]>;

function resolvePicks(offered: readonly AddOnCard[], requested: Requested): AddOnPick[] {
  return offered.flatMap((card) => {
    const wanted = requested[card.id];
    if (!wanted) return [];
    const optionIds = addOnSelectionIds(card.optionGroups, wanted);
    return optionIds ? [{ productId: card.id, optionIds }] : [];
  });
}

export function AddOnsProvider({
  offered,
  initialPicks,
  syncUrl,
  children,
}: {
  offered: readonly AddOnCard[];
  /** From `?a=`, already limited to the product's own add-ons by the server. */
  initialPicks: readonly AddOnPick[];
  syncUrl: boolean;
  children: ReactNode;
}) {
  const [requested, setRequested] = useState<Requested>(() =>
    Object.fromEntries(initialPicks.map((pick) => [pick.productId, pick.optionIds])),
  );

  const commit = useCallback(
    (next: Requested) => {
      setRequested(next);
      if (!syncUrl || typeof window === "undefined") return;
      const url = new URL(window.location.href);
      const param = addOnsParam(resolvePicks(offered, next));
      if (param) url.searchParams.set(ADD_ON_QUERY_PARAM, param);
      else url.searchParams.delete(ADD_ON_QUERY_PARAM);
      window.history.replaceState(window.history.state, "", url);
    },
    [offered, syncUrl],
  );

  const value = useMemo<AddOnsState>(() => {
    const picks = resolvePicks(offered, requested);
    const taken = new Set(picks.map((pick) => pick.productId));
    const without = (productId: string): Requested => {
      const next = { ...requested };
      delete next[productId];
      return next;
    };
    return {
      offered,
      picks,
      isAdded: (productId) => taken.has(productId),
      toggle: (productId) =>
        commit(taken.has(productId) ? without(productId) : { ...requested, [productId]: [] }),
      add: (productId, optionIds) => commit({ ...requested, [productId]: [...optionIds] }),
      remove: (productId) => commit(without(productId)),
      choose: (productId, groupId, optionId) => {
        const card = offered.find((candidate) => candidate.id === productId);
        const pick = picks.find((candidate) => candidate.productId === productId);
        if (!card || !pick) return;
        const group = card.optionGroups.find((candidate) => candidate.id === groupId);
        if (!group?.options.some((option) => option.id === optionId && option.available)) return;
        const inGroup = new Set(group.options.map((option) => option.id));
        commit({
          ...requested,
          [productId]: [...pick.optionIds.filter((id) => !inGroup.has(id)), optionId],
        });
      },
    };
  }, [offered, requested, commit]);

  return <AddOnsContext.Provider value={value}>{children}</AddOnsContext.Provider>;
}

const NONE: AddOnsState = {
  offered: [],
  picks: [],
  isAdded: () => false,
  toggle: () => {},
  add: () => {},
  remove: () => {},
  choose: () => {},
};

/** The add-ons taken, or none when the page has no provider: a buy button
 *  outside one still works, it just carries nothing extra. */
export function useAddOns(): AddOnsState {
  return useContext(AddOnsContext) ?? NONE;
}

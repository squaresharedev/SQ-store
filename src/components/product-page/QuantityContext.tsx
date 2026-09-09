"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { QUANTITY_QUERY_PARAM, clampQuantity } from "@/lib/products/quantity";

/**
 * How many units the buyer has asked for, shared by the picker that sets it,
 * the total beside it and the buy button that carries it into an enquiry.
 * The second piece of client state on a product page, held the same way the
 * first one is (see OptionContext) so the rest of the page stays server markup.
 *
 * THE LIMIT IS A PROP, NOT A CALCULATION. It arrives already decided by
 * `publicQuantityLimit` on the server, and every write goes back through
 * `clampQuantity` against it, so nothing typed, pasted or replayed into this
 * provider can leave it holding an illegal number. That is a guarantee about
 * what is on SCREEN, and only that: this is a display control, and the number
 * it holds authorizes nothing. `resolveOrderQuantity` is the boundary.
 *
 * In preview mode (the editor) the URL is left alone, for the same reason the
 * option picker leaves it alone: a `?q=` on the editor's own address means
 * nothing there.
 */
type QuantityState = {
  quantity: number;
  /** The largest value the picker may offer. 0 or 1 means no control. */
  limit: number;
  setQuantity: (value: number) => void;
};

const QuantityContext = createContext<QuantityState | null>(null);

export function QuantityProvider({
  limit,
  initialQuantity,
  syncUrl,
  children,
}: {
  limit: number;
  /** From `?q=`, already clamped against this product by the server. */
  initialQuantity: number;
  syncUrl: boolean;
  children: ReactNode;
}) {
  const [quantity, setQuantityState] = useState(() =>
    clampQuantity(initialQuantity, limit),
  );

  const setQuantity = useCallback(
    (value: number) => {
      const next = clampQuantity(value, limit);
      setQuantityState(next);
      if (!syncUrl || typeof window === "undefined") return;
      const url = new URL(window.location.href);
      // One unit is the default, so it is written as the ABSENCE of the
      // parameter rather than as `q=1`. A link a buyer copies after changing
      // their mind back to one should look like the link they arrived on.
      if (next > 1) url.searchParams.set(QUANTITY_QUERY_PARAM, String(next));
      else url.searchParams.delete(QUANTITY_QUERY_PARAM);
      window.history.replaceState(window.history.state, "", url);
    },
    [limit, syncUrl],
  );

  const value = useMemo<QuantityState>(
    // The limit is re-clamped into the state on every render rather than only
    // at mount: the editor's preview swaps products under a live provider, and
    // a quantity of 6 left over from the last one must not survive onto a
    // product that sells three.
    () => ({ quantity: clampQuantity(quantity, limit), limit, setQuantity }),
    [quantity, limit, setQuantity],
  );

  return <QuantityContext.Provider value={value}>{children}</QuantityContext.Provider>;
}

/**
 * The chosen quantity, or a fixed one when the page has no provider. Unlike
 * `useOptionSelection` this does not throw: a product page that never renders a
 * picker (one unit available, or sold out) still has a buy button, and that
 * button should not be the thing that fails.
 */
export function useQuantity(): QuantityState {
  return useContext(QuantityContext) ?? SINGLE;
}

const SINGLE: QuantityState = { quantity: 1, limit: 1, setQuantity: () => {} };

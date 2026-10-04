"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { CodeTerms } from "@/types/discount";

/**
 * The discount code a buyer applied at checkout, shared by the field that
 * sets it, the totals that price it and the item card that shows the unit
 * price it leaves. Held the way the quantity is (QuantityContext), so the rest
 * of the checkout stays server markup.
 *
 * What is held is the code's TERMS, as the check route answered them. They
 * draw a preview and nothing else: the order route looks the code up again
 * and the quote prices from the database.
 */
type DiscountCodeState = {
  terms: CodeTerms | null;
  setTerms: (terms: CodeTerms | null) => void;
};

const DiscountCodeContext = createContext<DiscountCodeState | null>(null);

export function DiscountCodeProvider({ children }: { children: ReactNode }) {
  const [terms, setTerms] = useState<CodeTerms | null>(null);
  const value = useMemo(() => ({ terms, setTerms }), [terms]);
  return <DiscountCodeContext.Provider value={value}>{children}</DiscountCodeContext.Provider>;
}

/** The applied code, or none outside a checkout (the editor's other pages). */
export function useAppliedCode(): DiscountCodeState {
  return useContext(DiscountCodeContext) ?? NO_CODE;
}

const NO_CODE: DiscountCodeState = { terms: null, setTerms: () => {} };

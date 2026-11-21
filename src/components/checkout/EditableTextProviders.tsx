"use client";

import type { ReactNode } from "react";
import { PlainTextEditor } from "@/components/storefront/PlainTextEditor";
import type { CartPageConfig, CheckoutPageConfig } from "@/types/storefront";
import { TextEditContext, type TextEdit } from "./EditableText";

// THE EDITOR'S HALF of EditableText: the providers that make a page's words
// typeable on the storefront designer's canvas, and the only place the editor
// itself is imported. Kept apart so a buyer's page (which draws EditableText
// as plain words) never downloads it (tests/unit/zod-bundle-graph.test.ts).

/**
 * Makes the checkout's words editable in place. Only the editor's artboards
 * provide it; on a buyer's page there is no provider, and every EditableText
 * is plain text.
 */
export function CheckoutEditProvider({
  checkoutPage,
  onChange,
  children,
}: {
  checkoutPage: CheckoutPageConfig;
  onChange: (next: CheckoutPageConfig) => void;
  children: ReactNode;
}) {
  const edit: TextEdit["edit"] = (field, value) => {
    if (field === "cartTitle" || field === "cartNote") return;
    const next = { ...checkoutPage };
    // An emptied field goes back to the default copy by being ABSENT, never
    // stored as "" (which the schema refuses): see withoutKey in the panel.
    if (value === undefined) delete next[field];
    else next[field] = value;
    onChange(next);
  };
  return <TextEditContext.Provider value={{ edit, Editor: PlainTextEditor }}>{children}</TextEditContext.Provider>;
}

/** The cart's twin of CheckoutEditProvider: its heading and note typed onto
 *  the cart where it opens on the product page artboard. */
export function CartEditProvider({
  cartPage,
  onChange,
  children,
}: {
  cartPage: CartPageConfig;
  onChange: (next: CartPageConfig) => void;
  children: ReactNode;
}) {
  const edit: TextEdit["edit"] = (field, value) => {
    const key = field === "cartTitle" ? "title" : field === "cartNote" ? "note" : null;
    if (!key) return;
    const next = { ...cartPage };
    if (value === undefined) delete next[key];
    else next[key] = value;
    onChange(next);
  };
  return <TextEditContext.Provider value={{ edit, Editor: PlainTextEditor }}>{children}</TextEditContext.Provider>;
}

"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { useActionErrorToast } from "@/components/ui/ActionErrorNotice";
import { serverError } from "@/lib/errors";
import { setProductAddOns } from "@/lib/products/add-on-actions";
import { useSampleMode } from "@/lib/storefront/sample-mode";
import type { Product } from "@/types/product";
import type { PreviewAddOns } from "./usePreviewProduct";

/** What one product offers since the seller last pressed something here. */
type AddOnsEdit = PreviewAddOns & { ids: string[] };

type ProductAddOnsEditorState = {
  catalog: readonly Product[];
  /** The product pages out on the canvas, in the order they were opened. */
  pages: readonly Product[];
  /** The page the panel is choosing for: the one last aimed at, else the newest. */
  target: Product | null;
  aim: (productId: string) => void;
  edits: Readonly<Record<string, AddOnsEdit>>;
  /** Show this choice at once and save it behind that. */
  write: (productId: string, ids: string[], shown: PreviewAddOns) => void;
  /** The board has a product whose page could be put out, so a section with
   *  no page to choose for can offer to put one out. */
  canOpenPage: boolean;
};

const ProductAddOnsEditorContext = createContext<ProductAddOnsEditorState | null>(null);

/**
 * WHAT EACH PRODUCT OFFERS, while the storefront editor changes it: shared by
 * the panel that chooses and the artboard that shows the choice.
 *
 * NOT PART OF THE STOREFRONT'S DRAFT. What a product offers belongs to the
 * product, on every storefront it is on, so a press saves at once (like a badge
 * dragged on the artboard) and never enters the undo history or the Save button.
 *
 * Presses can outrun the network. One save runs per product and only the latest
 * choice waits behind it, so the last press is what is stored; a refused save
 * goes back to the last choice that was stored. The sample storefront's products
 * exist only in code, so there nothing leaves the browser.
 */
export function ProductAddOnsEditorProvider({
  catalog,
  openPages,
  canOpenPage = false,
  children,
}: {
  catalog: readonly Product[];
  openPages: readonly string[];
  canOpenPage?: boolean;
  children: ReactNode;
}) {
  const sample = useSampleMode();
  const showActionError = useActionErrorToast();
  const [aimed, setAimed] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, AddOnsEdit>>({});
  const saving = useRef(new Set<string>());
  const waiting = useRef(new Map<string, string[]>());
  const stored = useRef(new Map<string, AddOnsEdit>());

  // A page that has just come out is the one the seller is looking at.
  const [seenPages, setSeenPages] = useState(openPages);
  if (seenPages !== openPages) {
    setSeenPages(openPages);
    if (openPages.some((id) => !seenPages.includes(id))) setAimed(null);
  }

  const pages = useMemo(() => {
    const byId = new Map(catalog.map((product) => [product.id, product]));
    return openPages.flatMap((id) => {
      const product = byId.get(id);
      return product ? [product] : [];
    });
  }, [catalog, openPages]);
  const target = pages.find((page) => page.id === aimed) ?? pages.at(-1) ?? null;

  const save = useCallback(
    async (productId: string) => {
      if (saving.current.has(productId)) return;
      saving.current.add(productId);
      let ids = waiting.current.get(productId);
      while (ids) {
        waiting.current.delete(productId);
        const result = await setProductAddOns(productId, ids).catch(() => null);
        const next = waiting.current.get(productId);
        if (result?.ok) {
          const edit = { ids: result.addOnIds, cards: result.addOns, hidden: result.hidden };
          stored.current.set(productId, edit);
          if (!next) setEdits((current) => ({ ...current, [productId]: edit }));
        } else {
          // Whatever was pressed behind it was built on the refused choice.
          waiting.current.delete(productId);
          const edit = stored.current.get(productId);
          setEdits((current) => {
            const { [productId]: refused, ...rest } = current;
            void refused;
            return edit ? { ...rest, [productId]: edit } : rest;
          });
          showActionError(result?.error ?? serverError("saveProduct"));
          break;
        }
        ids = next;
      }
      saving.current.delete(productId);
    },
    [showActionError],
  );

  const value = useMemo<ProductAddOnsEditorState>(
    () => ({
      catalog,
      pages,
      target,
      aim: setAimed,
      edits,
      write: (productId, ids, shown) => {
        setEdits((current) => ({ ...current, [productId]: { ids, ...shown } }));
        if (sample) return;
        waiting.current.set(productId, ids);
        void save(productId);
      },
      canOpenPage,
    }),
    [catalog, pages, target, edits, sample, save, canOpenPage],
  );

  return <ProductAddOnsEditorContext.Provider value={value}>{children}</ProductAddOnsEditorContext.Provider>;
}

/** Null outside the designer (the dev gallery, a component test), which simply
 *  means nothing here can change what a product offers. */
export function useProductAddOnsEditor(): ProductAddOnsEditorState | null {
  return useContext(ProductAddOnsEditorContext);
}

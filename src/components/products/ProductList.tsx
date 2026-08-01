"use client";

import { useState } from "react";
import { SearchX } from "lucide-react";
import type { Product, ProductSalesSummary } from "@/types/product";
import type { ActionError } from "@/lib/errors";
import { deleteProduct } from "@/lib/products/actions";
import { ActionErrorNotice } from "@/components/ui/ActionErrorNotice";
import { Modal } from "@/components/ui/modal";
import {
  destructiveButtonClass,
  secondaryButtonClass,
} from "@/components/ui/control-styles";
import { ProductCard } from "./ProductCard";
import { ProductEmptyState } from "./ProductEmptyState";

// Client wrapper that owns the visible product set. Delete removes the card
// optimistically, calls the server action, and restores the list if it fails.
// Ordering, filtering, and paging are all SERVER-side now: this component
// renders exactly the page it is given.
export function ProductList({
  products: initial,
  canWrite,
  sales,
  filtered = false,
  onClearFilters,
}: {
  products: Product[];
  /** Whether the active account's role may edit/delete (hides those controls). */
  canWrite: boolean;
  /** Per-product paid-order rollup + bestseller, fetched server-side. */
  sales: ProductSalesSummary;
  /** True when a search or status filter is narrowing the list. Distinguishes
   *  "no products yet" from "nothing matched", which need different words. */
  filtered?: boolean;
  onClearFilters?: () => void;
}) {
  const [products, setProducts] = useState<Product[]>(initial);
  const [deleteError, setDeleteError] = useState<ActionError | null>(null);
  // The product awaiting confirmation. Deleting takes the product's file and
  // image with it and cannot be undone, so it is never a single click.
  const [pendingDelete, setPendingDelete] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState(false);

  // After a save the server re-renders with fresh props; adopt them (render-time
  // reset on prop change, same pattern as the Sidebar's route tracking).
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setProducts(initial);
  }

  async function handleConfirmDelete() {
    const target = pendingDelete;
    if (!target || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    const previous = products;
    // Optimistic: the card goes as soon as the seller confirms, and comes back
    // with an explanation if the server refuses.
    setProducts((current) => current.filter((product) => product.id !== target.id));
    const result = await deleteProduct(target.id);
    setDeleting(false);
    setPendingDelete(null);
    if (!result.ok) {
      setProducts(previous);
      setDeleteError(result.error);
    }
  }

  if (products.length === 0) {
    // A filtered miss is not an empty store: offering "add your first product"
    // to someone who has 200 products and a typo would be nonsense.
    if (filtered) {
      return (
        <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-border px-6 py-16 text-center">
          <div className="mb-4 flex size-12 items-center justify-center rounded-full border border-border bg-background shadow-xs">
            <SearchX
              className="size-5 text-muted-foreground"
              strokeWidth={2}
              aria-hidden="true"
            />
          </div>
          <p className="text-sm font-medium text-foreground">
            No products match these filters
          </p>
          <p className="mt-1 max-w-xs font-inter text-sm text-muted-foreground">
            Try a different search term, or clear the filters to see everything
            again.
          </p>
          {onClearFilters && (
            <button
              type="button"
              onClick={onClearFilters}
              className={`${secondaryButtonClass} mt-4`}
            >
              Clear filters
            </button>
          )}
        </div>
      );
    }
    return <ProductEmptyState canWrite={canWrite} />;
  }

  return (
    <>
      {deleteError && <ActionErrorNotice error={deleteError} className="mb-4" />}
      {/* Four-up from the laptop breakpoint (lg): the smaller card carries it. */}
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {products.map((product) => (
          <li key={product.id}>
            <ProductCard
              product={product}
              canWrite={canWrite}
              sales={sales.byProduct[product.id]}
              isBestseller={sales.bestsellerId === product.id}
              onDelete={() => setPendingDelete(product)}
            />
          </li>
        ))}
      </ul>

      <Modal
        open={pendingDelete !== null}
        onClose={() => {
          if (!deleting) setPendingDelete(null);
        }}
        title="Delete this product?"
        description={
          pendingDelete
            ? `"${pendingDelete.title}" and its uploaded image and file will be permanently removed. Existing orders keep their record of the sale.`
            : undefined
        }
      >
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => setPendingDelete(null)}
            disabled={deleting}
            className={secondaryButtonClass}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirmDelete}
            disabled={deleting}
            className={destructiveButtonClass}
          >
            {deleting ? "Deleting…" : "Delete product"}
          </button>
        </div>
      </Modal>
    </>
  );
}

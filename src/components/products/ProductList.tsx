"use client";

import { useMemo, useState } from "react";
import { AlertCircle } from "lucide-react";
import type { Product, ProductSalesSummary } from "@/types/product";
import { sortProducts, type ProductSort } from "@/lib/products/sort";
import { deleteProduct } from "@/lib/products/actions";
import { ProductCard } from "./ProductCard";
import { ProductEmptyState } from "./ProductEmptyState";

// Client wrapper that owns the visible product set. Delete removes the card
// optimistically, calls the server action, and restores the list if it fails.
export function ProductList({
  products: initial,
  canWrite,
  sales,
  sort = "default",
}: {
  products: Product[];
  /** Whether the active account's role may edit/delete (hides those controls). */
  canWrite: boolean;
  /** Per-product paid-order rollup + bestseller, fetched server-side. */
  sales: ProductSalesSummary;
  /** Grid ordering chosen in the toolbar; applied to the live list below. */
  sort?: ProductSort;
}) {
  const [products, setProducts] = useState<Product[]>(initial);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // After a save the server re-renders with fresh props; adopt them (render-time
  // reset on prop change, same pattern as the Sidebar's route tracking).
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setProducts(initial);
  }

  async function handleDelete(id: string) {
    setDeleteError(null);
    const previous = products;
    setProducts((current) => current.filter((product) => product.id !== id));
    const result = await deleteProduct(id);
    if (!result.ok) {
      setProducts(previous);
      setDeleteError(result.error);
    }
  }

  // Ordering is derived, never stored: deletes mutate `products` and the sort
  // re-applies on top, so the two can't disagree.
  const visible = useMemo(
    () => sortProducts(products, sort, sales.byProduct),
    [products, sort, sales.byProduct],
  );

  if (products.length === 0) {
    return <ProductEmptyState canWrite={canWrite} />;
  }

  return (
    <>
      {deleteError && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3"
        >
          <AlertCircle
            className="mt-0.5 size-4 shrink-0 text-destructive"
            strokeWidth={2}
            aria-hidden="true"
          />
          <p className="font-inter text-sm text-destructive">{deleteError}</p>
        </div>
      )}
      {/* Four-up from the laptop breakpoint (lg) — the smaller card carries it. */}
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
      {visible.map((product) => (
        <li key={product.id}>
          <ProductCard
            product={product}
            canWrite={canWrite}
            sales={sales.byProduct[product.id]}
            isBestseller={sales.bestsellerId === product.id}
            onDelete={() => handleDelete(product.id)}
          />
        </li>
      ))}
      </ul>
    </>
  );
}

"use client";

import { useState } from "react";
import type { Product } from "@/types/product";
import type { ActionError } from "@/lib/errors";
import { deleteProduct } from "@/lib/products/actions";
import { ActionErrorNotice } from "@/components/ui/ActionErrorNotice";
import { ProductCard } from "./ProductCard";
import { ProductEmptyState } from "./ProductEmptyState";

// Client wrapper that owns the visible product set. Delete removes the card
// optimistically, calls the server action, and restores the list if it fails.
export function ProductList({
  products: initial,
  canWrite,
}: {
  products: Product[];
  /** Whether the active account's role may edit/delete (hides those controls). */
  canWrite: boolean;
}) {
  const [products, setProducts] = useState<Product[]>(initial);
  const [deleteError, setDeleteError] = useState<ActionError | null>(null);

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

  if (products.length === 0) {
    return <ProductEmptyState canWrite={canWrite} />;
  }

  return (
    <>
      {deleteError && <ActionErrorNotice error={deleteError} className="mb-4" />}
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {products.map((product) => (
        <li key={product.id}>
          <ProductCard
            product={product}
            canWrite={canWrite}
            onDelete={() => handleDelete(product.id)}
          />
        </li>
      ))}
      </ul>
    </>
  );
}

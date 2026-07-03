"use client";

import { useState } from "react";
import { AlertCircle } from "lucide-react";
import type { Product } from "@/types/product";
import { deleteProduct } from "@/lib/products/actions";
import { ProductCard } from "./ProductCard";
import { ProductEmptyState } from "./ProductEmptyState";

// Client wrapper that owns the visible product set. Delete removes the card
// optimistically, calls the server action, and restores the list if it fails.
export function ProductList({ products: initial }: { products: Product[] }) {
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

  if (products.length === 0) {
    return <ProductEmptyState />;
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
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {products.map((product) => (
        <li key={product.id}>
          <ProductCard
            product={product}
            onDelete={() => handleDelete(product.id)}
          />
        </li>
      ))}
      </ul>
    </>
  );
}

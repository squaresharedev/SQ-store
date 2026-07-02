"use client";

import { useState } from "react";
import type { Product } from "@/types/product";
import { ProductCard } from "./ProductCard";
import { ProductEmptyState } from "./ProductEmptyState";

// Client wrapper that owns the visible product set. Delete is UI-only for now:
// it removes the card locally so the interaction feels real, and drops to the
// empty state once the last product is removed. Real deletion (Supabase row +
// R2 cleanup) is wired in a later stage.
export function ProductList({ products: initial }: { products: Product[] }) {
  const [products, setProducts] = useState<Product[]>(initial);

  function handleDelete(id: string) {
    // TODO(next stage): call the delete API / Supabase mutation here.
    console.info("[products] delete requested", { id });
    setProducts((current) => current.filter((product) => product.id !== id));
  }

  if (products.length === 0) {
    return <ProductEmptyState />;
  }

  return (
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
  );
}

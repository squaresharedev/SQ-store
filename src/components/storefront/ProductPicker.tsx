"use client";

import Link from "next/link";
import { Image as ImageIcon, Plus } from "lucide-react";
import type { Product } from "@/types/product";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { helpTextClass } from "@/components/ui/control-styles";

const ADD_BUTTON_CLASS =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-sm border border-border bg-background text-muted-foreground transition-colors duration-180 ease-in-out hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none";

/** Pick from the seller's existing products; each can be in the grid once. */
export function ProductPicker({
  products,
  usedProductIds,
  onAdd,
}: {
  products: Product[];
  usedProductIds: ReadonlySet<string>;
  onAdd: (productId: string) => void;
}) {
  if (products.length === 0) {
    return (
      <p className={helpTextClass}>
        You have no products yet.{" "}
        <Link
          href="/products"
          className="font-medium text-foreground underline decoration-border underline-offset-4 transition-colors duration-180 ease-in-out hover:decoration-foreground motion-reduce:transition-none"
        >
          Add a product
        </Link>{" "}
        first, then arrange it here.
      </p>
    );
  }

  return (
    <ul className="space-y-1">
      {products.map((product) => {
        const used = usedProductIds.has(product.id);
        return (
          <li key={product.id} className="flex items-center gap-2">
            <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-muted">
              {product.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- signed R2 URL; plain img for a thumbnail.
                <img
                  src={product.imageUrl}
                  alt=""
                  className="size-full object-cover"
                />
              ) : (
                <ImageIcon
                  className="size-4 text-muted-foreground"
                  strokeWidth={2}
                  aria-hidden="true"
                />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground">
                {product.title}
              </span>
              <span className="block font-inter text-xs text-muted-foreground">
                {formatPrice(product.price, product.currency)}
              </span>
            </span>
            <button
              type="button"
              onClick={() => onAdd(product.id)}
              disabled={used}
              aria-label={
                used ? `${product.title} is in the grid` : `Add ${product.title} to grid`
              }
              className={cn(ADD_BUTTON_CLASS)}
            >
              <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

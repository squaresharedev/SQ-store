"use client";

import { useId } from "react";
import { Image as ImageIcon, Trash2 } from "lucide-react";
import type { Product } from "@/types/product";
import type { ProductBlock } from "@/types/storefront";
import { formatPrice } from "@/lib/format";
import {
  destructiveButtonClass,
  helpTextClass,
  labelClass,
} from "@/components/ui/control-styles";
import { Switch } from "@/components/ui/switch";

/**
 * Inspector card body for a PRODUCT block in the side panel. Shows a product
 * summary row, the sold-out toggle, an optional inventory hint, and a remove
 * action. Patches are emitted one field at a time (no "save" step).
 */
export function ProductBlockEditor({
  block,
  product,
  onToggleSoldOut,
  onRemove,
}: {
  block: ProductBlock;
  product: Product | null;
  onToggleSoldOut: () => void;
  onRemove: () => void;
}) {
  const fieldId = useId();

  // Null product: catalog entry was deleted; only offer a remove action.
  if (product === null) {
    return (
      <div className="space-y-4">
        <p className="font-inter text-sm text-destructive">
          This product was removed from your catalog.
        </p>
        <button
          type="button"
          onClick={onRemove}
          className={destructiveButtonClass + " w-full"}
        >
          <Trash2 className="size-4" strokeWidth={2} aria-hidden="true" />
          Remove from grid
        </button>
      </div>
    );
  }

  // Stock status line — display-only, independent from the manual sold-out flag.
  let stockLine: string | null = null;
  if (product.trackStock) {
    if (product.stockQuantity === 0) {
      stockLine = "Out of stock in inventory (0 on hand).";
    } else if (
      product.stockQuantity !== null &&
      product.stockQuantity <= product.lowStockThreshold
    ) {
      stockLine = `Low stock: ${product.stockQuantity} on hand.`;
    } else if (product.stockQuantity !== null) {
      stockLine = `${product.stockQuantity} in stock.`;
    }
  }

  return (
    <div className="space-y-4">
      {/* Summary row: thumbnail + title + price */}
      <div className="flex items-center gap-3">
        <div className="size-12 shrink-0 overflow-hidden rounded-sm bg-muted">
          {product.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed R2 URL with query params; next/image adds no value here.
            <img
              src={product.imageUrl}
              alt=""
              className="size-full object-cover"
            />
          ) : (
            <div className="flex size-full items-center justify-center">
              <ImageIcon
                className="size-4 text-muted-foreground"
                strokeWidth={2}
                aria-hidden="true"
              />
            </div>
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {product.title}
          </p>
          <p className="font-inter text-xs text-muted-foreground">
            {formatPrice(product.price, product.currency)}
          </p>
        </div>
      </div>

      {/* Sold-out toggle */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor={`${fieldId}-soldout`} className={labelClass}>
            Mark as sold out
          </label>
          <Switch
            id={`${fieldId}-soldout`}
            checked={block.soldOut === true}
            onCheckedChange={onToggleSoldOut}
          />
        </div>
        <p className={helpTextClass}>
          The sold-out badge follows the Cards section setting.
        </p>
      </div>

      {/* Inventory hint (display-only, only when stock tracking is on) */}
      {stockLine !== null && (
        <p className="font-inter text-xs text-muted-foreground">{stockLine}</p>
      )}

      {/* Remove action */}
      <button
        type="button"
        onClick={onRemove}
        className={destructiveButtonClass + " w-full"}
      >
        <Trash2 className="size-4" strokeWidth={2} aria-hidden="true" />
        Remove from grid
      </button>
    </div>
  );
}

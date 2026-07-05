import Link from "next/link";
import { Image as ImageIcon, Pencil, Trash2 } from "lucide-react";
import type { Product } from "@/types/product";
import { cn } from "@/lib/utils";
import { iconButtonClass } from "@/components/ui/control-styles";
import { formatPrice } from "@/lib/format";
import { StatusBadge } from "./StatusBadge";
import { StockBadge } from "@/components/ui/StockBadge";
import { deriveStockBadge } from "@/lib/stock/badge";

// Presentational card (styles.md §8.7). Interactive handlers come from the
// parent list, which owns product state; edit is a plain route link.
export function ProductCard({
  product,
  onDelete,
}: {
  product: Product;
  onDelete: () => void;
}) {
  const { id, title, price, currency, status, imageUrl, trackStock, stockQuantity, lowStockThreshold } = product;
  const stockBadge = deriveStockBadge({ trackStock, stockQuantity, lowStockThreshold });

  return (
    <div className="flex flex-col rounded-md border border-border bg-card p-4 shadow-sm transition-shadow duration-180 ease-in-out hover:shadow-md motion-reduce:transition-none">
      <div className="relative aspect-[4/3] overflow-hidden rounded-sm bg-muted">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed R2 URL with query params; next/image adds no value here.
          <img
            src={imageUrl}
            alt=""
            className="size-full object-cover"
          />
        ) : (
          <div className="flex size-full items-center justify-center">
            <ImageIcon
              className="size-8 text-muted-foreground"
              strokeWidth={1.5}
              aria-hidden="true"
            />
          </div>
        )}
        <StatusBadge status={status} className="absolute left-2 top-2" />
      </div>

      <div className="mt-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-foreground">
            {title}
          </h3>
          <p className="mt-0.5 font-inter text-sm text-muted-foreground">
            {formatPrice(price, currency)}
          </p>
          {stockBadge !== null && (
            <div className="mt-1.5">
              <StockBadge badge={stockBadge} />
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Link
            href={`/products/${id}/edit`}
            aria-label={`Edit ${title}`}
            className={iconButtonClass}
          >
            <Pencil className="size-4" strokeWidth={2} aria-hidden="true" />
          </Link>
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete ${title}`}
            className={cn(iconButtonClass, "hover:text-destructive")}
          >
            <Trash2 className="size-4" strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

import Link from "next/link";
import { Image as ImageIcon, Pencil, Trash2, TrendingUp } from "lucide-react";
import type { Product, ProductSales } from "@/types/product";
import { cn } from "@/lib/utils";
import { iconButtonClass } from "@/components/ui/control-styles";
import { formatPrice } from "@/lib/format";
import { formatCents } from "@/lib/format/money";
import { StatusBadge } from "./StatusBadge";
import { StockBadge } from "@/components/ui/StockBadge";
import { deriveStockBadge } from "@/lib/stock/badge";

// Presentational card (styles.md §8.7). Interactive handlers come from the
// parent list, which owns product state; edit is a plain route link.
//
// SHARP corners throughout (card + image tile), matching the CTA brand rule in
// control-styles.ts. Sized to sit four-up on a laptop, so the type scale and
// padding are one step down from the old three-up card.
export function ProductCard({
  product,
  canWrite,
  sales,
  isBestseller,
  onDelete,
}: {
  product: Product;
  /** Hide edit/delete controls when the active role is read-only. */
  canWrite: boolean;
  /** Paid-order rollup; undefined when this product has never sold. */
  sales?: ProductSales;
  /** Highest-revenue product in the list — earns the bestseller tag. */
  isBestseller: boolean;
  onDelete: () => void;
}) {
  const { id, title, price, currency, status, imageUrl, trackStock, stockQuantity, lowStockThreshold } = product;
  const stockBadge = deriveStockBadge({ trackStock, stockQuantity, lowStockThreshold });

  return (
    <div className="flex flex-col rounded-none border border-border bg-card p-3 shadow-sm transition-shadow duration-180 ease-in-out hover:shadow-md motion-reduce:transition-none">
      <div className="relative aspect-[4/3] overflow-hidden rounded-none bg-muted">
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
              className="size-7 text-muted-foreground"
              strokeWidth={1.5}
              aria-hidden="true"
            />
          </div>
        )}
        <StatusBadge status={status} className="absolute left-2 top-2" />
        {isBestseller && (
          // Inverted chip so it reads as an accolade against the image without
          // introducing a hue — chrome stays greyscale (styles.md §1).
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-none bg-primary px-1.5 py-0.5 text-xs font-medium text-primary-foreground">
            <TrendingUp className="size-3" strokeWidth={2} aria-hidden="true" />
            Bestseller
          </span>
        )}
      </div>

      <div className="mt-2.5 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-foreground">
            {title}
          </h3>
          <p className="mt-0.5 font-inter text-xs text-muted-foreground">
            {formatPrice(price, currency)}
          </p>
          {stockBadge !== null && (
            <div className="mt-1.5">
              <StockBadge badge={stockBadge} />
            </div>
          )}
        </div>

        {canWrite && (
          <div className="flex shrink-0 items-center gap-1">
            <Link
              href={`/products/${id}/edit`}
              aria-label={`Edit ${title}`}
              className={cn(iconButtonClass, "size-8")}
            >
              <Pencil className="size-3.5" strokeWidth={2} aria-hidden="true" />
            </Link>
            <button
              type="button"
              onClick={onDelete}
              aria-label={`Delete ${title}`}
              className={cn(iconButtonClass, "size-8 hover:text-destructive")}
            >
              <Trash2 className="size-3.5" strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      {/* Sales metrics. Zero-sale products keep the row (a quiet dash) so every
          card in the grid stays the same height. */}
      <div className="mt-2.5 flex items-baseline justify-between gap-2 border-t border-border pt-2">
        <span className="font-inter text-xs text-muted-foreground">
          {sales ? `${sales.unitsSold} sold` : "No sales yet"}
        </span>
        <span className="font-inter text-xs font-semibold text-foreground tabular-nums">
          {sales ? formatCents(sales.revenueCents, sales.currency) : "—"}
        </span>
      </div>
    </div>
  );
}

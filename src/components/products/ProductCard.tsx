import Link from "next/link";
import { Image as ImageIcon, Pencil, Trash2 } from "lucide-react";
import type { Product } from "@/types/product";
import { cn } from "@/lib/utils";
import { iconButtonClass } from "./control-styles";
import { formatPrice } from "./product-format";
import { StatusBadge } from "./StatusBadge";

// Presentational card (styles.md §8.7). Interactive handlers come from the
// parent list, which owns product state; edit is a plain route link.
export function ProductCard({
  product,
  onDelete,
}: {
  product: Product;
  onDelete: () => void;
}) {
  const { id, title, price, currency, status, imageUrl } = product;

  return (
    <div className="flex flex-col rounded-[0.5rem] border border-border bg-card p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)] transition-shadow duration-[180ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)] motion-reduce:transition-none">
      <div className="relative aspect-[4/3] overflow-hidden rounded-[0.375rem] bg-muted">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- placeholder path only; real thumbnails come from R2 (next stage).
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

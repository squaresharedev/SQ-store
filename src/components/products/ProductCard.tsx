import Link from "next/link";
import { ExternalLink, Image as ImageIcon, Link2, Pencil, Trash2, TrendingUp } from "lucide-react";
import type { Product, ProductSales } from "@/types/product";
import { cn } from "@/lib/utils";
import { hoverLiftClass, iconButtonClass, infoTextClass } from "@/components/ui/control-styles";
import { formatPrice } from "@/lib/format";
import { formatCents } from "@/lib/format/money";
import { StockBadge } from "@/components/ui/StockBadge";
import { deriveStockBadge } from "@/lib/stock/badge";
import { StatusBadge } from "./StatusBadge";

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
  storefrontCount,
  onDelete,
  onCopyLink,
  onOpenPage,
}: {
  product: Product;
  /** Hide edit/delete controls when the active role is read-only. */
  canWrite: boolean;
  /** Paid-order rollup; undefined when this product has never sold. */
  sales?: ProductSales;
  /** Highest-revenue product in the list — earns the bestseller tag. */
  isBestseller: boolean;
  /**
   * Number of storefronts this product is placed on, from `getProductPlacements`.
   * Drives the copy-link and open affordances: 0 = not placed anywhere, 1 = act
   * directly, 2+ = show a chooser. Shown as a hint on the button when 0.
   */
  storefrontCount: number;
  onDelete: () => void;
  /** Called when the seller asks to copy the product's hosted page link. */
  onCopyLink: () => void;
  /** Called when the seller asks to open the product's hosted page. */
  onOpenPage: () => void;
}) {
  const { id, title, price, currency, status, imageUrl, trackStock, stockQuantity, lowStockThreshold } = product;
  const stockBadge = deriveStockBadge({ trackStock, stockQuantity, lowStockThreshold });

  // Footer stock: the count in plain prose, colour-coded by urgency. Only
  // shown when the seller is tracking stock on this product. Untracked
  // products show nothing (unlimited is the quiet default).
  const stockFooter =
    trackStock && stockQuantity !== null ? (
      stockQuantity <= 0 ? (
        <span className="font-inter text-xs font-medium text-destructive tabular-nums">
          Sold out
        </span>
      ) : stockQuantity <= lowStockThreshold ? (
        <span className="font-inter text-xs font-medium text-foreground tabular-nums">
          {stockQuantity} in stock
        </span>
      ) : (
        <span className={cn(infoTextClass, "tabular-nums")}>
          {stockQuantity} in stock
        </span>
      )
    ) : null;

  // Link button hint: when the product is not on any storefront, the seller
  // needs a nudge rather than a silent no-op from the copy/open buttons.
  const linkTitle =
    storefrontCount === 0
      ? "Not on a storefront yet"
      : storefrontCount === 1
        ? "Copy product page link"
        : `On ${storefrontCount} storefronts, click to choose`;

  return (
    <div
      className={cn(
        "flex flex-col rounded-none border border-border bg-card p-3 shadow-sm",
        hoverLiftClass,
      )}
    >
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

        {/* Action buttons. Copy-link and open are available regardless of role:
            viewing the product page is not a write operation. Edit and delete
            are write-only and hidden for read-only members. */}
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onCopyLink}
            aria-label={`Copy link for ${title}`}
            title={linkTitle}
            className={cn(
              iconButtonClass,
              "size-8",
              storefrontCount === 0 && "opacity-40",
            )}
          >
            <Link2 className="size-3.5" strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onOpenPage}
            aria-label={`Open ${title} page`}
            title={storefrontCount === 0 ? "Not on a storefront yet" : "Open product page"}
            className={cn(
              iconButtonClass,
              "size-8",
              storefrontCount === 0 && "opacity-40",
            )}
          >
            <ExternalLink className="size-3.5" strokeWidth={2} aria-hidden="true" />
          </button>
          {canWrite && (
            <>
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
            </>
          )}
        </div>
      </div>

      {/* Sales metrics. Zero-sale products keep the row (a quiet dash) so every
          card in the grid stays the same height. Stock count replaces the dash
          when the seller is tracking stock but has not made a sale yet, so the
          two most useful pieces of status are always in the footer. When a sale
          has been made the count moves to a second line to avoid crowding the
          revenue. */}
      <div className="mt-2.5 flex items-baseline justify-between gap-2 border-t border-border pt-2">
        <span className={infoTextClass}>
          {sales ? `${sales.unitsSold} sold` : "No sales yet"}
        </span>
        <span className="font-inter text-xs font-semibold text-foreground tabular-nums">
          {sales ? formatCents(sales.revenueCents, sales.currency) : (stockFooter ?? "—")}
        </span>
      </div>
      {/* When the seller has both sales and stock tracking, show the count on
          its own line so revenue stays visible and the stock level is still
          findable at a glance. */}
      {sales && stockFooter && (
        <div className="flex items-baseline justify-end pt-0.5">
          {stockFooter}
        </div>
      )}
    </div>
  );
}

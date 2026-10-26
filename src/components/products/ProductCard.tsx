import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { ArrowRight, Image as ImageIcon, Pencil, TrendingUp } from "lucide-react";
import type { Product, ProductSales } from "@/types/product";
import { cn } from "@/lib/utils";
import { productEditPath } from "@/lib/products/paths";
import { ordersViewPath } from "@/lib/orders/paths";
import { focusRingClass, iconButtonClass, iconNudgeRightClass, photoControlClass } from "@/components/ui/control-styles";
import {
  attentionCountClass,
  onPhotoMutedTextClass,
  onPhotoTextClass,
  posterCardClass,
  posterMediaClass,
  posterPhotoClass,
  posterScrimClass,
} from "@/components/ui/surface-styles";
import { formatPrice } from "@/lib/format";
import { formatCents } from "@/lib/format/money";
import { deriveStockBadge } from "@/lib/stock/badge";
import { ProductCardMenu } from "./ProductCardMenu";
import { RemovalBadge } from "./RemovalNotice";
import { StatusBadge, UnplacedBadge } from "./StatusBadge";

// Presentational card (styles.md §8.7). Interactive handlers come from the
// parent list, which owns product state.
//
// A POSTER, in two zones on one 12px inset. TOP: why buyers can't see it (one
// chip, only when that is true) on the left, every control (Ship, the menu) on
// the right. BOTTOM: the facts as one left-aligned column on a dark fade:
// bestseller, name, price, sales, stock. Nothing hangs off the right edge to
// line up against. The whole card opens the editor (the title is the link,
// stretched over it); everything else sits above that link.
export function ProductCard({
  product,
  canWrite,
  sales,
  isBestseller,
  storefrontCount,
  toShip = 0,
  onDelete,
  onCopyLink,
  onOpenPage,
  onBuyButton,
}: {
  product: Product;
  /** Read-only members get no editor link and no delete: the card is inert. */
  canWrite: boolean;
  /** Paid-order rollup; undefined when this product has never sold. */
  sales?: ProductSales;
  /** Highest-revenue product in the list: earns the bestseller line. */
  isBestseller: boolean;
  /**
   * Number of storefronts this product is placed on, from `getProductPlacements`.
   * Drives the copy-link and open affordances: 0 = not placed anywhere, 1 = act
   * directly, 2+ = show a chooser. At 0 an active product also says so on its photo.
   */
  storefrontCount: number;
  /** Orders of this product still to ship. Above zero, the card carries a Ship
   *  link to the queue narrowed to this product: it is the one number on the
   *  card someone is waiting on. */
  toShip?: number;
  onDelete: () => void;
  /** Called when the seller asks to copy the product's hosted page link. */
  onCopyLink: () => void;
  /** Called when the seller asks to open the product's hosted page. */
  onOpenPage: () => void;
  /** Called when the seller asks for a buy button for their own website. */
  onBuyButton: () => void;
}) {
  const { id, title, price, currency, status, imageUrl, trackStock, stockQuantity, lowStockThreshold, removal } = product;
  const stockBadge = deriveStockBadge({ trackStock, stockQuantity, lowStockThreshold });
  const t = useTranslations("Products.card");
  const tStock = useTranslations("Common.stock");
  const tOrders = useTranslations("Orders");
  const locale = useLocale();

  // Stock, as the line under the sales: plenty is quiet, few is white, none is
  // white with a red dot (red type on a photo does not read). Unlimited is
  // stated, not left blank, so every card carries the same four lines.
  const stockLine =
    stockBadge === null ? (
      <span className={onPhotoMutedTextClass}>{t("unlimited")}</span>
    ) : stockBadge.state === "sold_out" ? (
      <span className={cn(onPhotoTextClass, "inline-flex items-center gap-1.5 font-medium")}>
        <span className="size-1.5 shrink-0 rounded-full bg-destructive" aria-hidden="true" />
        {tStock("soldOut")}
      </span>
    ) : stockBadge.state === "low_stock" ? (
      <span className={cn(onPhotoTextClass, "font-medium tabular-nums")}>
        {tStock("lowStock", { remaining: stockBadge.remaining })}
      </span>
    ) : (
      <span className={cn(onPhotoMutedTextClass, "tabular-nums")}>{t("inStock", { count: stockQuantity ?? 0 })}</span>
    );

  const titleNode = canWrite ? (
    <Link
      href={productEditPath(id)}
      data-card-link=""
      className="outline-none after:absolute after:inset-0 after:content-['']"
    >
      {title}
    </Link>
  ) : (
    title
  );

  return (
    <div data-product-card={id} className={posterCardClass}>
      <div className={posterMediaClass}>
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed R2 URL with query params; next/image adds no value here.
          <img
            src={imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            className={posterPhotoClass}
          />
        ) : (
          <div className="flex size-full items-center justify-center bg-muted">
            <ImageIcon className="size-7 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
          </div>
        )}
        <div className={posterScrimClass} aria-hidden="true" />
      </div>

      <div className="absolute inset-x-3 top-3 flex items-center justify-between gap-2">
        {/* One chip, the most serious reason first: a takedown outranks a draft
            (fixing the draft would not make it visible), and a draft outranks
            being on no storefront (it has no page either way). */}
        <div className="flex min-w-0 items-center">
          {removal ? (
            <RemovalBadge kind={removal.kind} />
          ) : status === "draft" ? (
            <StatusBadge status={status} />
          ) : storefrontCount === 0 ? (
            <UnplacedBadge />
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {toShip > 0 && (
            <Link
              href={ordersViewPath("to-ship", id)}
              data-card-to-ship={toShip}
              aria-label={tOrders("toShipCount", { count: toShip })}
              className={cn(
                "group/btn relative z-10 inline-flex shrink-0 items-center gap-1.5 px-2 font-inter text-xs font-medium",
                photoControlClass,
                focusRingClass,
              )}
            >
              {t("ship")}
              <span className={attentionCountClass}>{toShip}</span>
              <ArrowRight className={cn("size-3.5 shrink-0", iconNudgeRightClass)} strokeWidth={2} aria-hidden="true" />
            </Link>
          )}
          {/* The editor, as a button of its own as well as the whole card: the
              one control a seller looks for. Writers only. */}
          {canWrite && (
            <Link
              href={productEditPath(id)}
              aria-label={t("edit", { title })}
              className={cn(iconButtonClass, photoControlClass, "relative z-10 size-7")}
            >
              <Pencil className="size-3.5" strokeWidth={2} aria-hidden="true" />
            </Link>
          )}
          <ProductCardMenu
            title={title}
            canWrite={canWrite}
            storefrontCount={storefrontCount}
            onCopyLink={onCopyLink}
            onOpenPage={onOpenPage}
            onBuyButton={onBuyButton}
            onDelete={onDelete}
          />
        </div>
      </div>

      <div className="flex flex-col p-3">
        {isBestseller && (
          // A fact about the product, so it heads the facts rather than
          // taking a chip: the top row stays one chip and the controls.
          <span className={cn("mb-1 inline-flex items-center gap-1 font-inter text-xs font-medium", onPhotoTextClass)}>
            <TrendingUp className="size-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
            {t("bestseller")}
          </span>
        )}
        <h3 className={cn("line-clamp-2 text-sm font-semibold leading-snug", onPhotoTextClass)}>{titleNode}</h3>
        <p className={cn("text-lg font-semibold leading-tight tabular-nums", onPhotoTextClass)}>
          {formatPrice(price, currency, locale)}
        </p>
        <div className="mt-1.5 flex flex-col gap-0.5 font-inter text-xs leading-4">
          <span className={cn("truncate tabular-nums", onPhotoMutedTextClass)}>
            {sales ? (
              <>
                <span>{t("unitsSold", { count: sales.unitsSold })}</span>
                {" · "}
                <span>{formatCents(sales.revenueCents, sales.currency, locale)}</span>
              </>
            ) : (
              t("noSales")
            )}
          </span>
          {stockLine}
        </div>
      </div>
    </div>
  );
}

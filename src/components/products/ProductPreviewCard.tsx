"use client";

import { Download, ImageIcon, Truck } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/locales";
import type { Currency, ProductStatus } from "@/types/product";
import { cn } from "@/lib/utils";
import { formatCents } from "@/lib/format/money";
import { deriveStockBadge } from "@/lib/stock/badge";
import { badgeClass, cardClass, eyebrowClass } from "@/components/ui/surface-styles";

/**
 * THE PRODUCT AS A BUYER WILL MEET IT, drawn while the seller is still typing.
 *
 * A form of inputs gives back nothing until Save; this gives back a product.
 * Every keystroke in the title, every photo and price lands here at once, so
 * the seller is building a thing they can see rather than filling in boxes,
 * and the empty slots (a grey photo, "Your product name") show what is still
 * worth adding without a word of instruction.
 *
 * Presentational and decorative: every fact on it is also in a field the
 * seller can reach, so it is hidden from assistive tech rather than read out
 * as a second copy of the form.
 */
export function ProductPreviewCard({
  imageUrl,
  title,
  priceCents,
  currency,
  isDigital,
  dispatch,
  trackStock,
  stockQuantity,
  lowStockThreshold,
  status,
  className,
}: {
  imageUrl: string | null;
  title: string;
  /** Integer cents, or null while the price is blank or mid-edit. */
  priceCents: number | null;
  currency: Currency;
  isDigital: boolean;
  /** The one delivery line buyers read ("Ships in 1–2 working days"). */
  dispatch: string;
  trackStock: boolean;
  stockQuantity: number | null;
  lowStockThreshold: number;
  status: ProductStatus;
  className?: string;
}) {
  const t = useTranslations("Products.form.preview");
  const tStock = useTranslations("Common.stock");
  const tStatus = useTranslations("Products.status");
  const locale = useLocale() as Locale;
  const stock = deriveStockBadge({ trackStock, stockQuantity, lowStockThreshold });
  const DeliveryIcon = isDigital ? Download : Truck;

  return (
    <div aria-hidden="true" className={className} data-product-preview="">
      <p className={cn(eyebrowClass, "mb-2 px-1")}>{t("heading")}</p>
      <div className={cn(cardClass, "overflow-hidden")}>
        <div className="relative aspect-square bg-secondary">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local object URL or an already-signed one.
            <img src={imageUrl} alt="" className="size-full object-cover" />
          ) : (
            <div className="grid size-full place-items-center text-muted-foreground">
              <span className="flex flex-col items-center gap-2">
                <ImageIcon className="size-8" strokeWidth={1.25} />
                <span className="font-inter text-xs">{t("noPhoto")}</span>
              </span>
            </div>
          )}
          <span
            className={cn(
              badgeClass,
              "absolute left-2 top-2 shadow-xs",
              status === "active" ? "bg-background text-success" : "bg-background text-muted-foreground",
            )}
          >
            {tStatus(status)}
          </span>
        </div>
        <div className="space-y-1.5 p-3">
          <p
            className={cn(
              "line-clamp-2 text-sm font-semibold",
              title.trim() ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {title.trim() || t("titlePlaceholder")}
          </p>
          <p className="font-inter text-base font-semibold tabular-nums text-foreground">
            {priceCents !== null ? formatCents(priceCents, currency, locale) : "—"}
          </p>
          <div className="flex flex-col gap-1 pt-1 font-inter text-xs text-muted-foreground">
            <span className="flex min-w-0 items-center gap-1.5">
              <DeliveryIcon className="size-3.5 shrink-0" strokeWidth={2} />
              <span className="truncate">{isDigital ? t("download") : dispatch || t("ships")}</span>
            </span>
            {stock && (
              <span
                className={cn(
                  "flex items-center gap-1.5",
                  stock.state === "sold_out" && "text-destructive",
                )}
              >
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    stock.state === "in_stock" ? "bg-success" : "bg-destructive",
                  )}
                />
                {stock.state === "in_stock"
                  ? tStock("inStock")
                  : stock.state === "sold_out"
                    ? tStock("soldOut")
                    : tStock("lowStock", { remaining: stock.remaining })}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

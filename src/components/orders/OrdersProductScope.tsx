"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { ProductThumb } from "@/components/ui/ProductThumb";
import { ghostButtonClass, infoTextClass } from "@/components/ui/control-styles";
import { isModifiedClick } from "@/lib/utils/modified-click";
import { cn } from "@/lib/utils";
import type { Product } from "@/types/product";

/**
 * The Orders page narrowed to one product (`?product=<id>`, from a product
 * card's "N orders to ship" link): which product, by name and photo, and the
 * one way back to every product's orders. Without it a seller looking at a
 * short list would not know it was short on purpose.
 */
export function OrdersProductScope({
  product,
  clearHref,
  onNavigate,
}: {
  product: Pick<Product, "title" | "imageUrl">;
  /** The same list with the product scope removed. */
  clearHref: string;
  /** The page's own navigation (a transition with its busy state); modified
   *  clicks keep the browser's behaviour, as in PageTabs. */
  onNavigate: (href: string) => void;
}) {
  const t = useTranslations("Orders.productScope");
  return (
    <div
      data-orders-product-scope
      className="flex items-center gap-3 border border-border bg-card py-2 pl-2 pr-1"
    >
      <ProductThumb src={product.imageUrl} className="size-9" />
      <p className="min-w-0 flex-1">
        <span className={cn(infoTextClass, "block")}>{t("label")}</span>
        <span className="block truncate text-sm font-medium text-foreground">{product.title}</span>
      </p>
      <Link
        href={clearHref}
        onClick={(event) => {
          if (isModifiedClick(event)) return;
          event.preventDefault();
          onNavigate(clearHref);
        }}
        aria-label={t("clearLabel", { title: product.title })}
        className={cn(ghostButtonClass, "shrink-0 gap-1.5 px-3 py-2")}
      >
        <X className="size-4 shrink-0" aria-hidden="true" />
        {t("clear")}
      </Link>
    </div>
  );
}

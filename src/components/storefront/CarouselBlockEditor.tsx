"use client";

import { useId, useState } from "react";
import { ArrowDown, ArrowUp, Check, Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/format";
import { moveCarouselProduct } from "@/lib/storefront/carousel";
import { ProductThumb } from "@/components/ui/ProductThumb";
import {
  addedIconButtonClass,
  addIconButtonClass,
  fieldBaseClass,
  helpTextClass,
  iconButtonClass,
  iconPopClass,
  infoTextClass,
  labelClass,
} from "@/components/ui/control-styles";
import { mutedBadgeClass } from "@/components/ui/surface-styles";
import { CAROUSEL_PRODUCTS_MAX, type CarouselBlock } from "@/types/storefront";
import type { Product } from "@/types/product";
import type { Locale } from "@/i18n/locales";
import { BlockActions } from "./BlockActions";

/** A catalogue this long gets a search box; a shorter one is read at a glance
 *  (the same threshold as the add-ons list). */
const SEARCH_FROM = 8;

/** The small up and down arrows on a chosen row. */
const MOVE_BUTTON_CLASS = cn(iconButtonClass, "size-8 shrink-0 aria-disabled:pointer-events-none aria-disabled:opacity-40");

/** A row of the panel's lists: a thumbnail, the product's name and price, and
 *  its buttons at the end. */
const ROW_CLASS = "flex items-center gap-2 px-2 py-1.5";

/**
 * Inspector for a PRODUCT CAROUSEL: ONE control, which products it holds and
 * in what order. The chosen products are listed first, in the row's order,
 * each with an arrow up, an arrow down and a check that takes it out; under
 * them the rest of the catalogue, each with a "+" that adds it to the end.
 * Everything else about the cards is the board's card look (Product cards),
 * so there is nothing to style here.
 *
 * A carousel always holds one product (the schema says so), so the last one
 * cannot be taken out: removing the carousel is the way to have none.
 */
export function CarouselBlockEditor({
  block,
  catalog,
  onChange,
  onDuplicate,
  onRemove,
}: {
  block: CarouselBlock;
  /** The seller's products, in the catalogue's own order (newest first). */
  catalog: readonly Product[];
  /** The carousel's new list of products, in order. Never empty. */
  onChange: (productIds: string[]) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const fieldId = useId();
  const t = useTranslations("EditorLayout.panel.carousel");
  const tRoot = useTranslations("Storefront");
  const locale = useLocale() as Locale;
  const [search, setSearch] = useState("");

  const byId = new Map(catalog.map((product) => [product.id, product]));
  const ids = block.productIds;
  const full = ids.length >= CAROUSEL_PRODUCTS_MAX;
  const others = catalog.filter((product) => !ids.includes(product.id));
  const term = search.trim().toLocaleLowerCase(locale);
  const shownOthers = term ? others.filter((product) => product.title.toLocaleLowerCase(locale).includes(term)) : others;

  const name = (id: string) => byId.get(id)?.title ?? tRoot("blockTile.removedProduct");

  return (
    <div className="space-y-4" data-carousel-editor={block.id}>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <span id={`${fieldId}-label`} className={labelClass}>
            {t("products")}
          </span>
          <p className={cn(infoTextClass, "shrink-0 tabular-nums", full && "font-medium text-foreground")}>
            <span aria-hidden="true">
              {ids.length}/{CAROUSEL_PRODUCTS_MAX}
            </span>
            <span className="sr-only">{t("count", { count: ids.length, max: CAROUSEL_PRODUCTS_MAX })}</span>
          </p>
        </div>

        <ol aria-labelledby={`${fieldId}-label`} className="divide-y divide-border border border-border" data-carousel-chosen="">
          {ids.map((id, index) => {
            const product = byId.get(id);
            const title = name(id);
            const first = index === 0;
            const last = index === ids.length - 1;
            const only = ids.length === 1;
            return (
              <li key={id} className={cn(ROW_CLASS, "bg-accent/40")} data-carousel-product={id}>
                <ProductRowText product={product} title={title} locale={locale} draftLabel={tRoot("picker.draftBadge")} draftHint={tRoot("picker.draftAriaLabel")} />
                <button
                  type="button"
                  onClick={() => !first && onChange(moveCarouselProduct(ids, index, -1))}
                  aria-disabled={first || undefined}
                  aria-label={t("moveEarlier", { title })}
                  className={MOVE_BUTTON_CLASS}
                  data-carousel-move="earlier"
                >
                  <ArrowUp className="size-4" strokeWidth={2} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => !last && onChange(moveCarouselProduct(ids, index, 1))}
                  aria-disabled={last || undefined}
                  aria-label={t("moveLater", { title })}
                  className={MOVE_BUTTON_CLASS}
                  data-carousel-move="later"
                >
                  <ArrowDown className="size-4" strokeWidth={2} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => !only && onChange(ids.filter((candidate) => candidate !== id))}
                  // The last one stays: a carousel always holds a product.
                  aria-disabled={only || undefined}
                  aria-label={only ? t("keepOne") : t("remove", { title })}
                  title={only ? t("keepOne") : undefined}
                  className={cn(addedIconButtonClass, "aria-disabled:pointer-events-none aria-disabled:opacity-40")}
                  data-carousel-remove=""
                >
                  <Check className="size-4" strokeWidth={2.5} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ol>

        {others.length > 0 && (
          <div className="space-y-2 pt-2">
            <p id={`${fieldId}-others`} className={labelClass}>
              {t("addProducts")}
            </p>
            {full && (
              <p className={helpTextClass} data-carousel-full="">
                {t("full", { max: CAROUSEL_PRODUCTS_MAX })}
              </p>
            )}
            {others.length >= SEARCH_FROM && (
              <input
                type="search"
                aria-label={t("search")}
                placeholder={t("search")}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className={cn(fieldBaseClass, "py-2 text-sm")}
              />
            )}
            {shownOthers.length === 0 ? (
              <p className={helpTextClass} role="status">
                {t("noMatch")}
              </p>
            ) : (
              <ul
                aria-labelledby={`${fieldId}-others`}
                className="max-h-72 divide-y divide-border overflow-y-auto border border-border"
                data-carousel-others=""
              >
                {shownOthers.map((product) => (
                  <li key={product.id} className={ROW_CLASS} data-carousel-offer={product.id}>
                    <ProductRowText product={product} title={product.title} locale={locale} draftLabel={tRoot("picker.draftBadge")} draftHint={tRoot("picker.draftAriaLabel")} />
                    <button
                      type="button"
                      onClick={() => onChange([...ids, product.id])}
                      disabled={full}
                      aria-label={t("add", { title: product.title })}
                      className={addIconButtonClass}
                      data-carousel-add=""
                    >
                      <Plus className={cn("size-4", iconPopClass)} strokeWidth={2} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <BlockActions onDuplicate={onDuplicate} onRemove={onRemove} />
    </div>
  );
}

/** A row's thumbnail, name and price, with the Draft chip a buyer-hidden
 *  product wears in the product picker. */
function ProductRowText({
  product,
  title,
  locale,
  draftLabel,
  draftHint,
}: {
  product: Product | undefined;
  title: string;
  locale: Locale;
  draftLabel: string;
  draftHint: string;
}) {
  return (
    <>
      <ProductThumb src={product?.imageUrl} loading="lazy" className="size-9" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="block truncate font-inter text-sm font-medium text-foreground">{title}</span>
          {product?.status === "draft" && (
            <span className={mutedBadgeClass} title={draftHint}>
              {draftLabel}
            </span>
          )}
        </span>
        {product && (
          <span className="block font-inter text-xs text-muted-foreground tabular-nums">
            {formatPrice(product.sale?.price ?? product.price, product.currency, locale)}
          </span>
        )}
      </span>
    </>
  );
}

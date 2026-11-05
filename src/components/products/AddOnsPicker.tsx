"use client";

import { useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, EyeOff, Plus } from "lucide-react";
import type { Locale } from "@/i18n/locales";
import type { AddOnChoice } from "@/lib/products/add-on-choices";
import { chosenAddOns } from "@/lib/products/add-on-visibility";
import type { AddOnHabits } from "@/lib/predictions";
import { ADD_ONS_MAX, type Currency } from "@/types/product";
import { formatCents } from "@/lib/format/money";
import { cn } from "@/lib/utils";
import { ProductThumb } from "@/components/ui/ProductThumb";
import {
  addedIconButtonClass,
  addIconButtonClass,
  fieldBaseClass,
  helpTextClass,
  iconPopClass,
  infoTextClass,
  labelClass,
} from "@/components/ui/control-styles";
import { badgeClass } from "@/components/ui/surface-styles";
import { AddOnsSuggestion } from "./AddOnsSuggestion";

/** A list this long gets a search box; a shorter one is read at a glance. */
const SEARCH_FROM = 8;

/** A chip for something buyers do not see (a draft, one sold out...): the
 *  same struck-through eye the preview's faded card wears. */
function HiddenChip({ label, hint, ...data }: { label: string; hint: string } & Record<`data-${string}`, string>) {
  return (
    <span className={cn(badgeClass, "inline-flex items-center gap-1")} title={hint} {...data}>
      <EyeOff className="size-3" strokeWidth={2} aria-hidden="true" />
      {label}
    </span>
  );
}

/**
 * ONE LIST, ONE BUTTON PER ROW: other products of the store, each with a "+".
 * Pressing it adds the product and turns it into a check, and pressing that
 * takes it off. Rows never move while the seller is pressing, so a double tap
 * can undo itself; what was already chosen sits at the top when it opens. Only
 * products of the same kind and currency are listed, because a parcel and a
 * download cannot share an order here; a chosen one that no longer matches (the
 * seller switched this product's kind) stays, marked, so nothing is dropped
 * behind their back.
 *
 * The product form's field and the storefront editor's panel both choose with
 * this. Its label line counts what is chosen against the most there can be,
 * which is all a full list needs to say. Under it, when the store's history
 * has one, a one-tap guess (AddOnsSuggestion). Its parent spaces its lines.
 */
export function AddOnsPicker({
  inputId,
  label,
  listName,
  productId,
  isDigital,
  currency,
  choices,
  habits,
  value,
  onChange,
}: {
  inputId: string;
  /** The label line's words; absent = "Your other products". */
  label?: ReactNode;
  /** The list's name for a screen reader, when the label line is not plain words. */
  listName?: string;
  /** The product being edited, which can never be its own add-on. Null on create. */
  productId: string | null;
  /** This product's kind. */
  isDigital: boolean;
  /** This product's currency. */
  currency: Currency;
  /** The store's products, read on the server (lib/products/add-on-choices.ts). */
  choices: readonly AddOnChoice[];
  /** What the store's history says goes with this product; absent offers no guess. */
  habits?: AddOnHabits;
  value: readonly string[];
  onChange: (next: string[]) => void;
}) {
  const t = useTranslations("Products.addOnsField");
  const tStock = useTranslations("Common.stock");
  const locale = useLocale() as Locale;
  const [search, setSearch] = useState("");
  // Fixed when it opens, so a row stays where it is while it is pressed.
  const [chosenAtOpen] = useState<readonly string[]>(value);

  const fits = (choice: AddOnChoice) => choice.isDigital === isDigital && choice.currency === currency;
  const chosen = chosenAddOns(choices, value);
  const room = chosen.length < ADD_ONS_MAX;
  const others = choices.filter((choice) => choice.id !== productId);
  const listed = others
    .filter((choice) => fits(choice) || value.includes(choice.id))
    .sort((a, b) => rank(a.id) - rank(b.id));
  function rank(id: string) {
    const at = chosenAtOpen.indexOf(id);
    return at === -1 ? chosenAtOpen.length : at;
  }

  const term = search.trim().toLocaleLowerCase(locale);
  const shown = term
    ? listed.filter((choice) => choice.title.toLocaleLowerCase(locale).includes(term))
    : listed;

  function toggle(id: string) {
    const ids = chosen.map((choice) => choice.id);
    onChange(ids.includes(id) ? ids.filter((candidate) => candidate !== id) : [...ids, id]);
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div id={`${inputId}-list`} className={cn(labelClass, "min-w-0 flex-1")}>
          {label ?? t("listLabel")}
        </div>
        <p
          className={cn(infoTextClass, "shrink-0 tabular-nums", !room && "font-medium text-foreground")}
          data-product-add-ons-count={chosen.length}
        >
          <span aria-hidden="true">
            {chosen.length}/{ADD_ONS_MAX}
          </span>
          <span className="sr-only">{t("count", { count: chosen.length, max: ADD_ONS_MAX })}</span>
        </p>
      </div>
      {others.length === 0 ? (
        <p className={helpTextClass} data-product-add-ons-none="">
          {t("none")}
        </p>
      ) : listed.length === 0 ? (
        <p className={helpTextClass} data-product-add-ons-none-of-kind="">
          {t("noneFit")}
        </p>
      ) : (
        <>
          {habits && (
            <AddOnsSuggestion
              habits={habits}
              productId={productId}
              host={{ isDigital, currency }}
              choices={choices}
              value={chosen.map((choice) => choice.id)}
              onChange={onChange}
            />
          )}
          {listed.length >= SEARCH_FROM && (
            <input
              id={`${inputId}-search`}
              type="search"
              aria-label={t("search")}
              placeholder={t("search")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className={cn(fieldBaseClass, "py-2 text-sm")}
            />
          )}
          {shown.length === 0 ? (
            <p className={helpTextClass} role="status" data-product-add-ons-no-match="">
              {t("noMatch")}
            </p>
          ) : (
            <ul
              className="max-h-72 divide-y divide-border overflow-y-auto border border-border"
              aria-labelledby={listName ? undefined : `${inputId}-list`}
              aria-label={listName}
            >
              {shown.map((choice) => {
                const added = value.includes(choice.id);
                const otherKind = choice.isDigital !== isDigital;
                const otherCurrency = choice.currency !== currency;
                return (
                  <li
                    key={choice.id}
                    className={cn(
                      "flex items-center gap-3 px-2 py-1.5 transition-colors duration-base ease-standard motion-reduce:transition-none",
                      added && "bg-accent/40",
                    )}
                    data-product-add-on={choice.id}
                    data-product-add-on-state={added ? "added" : "offered"}
                  >
                    <ProductThumb src={choice.imageUrl} loading="lazy" className="size-10" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-inter text-sm font-medium text-foreground">
                        {choice.title}
                      </p>
                      <p className={cn(infoTextClass, "flex flex-wrap items-center gap-x-2 gap-y-0.5")}>
                        <span className="tabular-nums">
                          {formatCents(choice.priceCents, choice.currency, locale)}
                        </span>
                        {choice.status === "draft" && (
                          <HiddenChip label={t("draft")} hint={t("draftHint")} data-product-add-on-draft="" />
                        )}
                        {choice.soldOut && (
                          <HiddenChip
                            label={tStock("soldOut")}
                            hint={t("soldOutHint")}
                            data-product-add-on-sold-out=""
                          />
                        )}
                        {choice.takenDown && (
                          <HiddenChip
                            label={t("takenDown")}
                            hint={t("takenDownHint")}
                            data-product-add-on-taken-down=""
                          />
                        )}
                        {otherKind ? (
                          <span className="text-destructive" data-product-add-on-other-kind="">
                            {isDigital ? t("notADownload") : t("notPosted")}
                          </span>
                        ) : (
                          otherCurrency && (
                            <span className="text-destructive" data-product-add-on-other-kind="">
                              {t("otherCurrency", { currency: choice.currency })}
                            </span>
                          )
                        )}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggle(choice.id)}
                      // Full, a product can still come off but no other can go on.
                      disabled={!added && !room}
                      aria-label={t(added ? "remove" : "add", { title: choice.title })}
                      className={added ? addedIconButtonClass : addIconButtonClass}
                      data-product-add-on-toggle=""
                    >
                      {added ? (
                        <Check className="size-4" strokeWidth={2.5} aria-hidden="true" />
                      ) : (
                        <Plus className={cn("size-4", iconPopClass)} strokeWidth={2} aria-hidden="true" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </>
  );
}

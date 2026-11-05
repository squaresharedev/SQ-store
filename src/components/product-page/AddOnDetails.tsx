"use client";

import { useState } from "react";
import { ArrowUpRight, Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Modal, ModalActions } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { secondaryButtonClass } from "@/components/ui/control-styles";
import type { Locale } from "@/i18n/locales";
import { formatFixed } from "@/lib/format/intl";
import { cn } from "@/lib/utils";
import { addOnSelectionIds, photoForSelection } from "@/lib/checkout/selection";
import type { AddOnCard } from "@/types/product";
import type { ProductPageSaleStyle } from "@/types/storefront";
import { PageSelect } from "./PageSelect";
import { SalePrice } from "./SalePrice";
import { StarRating } from "./StarRating";
import { DARK_INK, paragraphs } from "./product-page-maps";

/**
 * ONE ADD-ON, LOOKED AT CLOSELY, without leaving the page: its photo, price,
 * stars (when it has reviews and the page shows them), versions and the
 * seller's description, and the same "Add to your order" the card has. "See
 * full page" goes to the product's own page on this storefront, in the same
 * tab: the page the buyer came from keeps what they took in its address, so
 * Back brings it all back.
 *
 * Built from ui/Modal like the page's report dialog: one picture, a short
 * title, one primary button (the blur test, docs/styles.md 8.14).
 */
export function AddOnDetails({
  card,
  open,
  onClose,
  added,
  pickedOptionIds,
  onAdd,
  onRemove,
  saleStyle,
  radius,
  starColor,
  preview,
}: {
  card: AddOnCard;
  open: boolean;
  onClose: () => void;
  /** Already in the order, and in which version. */
  added: boolean;
  pickedOptionIds: readonly string[];
  onAdd: (optionIds: string[]) => void;
  onRemove: () => void;
  saleStyle?: ProductPageSaleStyle;
  /** The storefront's corner, for the version pickers. Their ink is the app's:
   *  the dialog is the app's own surface (ui/Modal), not the page's. */
  radius: number;
  /** The page's star colour; absent where the page shows no reviews. */
  starColor?: string;
  /** The editor: the full page link goes nowhere. */
  preview: boolean;
}) {
  const t = useTranslations("ProductPage.addOns");
  const locale = useLocale() as Locale;
  const rating = starColor ? card.rating : null;
  // The version shown: the one already taken, else the first available.
  const [chosen, setChosen] = useState<string[]>(
    () => addOnSelectionIds(card.optionGroups, pickedOptionIds) ?? [],
  );
  const selection = Object.fromEntries(
    card.optionGroups.flatMap((group) => {
      const option = group.options.find((candidate) => chosen.includes(candidate.id));
      return option ? [[group.id, option]] : [];
    }),
  );
  const photo = photoForSelection(card.images, selection);
  const available = addOnSelectionIds(card.optionGroups, chosen) !== null;

  function choose(groupId: string, optionId: string) {
    const group = card.optionGroups.find((candidate) => candidate.id === groupId);
    const inGroup = new Set(group?.options.map((option) => option.id) ?? []);
    const next = [...chosen.filter((id) => !inGroup.has(id)), optionId];
    setChosen(next);
    // A version changed on something already in the order changes the order.
    if (added) onAdd(next);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={card.title}
      size="md"
      visual={
        photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- a presigned R2 URL, like the product gallery's
          <img
            src={photo.url}
            alt={photo.alt}
            className="mx-auto max-h-64 w-full object-contain"
            data-add-on-details-photo=""
          />
        ) : undefined
      }
    >
      <div className="space-y-4" data-add-on-details={card.id}>
        <p className="text-center text-lg font-semibold text-foreground">
          <SalePrice
            priceCents={card.priceCents}
            currency={card.currency}
            sale={card.sale}
            priceClassName="text-lg font-semibold"
            size="sm"
            saleStyle={saleStyle}
          />
        </p>

        {rating && (
          <div
            className="flex items-center justify-center gap-1.5 text-sm text-foreground"
            data-add-on-details-rating={rating.average}
          >
            <StarRating
              value={rating.average}
              label={t("rating", { average: formatFixed(rating.average, 1, locale), count: rating.count })}
              color={starColor}
            />
            <span className="font-medium tabular-nums" aria-hidden="true">
              {formatFixed(rating.average, 1, locale)}
            </span>
            <span className="tabular-nums text-muted-foreground" aria-hidden="true">
              ({rating.count})
            </span>
          </div>
        )}

        {card.optionGroups.length > 0 && (
          <div className="flex flex-wrap justify-center gap-2">
            {card.optionGroups.map((group) => (
              <PageSelect
                key={group.id}
                id={`add-on-details-${card.id}-${group.id}`}
                label={t("optionLabel", { group: group.name, product: card.title })}
                value={selection[group.id]?.id ?? ""}
                options={group.options.map((option) => ({
                  value: option.id,
                  label: option.name,
                  disabled: !option.available,
                }))}
                onChange={(optionId) => choose(group.id, optionId)}
                radius={radius}
                ink={DARK_INK}
                className="min-w-32"
              />
            ))}
          </div>
        )}

        {card.description.trim() !== "" && (
          <div className="max-h-48 space-y-2 overflow-y-auto text-sm leading-relaxed text-foreground">
            {paragraphs(card.description).map((text, index) => (
              <p key={index} className="whitespace-pre-line">
                {text}
              </p>
            ))}
          </div>
        )}

        <ModalActions>
          {card.pagePath && (
            <a
              href={preview ? undefined : card.pagePath}
              aria-disabled={preview || undefined}
              className={cn(secondaryButtonClass, "justify-center")}
              data-add-on-full-page=""
            >
              {t("fullPage")}
              <ArrowUpRight className="size-4" strokeWidth={2} aria-hidden="true" />
            </a>
          )}
          <Button
            type="button"
            variant={added ? "secondary" : "primary"}
            disabled={!added && !available}
            onClick={() => {
              if (added) onRemove();
              else onAdd(chosen);
              onClose();
            }}
            data-add-on-details-toggle={added ? "remove" : "add"}
          >
            {added ? (
              t("removeFromOrder")
            ) : (
              <>
                <Plus className="size-4" strokeWidth={2.25} aria-hidden="true" />
                {t("addToOrder")}
              </>
            )}
          </Button>
        </ModalActions>
      </div>
    </Modal>
  );
}

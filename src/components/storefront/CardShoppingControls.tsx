"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { InfoTip } from "@/components/ui/InfoTip";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { strongLabelClass } from "@/components/ui/control-styles";
import { CARD_BUY_BUTTONS, type CardStyle, type CardStyleOverrides } from "@/types/storefront";
import { SwitchRow } from "./SwitchRow";

/**
 * WHAT A CARD SAYS TO SOMEONE ABOUT TO BUY: a buy button on the card (off, or
 * one of three looks of the product page's own button), the buyers' stars,
 * and "Low stock" when a product is running out. Like CardHoverControls it
 * edits the theme's cards or one tile's own and emits only what changed.
 *
 * The stars' tip changes with the product page: with its reviews off a card
 * shows none, and a switch that does nothing has to say why.
 */
export function CardShoppingControls({
  value,
  onChange,
  reviewsShown,
}: {
  value: CardStyle;
  onChange: (patch: CardStyleOverrides) => void;
  /** Whether the product page shows reviews (isProductPageSectionShown). */
  reviewsShown: boolean;
}) {
  const t = useTranslations("Storefront.cardExtras");
  const fieldId = useId();
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <span className="flex items-center gap-1.5">
          <span className={strongLabelClass}>{t("buyButton")}</span>
          <InfoTip label={t("buyButtonTipLabel")}>{t("buyButtonTip")}</InfoTip>
        </span>
        <SegmentedControl
          value={value.buyButton}
          onChange={(buyButton) => onChange({ buyButton })}
          ariaLabel={t("buyButtonAriaLabel")}
          options={CARD_BUY_BUTTONS.map((look) => ({ value: look, label: t(`buyButtons.${look}`) }))}
        />
      </div>
      <SwitchRow
        id={`${fieldId}-rating`}
        label={t("rating")}
        checked={value.showRating}
        onCheckedChange={(showRating) => onChange({ showRating })}
        tipLabel={t("ratingTipLabel")}
        tip={reviewsShown ? t("ratingTip") : t("ratingTipReviewsOff")}
      />
      <SwitchRow
        id={`${fieldId}-low-stock`}
        label={t("lowStock")}
        checked={value.showLowStock}
        onCheckedChange={(showLowStock) => onChange({ showLowStock })}
        tipLabel={t("lowStockTipLabel")}
        tip={t("lowStockTip")}
      />
    </div>
  );
}

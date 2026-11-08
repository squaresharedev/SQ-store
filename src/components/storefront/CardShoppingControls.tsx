"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { InfoTip } from "@/components/ui/InfoTip";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { strongLabelClass } from "@/components/ui/control-styles";
import { sanitizeHeaderText } from "@/lib/storefront/header-text";
import { resolveTileLook } from "@/lib/storefront/tile-look";
import {
  CARD_BUY_BUTTONS,
  PRODUCT_PAGE_CTA_MAX,
  resolveCardStyle,
  type CardStyle,
  type CardStyleOverrides,
  type ProductPageConfig,
  type StorefrontTheme,
} from "@/types/storefront";
import { tileBuyButtonPaint } from "./config-maps";
import { PanelTextField } from "./PanelField";
import { SwitchRow } from "./SwitchRow";

/** The buy button's own fields, which each fall back to the layer below. */
type OwnButtonField = "buyButtonLabel" | "buyButtonColor" | "buyButtonTextColor";

/**
 * WHAT A CARD SAYS TO SOMEONE ABOUT TO BUY: a buy button on the card (off, or
 * one of three looks), its words and colours, the buyers' stars, and "Low
 * stock" when a product is running out. Like CardHoverControls it edits the
 * theme's cards or one tile's own and emits only what changed.
 *
 * The button starts as the product page's own (resolveTileLook), and its
 * words and colours are the seller's to change for the cards. It takes both
 * layers for the reason SaleBadgeControls does: each of them is optional, and
 * the field's placeholder and each inherit dot have to say what THIS layer
 * falls back to (the theme's cards on a tile, the product page's button on
 * the theme).
 *
 * The stars' tip changes with the product page: with its reviews off a card
 * shows none, and a switch that does nothing has to say why.
 */
export function CardShoppingControls({
  theme,
  overrides,
  productPage,
  onChange,
}: {
  theme: StorefrontTheme;
  /** The tile override being edited. Absent = editing the theme itself. */
  overrides?: CardStyleOverrides;
  /** The storefront's product page, whose button and reviews a card borrows. */
  productPage?: ProductPageConfig;
  onChange: (patch: CardStyleOverrides) => void;
}) {
  const t = useTranslations("Storefront.cardExtras");
  const tRoot = useTranslations();
  const fieldId = useId();
  const value = resolveCardStyle(theme, overrides);
  const look = resolveTileLook({ theme, productPage });
  const buyLook = value.buyButton === "none" ? null : value.buyButton;

  // What the layer being edited stores, and the card it would be without one
  // of its fields: resolved by the same rule the tile uses, so what a dot says
  // it follows is what the card draws.
  const editingTile = overrides !== undefined;
  const own: Pick<CardStyleOverrides, OwnButtonField> = editingTile ? overrides : theme;
  const without = (field: OwnButtonField): CardStyle =>
    editingTile
      ? resolveCardStyle(theme, { ...overrides, [field]: undefined })
      : resolveCardStyle({ ...theme, [field]: undefined });
  // The theme's cards set it (and a tile falls back to them), or nothing does
  // and it falls back to the product page.
  const themeSets = (field: OwnButtonField) => editingTile && theme[field] !== undefined;

  const paint = buyLook ? tileBuyButtonPaint(buyLook, look.buy, value) : null;
  const colorBelow = buyLook ? tileBuyButtonPaint(buyLook, look.buy, without("buyButtonColor")).color : "";
  const inkBelow = buyLook ? tileBuyButtonPaint(buyLook, look.buy, without("buyButtonTextColor")).ink : "";

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
          options={CARD_BUY_BUTTONS.map((option) => ({ value: option, label: t(`buyButtons.${option}`) }))}
        />
      </div>
      {buyLook && paint && (
        <>
          {/* Empty = the words below it, shown as the placeholder, so clearing
              the field hands the button back rather than leaving it blank. */}
          <PanelTextField
            id={`${fieldId}-buy-label`}
            label={tRoot("Storefront.productPage.cta.buttonText.label")}
            value={own.buyButtonLabel ?? ""}
            placeholder={without("buyButtonLabel").buyButtonLabel ?? look.buyLabel}
            max={PRODUCT_PAGE_CTA_MAX}
            charsLeft={(count) => tRoot("Storefront.productPage.cta.buttonText.charsLeft", { count })}
            onChange={(raw) => {
              const words = sanitizeHeaderText(raw, false);
              onChange({ buyButtonLabel: words.trim() === "" ? undefined : words });
            }}
          />
          {/* A link is only words, so it has only their colour. */}
          {buyLook !== "link" && (
            <ColorPicker
              label={tRoot("Storefront.productPage.cta.buttonColor")}
              value={paint.color}
              onChange={(buyButtonColor) => onChange({ buyButtonColor })}
              inherit={{
                label: themeSets("buyButtonColor")
                  ? tRoot("Storefront.colors.inherit.themeColor.label")
                  : t("pageButton.label"),
                useLabel: themeSets("buyButtonColor")
                  ? tRoot("Storefront.colors.inherit.themeColor.use")
                  : t("pageButton.use"),
                value: colorBelow,
                active: own.buyButtonColor === undefined,
                onSelect: () => onChange({ buyButtonColor: undefined }),
              }}
            />
          )}
          <ColorPicker
            label={tRoot("Storefront.colors.fields.textColor")}
            value={paint.ink}
            onChange={(buyButtonTextColor) => onChange({ buyButtonTextColor })}
            inherit={{
              label: tRoot(
                themeSets("buyButtonTextColor")
                  ? "Storefront.colors.inherit.themeColor.label"
                  : "Storefront.colors.inherit.auto.label",
              ),
              useLabel: tRoot(
                themeSets("buyButtonTextColor")
                  ? "Storefront.colors.inherit.themeColor.use"
                  : "Storefront.colors.inherit.auto.use",
              ),
              value: inkBelow,
              active: own.buyButtonTextColor === undefined,
              onSelect: () => onChange({ buyButtonTextColor: undefined }),
            }}
          />
        </>
      )}
      <SwitchRow
        id={`${fieldId}-rating`}
        label={t("rating")}
        checked={value.showRating}
        onCheckedChange={(showRating) => onChange({ showRating })}
        tipLabel={t("ratingTipLabel")}
        tip={look.reviewsShown ? t("ratingTip") : t("ratingTipReviewsOff")}
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

"use client";

import type { CSSProperties, ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { Product } from "@/types/product";
import {
  SALE_BADGES,
  SALE_BADGE_LOOKS,
  TILE_SPOTS,
  resolveCardStyle,
  resolvePriceTagPosition,
  resolveSaleBadgePosition,
  saleBadgeTakenRows,
  spotRow,
  titleBandRow,
  type CardStyleOverrides,
  type SaleBadge,
  type SaleBadgeLook,
  type StorefrontTheme,
  type TileSpot,
} from "@/types/storefront";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { infoTextClass, strongLabelClass } from "@/components/ui/control-styles";
import { cn } from "@/lib/utils";
import { PRICE_TAG_FONT_CLASSES } from "./config-maps";
import { OptionCardPicker, optionGlyphFrameClass } from "./OptionCardPicker";
import { SaleChip, useSaleChipWords, type SaleChipOffer } from "./SaleChip";
import { TileSpotPicker, unclippedSpots } from "./TileSpotPicker";

/** What the pictures say where there is no real sale to show: a fifth off, or
 *  five of the currency. */
const SAMPLE_OFFER: Omit<SaleChipOffer, "currency"> = { amountCents: 500, percent: 20 };
/** The chip's type size in a picture, and its inset from the picture's edge. */
const GLYPH_CHIP_STYLE = { "--tag-inset": "3px" } as CSSProperties;
const GLYPH_CHIP_SIZE = "7px";

/**
 * THE SALE CHIP'S CONTROLS: what a product on sale wears on its tile, in which
 * look, where, and in which fill (SALE_BADGES, SALE_BADGE_LOOKS).
 *
 * The price tag's patch contract and its two scopes: the theme's own setting
 * under Product cards, and one tile's override in its inspector, from the same
 * component. It takes both layers for the reason PriceTagControls does: the
 * fill is optional, and its inherit dot has to say whether THIS layer sets it.
 *
 * The looks are picked from pictures of the real chip (SaleChip), saying what
 * it will say, in the fill and spot chosen below, so the picture a seller
 * picks is the chip a buyer gets. On a tile's own inspector they say what that
 * product's sale takes off, when it has one.
 *
 * Nothing here is typed by the seller: what the chip says is worked out from
 * the prices, so there is no text to check and no number to get wrong.
 */
export function SaleBadgeControls({
  theme,
  overrides,
  onChange,
  product,
  afterLook,
}: {
  theme: StorefrontTheme;
  /** The tile override being edited. Absent = editing the theme itself. */
  overrides?: CardStyleOverrides;
  onChange: (patch: CardStyleOverrides) => void;
  /** The tile's product, when editing one: its sale (or its currency) words
   *  the pictures. */
  product?: Product;
  /** Shown under the looks: the theme's chip scale (ChipScaleControl), at
   *  theme scope only. */
  afterLook?: ReactNode;
}) {
  const t = useTranslations("Storefront.saleBadge");
  const tRoot = useTranslations();
  const words = useSaleChipWords();
  const value = resolveCardStyle(theme, overrides);

  const saysLabels: Record<SaleBadge, string> = {
    percent: t("percent"),
    amount: t("amount"),
    sale: tRoot("ProductPage.sale.badgeSale"),
    hidden: tRoot("Storefront.priceTagPosition.hidden"),
  };
  const lookLabels: Record<SaleBadgeLook, string> = {
    pill: t("look.pill"),
    sticker: t("look.sticker"),
    flag: t("look.flag"),
    ribbon: t("look.ribbon"),
  };

  // Resolved exactly as the tile resolves it, so the dot shown selected is the
  // spot the chip will really take, and the rows the title band and the price
  // hold are simply not offered.
  const titleBand = titleBandRow(value);
  const priceTag = resolvePriceTagPosition(value.priceTagPosition, {
    cornerRadius: value.cornerRadius,
    titleBand,
  });
  const spot = resolveSaleBadgePosition(value.saleBadgePosition, {
    cornerRadius: value.cornerRadius,
    titleBand,
    priceTag,
  });
  // The free rows, and the chip's own spot when it has had to share the
  // price's row (the one layout with no free edge), so the dot shown selected
  // is always on the board.
  const taken = saleBadgeTakenRows({ titleBand, priceTag });
  const available = unclippedSpots(TILE_SPOTS, value.cornerRadius).filter(
    (candidate) => candidate === spot || !taken.has(spotRow(candidate)),
  );

  // Whether the layer being edited sets the fill, and what it falls back to.
  const editingTile = overrides !== undefined;
  const stored = editingTile ? overrides.saleBadgeColor : theme.saleBadgeColor;
  const inherited = editingTile ? (theme.saleBadgeColor ?? theme.accent) : theme.accent;
  const fill = stored ?? inherited;

  // What the pictures say: this product's own sale where there is one.
  const offer: SaleChipOffer = product?.sale
    ? {
        amountCents: Math.round(product.price * 100) - Math.round(product.sale.price * 100),
        percent: product.sale.offerPercent,
        currency: product.currency,
      }
    : { ...SAMPLE_OFFER, currency: product?.currency ?? "EUR" };
  const label = value.saleBadge === "hidden" ? "" : words(value.saleBadge, offer);

  return (
    <div className="space-y-4" data-sale-badge-controls="">
      <div className="space-y-1.5">
        <span className={strongLabelClass}>{t("says")}</span>
        <SegmentedControl
          value={value.saleBadge}
          options={SALE_BADGES.map((badge) => ({ value: badge, label: saysLabels[badge] }))}
          onChange={(saleBadge) => onChange({ saleBadge })}
          ariaLabel={t("says")}
        />
        <p className={infoTextClass}>{t("hint")}</p>
      </div>

      {value.saleBadge !== "hidden" && (
        <>
          <div className="space-y-1.5">
            <span className={strongLabelClass}>{t("lookLabel")}</span>
            <OptionCardPicker
              value={value.saleBadgeLook}
              options={SALE_BADGE_LOOKS.map((look) => ({
                value: look,
                label: lookLabels[look],
                glyph: (
                  <span aria-hidden="true" className={cn(optionGlyphFrameClass, "relative block size-12 bg-muted")}>
                    <SaleChip
                      look={look}
                      says={value.saleBadge}
                      label={label}
                      spot={spot}
                      fill={fill}
                      fontClass={PRICE_TAG_FONT_CLASSES[value.priceTagFont]}
                      size={GLYPH_CHIP_SIZE}
                      style={GLYPH_CHIP_STYLE}
                    />
                  </span>
                ),
              }))}
              onChange={(saleBadgeLook) => onChange({ saleBadgeLook })}
              ariaLabel={t("lookLabel")}
            />
          </div>
          {afterLook}
          <div className="space-y-1.5">
            <span className={strongLabelClass}>{tRoot("Storefront.cardStyle.position")}</span>
            <TileSpotPicker
              value={spot}
              cornerRadius={value.cornerRadius}
              available={available}
              band={titleBand}
              ariaLabel={tRoot("Storefront.cardStyle.position")}
              spotLabel={(candidate: TileSpot) => t("spot", { spot: candidate.replace("-", "_") })}
              onChange={(saleBadgePosition) => onChange({ saleBadgePosition })}
            />
          </div>
          <ColorPicker
            label={tRoot("Storefront.colors.fields.fill")}
            value={fill}
            onChange={(saleBadgeColor) => onChange({ saleBadgeColor })}
            inherit={{
              label: tRoot("Storefront.colors.inherit.themeColor.label"),
              useLabel: tRoot("Storefront.colors.inherit.themeColor.use"),
              value: inherited,
              active: stored === undefined,
              onSelect: () => onChange({ saleBadgeColor: undefined }),
            }}
          />
        </>
      )}
    </div>
  );
}

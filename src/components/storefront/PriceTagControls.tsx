"use client";

import { useId, useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  CORNER_SPOT_LIMIT,
  PRICE_TAG_BORDER_WIDTH_MAX,
  PRICE_TAG_FONTS,
  PRICE_TAG_RADIUS_MAX,
  PRICE_TAG_SIZE_MAX,
  PRICE_TAG_SIZE_MIN,
  resolveCardStyle,
  resolvePriceTagPosition,
  titleBandRow,
  type CardStyle,
  type CardStyleOverrides,
  type PriceTagFont,
  type StorefrontTheme,
} from "@/types/storefront";
import {
  PRICE_TAG_COLOR_KEYS,
  priceTagColorField,
  type PriceTagPart,
} from "@/lib/theme/color-target";
import { SliderField } from "@/components/ui/SliderField";
import { Switch } from "@/components/ui/switch";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { infoTextClass, strongLabelClass } from "@/components/ui/control-styles";
import { PRICE_TAG_FONT_LABELS } from "./config-maps";
import { PriceTagModePicker, type PriceTagMode } from "./PriceTagPositionPicker";


/**
 * The price tag's own controls: where it sits, and every pixel of the chip
 * itself (typeface, size, fill, text, border, roundness).
 *
 * Same patch contract as CardStyleControls — every edit emits only the field
 * it changed — so the theme's Price tag section and a single tile's inspector
 * drive identical UI, one spreading the patch into the theme and the other
 * storing it as that block's override.
 *
 * It takes BOTH layers rather than one resolved CardStyle, because three of
 * its settings are optional and the pickers have to say whether the layer
 * being edited sets them. Reading only the merged style would mark every tile
 * as overriding the moment the theme picked a color.
 */
export function PriceTagControls({
  theme,
  overrides,
  onChange,
  scope,
}: {
  theme: StorefrontTheme;
  /** The tile override being edited. Absent = editing the theme itself. */
  overrides?: CardStyleOverrides;
  onChange: (patch: CardStyleOverrides) => void;
  /**
   * Which field these wheels aim the docked ColorPanel at: the theme's, one
   * named tile's, or — in a multi-selection, where one edit writes to every
   * selected tile — nothing nameable, so the pickers fall back to their own
   * popovers, which is a supported state.
   */
  scope: "theme" | "many" | { blockKey: string };
}) {
  const t = useTranslations("Storefront.priceTag");
  const tRoot = useTranslations();
  const fieldId = useId();
  const value: CardStyle = resolveCardStyle(theme, overrides);
  const fontOptions = useMemo(
    () => PRICE_TAG_FONTS.map((v) => ({ value: v, label: tRoot(PRICE_TAG_FONT_LABELS[v]) })),
    [tRoot],
  );

  const tagPosition = value.priceTagPosition;
  const tagMode: PriceTagMode =
    tagPosition === "below"
      ? "below"
      : tagPosition === "hidden"
        ? "hidden"
        : "float";

  // Which row the title band holds, when it holds one at all: the row the tag
  // is not allowed to use. Resolved exactly as the tile resolves it, showTitle
  // included — an overlay title that is switched off paints nothing over the
  // picture, so it takes no row away and a tag turned back on belongs at the
  // bottom-left it asks for.
  const titleBand = titleBandRow(value);
  function setTagMode(mode: PriceTagMode) {
    if (mode === tagMode) return;
    onChange({
      priceTagPosition:
        mode === "float"
          ? resolvePriceTagPosition("bottom-left", {
              cornerRadius: value.cornerRadius,
              titleBand,
            })
          : mode,
    });
  }

  /** One color field. All three are optional, so they share the same shape:
   *  an inherit dot that clears the override (never a reset link), and a
   *  target so the wheel opens the docked panel rather than a popover. What
   *  the dot shows comes from color-target — the same call the panel makes, so
   *  the inline row and the panel can never disagree. */
  function colorField(part: PriceTagPart) {
    const field = priceTagColorField(theme, overrides, part);
    const inherit = field.inherit!;
    const key = PRICE_TAG_COLOR_KEYS[part];
    return (
      <ColorPicker
        label={tRoot(field.label)}
        value={field.value}
        onChange={(hex) => onChange({ [key]: hex })}
        inherit={{
          label: tRoot(inherit.label),
          useLabel: tRoot(inherit.useLabel),
          value: inherit.value,
          active: inherit.active,
          onSelect: () => onChange({ [key]: undefined }),
        }}
        target={
          scope === "many"
            ? undefined
            : { kind: "price-tag", part, ...(scope === "theme" ? {} : scope) }
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Where the tag lives, but only at the level a board cannot express:
          in the bar, on the picture, or nowhere. WHICH spot on the picture is
          the layout board's question (see TileLayoutBoard), and asking it twice
          in two places is how the two came to disagree. */}
      <div className="space-y-1.5">
        <span className={strongLabelClass}>{t("showPrice")}</span>
        <PriceTagModePicker value={tagMode} onChange={setTagMode} />
        {tagMode === "float" && (
          <p className={infoTextClass}>
            {value.cornerRadius >= CORNER_SPOT_LIMIT
              ? t("roundedHint")
              : t("dragHint")}
          </p>
        )}
      </div>

      {/* Hover reveal only matters while a tag is shown at all. No hint line
          under it: "Show on hover" already says the whole of what a sentence
          would, and a paragraph restating its own label is noise. */}
      {tagMode !== "hidden" && (
        <div className="flex items-center justify-between gap-3">
          <label htmlFor={`${fieldId}-price-hover`} className={strongLabelClass}>
            {t("showOnHover")}
          </label>
          <Switch
            id={`${fieldId}-price-hover`}
            checked={value.priceDisplay === "hover"}
            onCheckedChange={(hover) =>
              onChange({ priceDisplay: hover ? "hover" : "always" })
            }
          />
        </div>
      )}

      <div className="space-y-1.5">
        <span className={strongLabelClass}>{t("font")}</span>
        <SegmentedControl
          value={value.priceTagFont}
          options={fontOptions}
          onChange={(priceTagFont) => onChange({ priceTagFont })}
          ariaLabel={t("fontAriaLabel")}
        />
      </div>

      {/* One size for the whole tag: the chip's padding scales with the type,
          so this never needs a padding control beside it.

          The number is the size on an ordinary single tile, not a fixed px:
          the chip grows and shrinks with the block it sits on, wherever it
          sits (TILE_LABEL_AUTO_SCALE). That is a caveat, not a control, so it
          goes in the tip rather than as a paragraph the seller reads once and
          then scrolls past forever. A hidden tag has no size to explain. */}
      <SliderField
        id={`${fieldId}-price-size`}
        label={t("size")}
        min={PRICE_TAG_SIZE_MIN}
        max={PRICE_TAG_SIZE_MAX}
        value={value.priceTagSize}
        onChange={(priceTagSize) => onChange({ priceTagSize })}
        ariaLabel={t("sizeAriaLabel")}
        valueText={t("sizeValueText", { n: value.priceTagSize })}
        labelClassName={strongLabelClass}
        unit="px"
        tip={t("sizeTip")}
      />

      {colorField("fill")}
      {colorField("text")}
      {colorField("border")}

      <SliderField
        id={`${fieldId}-price-border-width`}
        label={t("borderThickness")}
        min={0}
        max={PRICE_TAG_BORDER_WIDTH_MAX}
        value={value.priceTagBorderWidth}
        onChange={(priceTagBorderWidth) => onChange({ priceTagBorderWidth })}
        ariaLabel={t("borderAriaLabel")}
        valueText={t("borderValueText", { n: value.priceTagBorderWidth })}
        labelClassName={strongLabelClass}
        unit="px"
        statusText={value.priceTagBorderWidth === 0 ? t("none") : undefined}
      />

      <SliderField
        id={`${fieldId}-price-radius`}
        label={t("cornerRoundness")}
        min={0}
        max={PRICE_TAG_RADIUS_MAX}
        value={value.priceTagRadius}
        onChange={(priceTagRadius) => onChange({ priceTagRadius })}
        ariaLabel={t("cornerAriaLabel")}
        valueText={t("cornerValueText", { n: value.priceTagRadius })}
        labelClassName={strongLabelClass}
        unit="px"
        statusText={
          value.priceTagRadius === 0
            ? t("sharp")
            : value.priceTagRadius >= PRICE_TAG_RADIUS_MAX
              ? t("pill")
              : undefined
        }
      />
    </div>
  );
}

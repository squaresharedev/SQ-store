"use client";

import { useId } from "react";
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

const FONT_OPTIONS: readonly { value: PriceTagFont; label: string }[] =
  PRICE_TAG_FONTS.map((value) => ({ value, label: PRICE_TAG_FONT_LABELS[value] }));

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
  const fieldId = useId();
  const value: CardStyle = resolveCardStyle(theme, overrides);

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
    const key = PRICE_TAG_COLOR_KEYS[part];
    return (
      <ColorPicker
        label={field.label}
        value={field.value}
        onChange={(hex) => onChange({ [key]: hex })}
        inherit={{
          ...field.inherit!,
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
        <span className={strongLabelClass}>Show the price</span>
        <PriceTagModePicker value={tagMode} onChange={setTagMode} />
        {tagMode === "float" && (
          <p className={infoTextClass}>
            {value.cornerRadius >= CORNER_SPOT_LIMIT
              ? "Rounded cards keep the tag on the center axis."
              : "Drag it on the tile, or use the layout board, to choose a spot."}
          </p>
        )}
      </div>

      {/* Hover reveal only matters while a tag is shown at all. No hint line
          under it: "Show on hover" already says the whole of what a sentence
          would, and a paragraph restating its own label is noise. */}
      {tagMode !== "hidden" && (
        <div className="flex items-center justify-between gap-3">
          <label htmlFor={`${fieldId}-price-hover`} className={strongLabelClass}>
            Show on hover
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
        <span className={strongLabelClass}>Font</span>
        <SegmentedControl
          value={value.priceTagFont}
          options={FONT_OPTIONS}
          onChange={(priceTagFont) => onChange({ priceTagFont })}
          ariaLabel="Price tag font"
        />
      </div>

      {/* One size for the whole tag: the chip's padding scales with the type,
          so this never needs a padding control beside it. */}
      <SliderField
        id={`${fieldId}-price-size`}
        label="Size"
        min={PRICE_TAG_SIZE_MIN}
        max={PRICE_TAG_SIZE_MAX}
        value={value.priceTagSize}
        onChange={(priceTagSize) => onChange({ priceTagSize })}
        ariaLabel="Price tag size"
        valueText={`${value.priceTagSize} pixels`}
        labelClassName={strongLabelClass}
        unit="px"
      />

      {colorField("fill")}
      {colorField("text")}
      {colorField("border")}

      <SliderField
        id={`${fieldId}-price-border-width`}
        label="Border thickness"
        min={0}
        max={PRICE_TAG_BORDER_WIDTH_MAX}
        value={value.priceTagBorderWidth}
        onChange={(priceTagBorderWidth) => onChange({ priceTagBorderWidth })}
        ariaLabel="Price tag border thickness"
        valueText={`${value.priceTagBorderWidth} pixels`}
        labelClassName={strongLabelClass}
        unit="px"
        statusText={value.priceTagBorderWidth === 0 ? "None" : undefined}
      />

      <SliderField
        id={`${fieldId}-price-radius`}
        label="Corner roundness"
        min={0}
        max={PRICE_TAG_RADIUS_MAX}
        value={value.priceTagRadius}
        onChange={(priceTagRadius) => onChange({ priceTagRadius })}
        ariaLabel="Price tag corner roundness"
        valueText={`${value.priceTagRadius} pixels`}
        labelClassName={strongLabelClass}
        unit="px"
        statusText={
          value.priceTagRadius === 0
            ? "Sharp"
            : value.priceTagRadius >= PRICE_TAG_RADIUS_MAX
              ? "Pill"
              : undefined
        }
      />
    </div>
  );
}

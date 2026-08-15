"use client";

import { useId } from "react";
import {
  PRICE_TAG_BORDER_WIDTH_MAX,
  PRICE_TAG_CORNER_LIMIT,
  PRICE_TAG_FONTS,
  PRICE_TAG_RADIUS_MAX,
  PRICE_TAG_SIZE_MAX,
  PRICE_TAG_SIZE_MIN,
  resolveCardStyle,
  resolvePriceTagPosition,
  titleOverlaysImage,
  type CardStyle,
  type CardStyleOverrides,
  type PriceTagFloatPosition,
  type PriceTagFont,
  type StorefrontTheme,
} from "@/types/storefront";
import {
  PRICE_TAG_COLOR_KEYS,
  priceTagColorField,
  type PriceTagPart,
} from "@/lib/theme/color-target";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { infoTextClass, strongLabelClass } from "@/components/ui/control-styles";
import { PRICE_TAG_FONT_LABELS } from "./config-maps";
import {
  PriceTagModePicker,
  PriceTagPositionPicker,
  type PriceTagMode,
} from "./PriceTagPositionPicker";

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

  const overlaid = titleOverlaysImage(value.titleStyle);
  // The picker highlights the spot that will really be used, so a stored
  // corner shows as its fallback on a round tile and a stored bottom shows
  // lifted above an overlay title bar.
  const floatValue = resolvePriceTagPosition(tagPosition, {
    cornerRadius: value.cornerRadius,
    titleOverlaysImage: overlaid,
  });

  function setTagMode(mode: PriceTagMode) {
    if (mode === tagMode) return;
    onChange({
      priceTagPosition:
        mode === "float"
          ? resolvePriceTagPosition("bottom-left", {
              cornerRadius: value.cornerRadius,
              titleOverlaysImage: overlaid,
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
      <div className="space-y-1.5">
        <span className={strongLabelClass}>Position</span>
        <PriceTagModePicker value={tagMode} onChange={setTagMode} />
        {tagMode === "float" && (
          <PriceTagPositionPicker
            value={floatValue as PriceTagFloatPosition}
            cornerRadius={value.cornerRadius}
            titleOverlaysImage={overlaid}
            onChange={(priceTagPosition) => onChange({ priceTagPosition })}
          />
        )}
        {tagMode === "float" && value.cornerRadius >= PRICE_TAG_CORNER_LIMIT && (
          <p className={infoTextClass}>
            Rounded cards keep the tag on the center axis.
          </p>
        )}
        {tagMode === "float" && overlaid && (
          <p className={infoTextClass}>
            The title covers the bottom of the image, so the tag stays above it.
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
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className={strongLabelClass}>Size</span>
          <span className={infoTextClass}>{value.priceTagSize}px</span>
        </div>
        <Slider
          min={PRICE_TAG_SIZE_MIN}
          max={PRICE_TAG_SIZE_MAX}
          value={value.priceTagSize}
          onChange={(priceTagSize) => onChange({ priceTagSize })}
          ariaLabel="Price tag size"
          valueText={`${value.priceTagSize} pixels`}
        />
      </div>

      {colorField("fill")}
      {colorField("text")}
      {colorField("border")}

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className={strongLabelClass}>Border thickness</span>
          <span className={infoTextClass}>
            {value.priceTagBorderWidth === 0 ? "None" : `${value.priceTagBorderWidth}px`}
          </span>
        </div>
        <Slider
          min={0}
          max={PRICE_TAG_BORDER_WIDTH_MAX}
          value={value.priceTagBorderWidth}
          onChange={(priceTagBorderWidth) => onChange({ priceTagBorderWidth })}
          ariaLabel="Price tag border thickness"
          valueText={`${value.priceTagBorderWidth} pixels`}
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className={strongLabelClass}>Corner roundness</span>
          <span className={infoTextClass}>
            {value.priceTagRadius === 0
              ? "Sharp"
              : value.priceTagRadius >= PRICE_TAG_RADIUS_MAX
                ? "Pill"
                : value.priceTagRadius}
          </span>
        </div>
        <Slider
          min={0}
          max={PRICE_TAG_RADIUS_MAX}
          value={value.priceTagRadius}
          onChange={(priceTagRadius) => onChange({ priceTagRadius })}
          ariaLabel="Price tag corner roundness"
          valueText={`${value.priceTagRadius} pixels`}
        />
      </div>
    </div>
  );
}

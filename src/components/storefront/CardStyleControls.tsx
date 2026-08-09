"use client";

import { useId } from "react";
import {
  CORNER_RADIUS_MAX,
  PRICE_TAG_CORNER_LIMIT,
  coercePriceTagPosition,
  type CardStyle,
  type CardStyleOverrides,
  type PriceTagFloatPosition,
  type PriceTagSize,
  type PriceTagStyle,
} from "@/types/storefront";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { infoTextClass, strongLabelClass } from "@/components/ui/control-styles";
import {
  PriceTagModePicker,
  PriceTagPositionPicker,
  type PriceTagMode,
} from "./PriceTagPositionPicker";
import { TitleStylePicker } from "./TitleStylePicker";

const PRICE_TAG_STYLE_OPTIONS: readonly { value: PriceTagStyle; label: string }[] = [
  { value: "plain", label: "Plain" },
  { value: "pill", label: "Pill" },
];

const PRICE_TAG_SIZE_OPTIONS: readonly { value: PriceTagSize; label: string }[] = [
  { value: "sm", label: "S" },
  { value: "md", label: "M" },
  { value: "lg", label: "L" },
];

/**
 * The card-appearance controls (corner roundness, title area, price tag),
 * shared by the theme's Cards section and each product tile's inspector card.
 * Fully controlled: `value` is a RESOLVED CardStyle (for a tile, the theme
 * with that block's overrides already applied, see resolveCardStyle) and every
 * edit emits only the fields it changed, so the theme editor spreads the patch
 * into the theme while the tile editor stores it as that block's override.
 * One component, two scopes: the controls can never drift apart.
 */
export function CardStyleControls({
  value,
  onChange,
}: {
  value: CardStyle;
  onChange: (patch: CardStyleOverrides) => void;
}) {
  const fieldId = useId();

  const tagPosition = value.priceTagPosition;
  const tagMode: PriceTagMode =
    tagPosition === "below"
      ? "below"
      : tagPosition === "hidden"
        ? "hidden"
        : "float";
  // The picker highlights the coerced spot, so on heavily rounded cards a
  // stored corner shows (and behaves) as its center-axis fallback.
  const floatValue = coercePriceTagPosition(tagPosition, value.cornerRadius);

  function setTagMode(mode: PriceTagMode) {
    if (mode === tagMode) return;
    onChange({
      priceTagPosition:
        mode === "float"
          ? coercePriceTagPosition("bottom-left", value.cornerRadius)
          : mode,
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className={strongLabelClass}>Corner roundness</span>
          <span className={infoTextClass}>
            {value.cornerRadius === 0
              ? "Sharp"
              : value.cornerRadius >= CORNER_RADIUS_MAX
                ? "Circle"
                : value.cornerRadius}
          </span>
        </div>
        <Slider
          min={0}
          max={CORNER_RADIUS_MAX}
          step={2}
          value={value.cornerRadius}
          onChange={(cornerRadius) => onChange({ cornerRadius })}
          ariaLabel="Corner roundness"
          valueText={`${value.cornerRadius} pixels`}
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <label htmlFor={`${fieldId}-show-title`} className={strongLabelClass}>
          Show title
        </label>
        <Switch
          id={`${fieldId}-show-title`}
          checked={value.showTitle}
          onCheckedChange={(showTitle) => onChange({ showTitle })}
        />
      </div>

      {value.showTitle && (
        <>
          <div className="space-y-1.5">
            <span className={strongLabelClass}>Title style</span>
            <TitleStylePicker
              value={value.titleStyle}
              onChange={(titleStyle) => onChange({ titleStyle })}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor={`${fieldId}-title-hover`} className={strongLabelClass}>
                Show title on hover
              </label>
              <Switch
                id={`${fieldId}-title-hover`}
                checked={value.titleDisplay === "hover"}
                onCheckedChange={(hover) =>
                  onChange({ titleDisplay: hover ? "hover" : "always" })
                }
              />
            </div>
            <p className={infoTextClass}>
              {value.titleStyle === "overlay"
                ? "The bar slides up from the bottom when a buyer hovers."
                : "The title stays hidden until a buyer hovers over the product."}
            </p>
          </div>
        </>
      )}

      <div className="space-y-1.5">
        <span className={strongLabelClass}>Price tag position</span>
        <PriceTagModePicker value={tagMode} onChange={setTagMode} />
        {tagMode === "float" && (
          <PriceTagPositionPicker
            value={floatValue as PriceTagFloatPosition}
            cornerRadius={value.cornerRadius}
            onChange={(priceTagPosition) => onChange({ priceTagPosition })}
          />
        )}
        {tagMode === "float" && value.cornerRadius >= PRICE_TAG_CORNER_LIMIT && (
          <p className={infoTextClass}>
            Rounded cards keep the tag on the center axis.
          </p>
        )}
      </div>

      {/* Hover reveal only matters while a tag is shown at all. No hint line
          under it: "Show price on hover" already says the whole of what the
          sentence used to, and a paragraph restating its own label is noise. */}
      {tagMode !== "hidden" && (
        <div className="flex items-center justify-between gap-3">
          <label htmlFor={`${fieldId}-price-hover`} className={strongLabelClass}>
            Show price on hover
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
        <span className={strongLabelClass}>Price tag style</span>
        <SegmentedControl
          value={value.priceTagStyle}
          options={PRICE_TAG_STYLE_OPTIONS}
          onChange={(priceTagStyle) => onChange({ priceTagStyle })}
          ariaLabel="Price tag style"
        />
      </div>

      {/* Chip size is its own axis: it sets the tag's text size and padding
          wherever the tag sits, floated or in the info bar. */}
      <div className="space-y-1.5">
        <span className={strongLabelClass}>Price tag size</span>
        <SegmentedControl
          value={value.priceTagSize}
          options={PRICE_TAG_SIZE_OPTIONS}
          onChange={(priceTagSize) => onChange({ priceTagSize })}
          ariaLabel="Price tag size"
        />
      </div>
    </div>
  );
}

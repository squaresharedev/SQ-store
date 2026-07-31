"use client";

import { useId } from "react";
import {
  CORNER_RADIUS_MAX,
  PRICE_TAG_CORNER_LIMIT,
  coercePriceTagPosition,
  type PriceTagFloatPosition,
  type PriceTagSize,
  type PriceTagStyle,
  type StorefrontTheme,
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

/** Card appearance controls: shape, title area, price tag, sold-out badge. */
export function CardsSection({
  theme,
  onChange,
}: {
  theme: StorefrontTheme;
  onChange: (theme: StorefrontTheme) => void;
}) {
  const fieldId = useId();

  const tagPosition = theme.priceTagPosition;
  const tagMode: PriceTagMode =
    tagPosition === "below"
      ? "below"
      : tagPosition === "hidden"
        ? "hidden"
        : "float";
  // The picker highlights the coerced spot, so on heavily rounded cards a
  // stored corner shows (and behaves) as its center-axis fallback.
  const floatValue = coercePriceTagPosition(tagPosition, theme.cornerRadius);

  function setTagMode(mode: PriceTagMode) {
    if (mode === tagMode) return;
    onChange({
      ...theme,
      priceTagPosition:
        mode === "float"
          ? coercePriceTagPosition("bottom-left", theme.cornerRadius)
          : mode,
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className={strongLabelClass}>Corner roundness</span>
          <span className={infoTextClass}>
            {theme.cornerRadius === 0
              ? "Sharp"
              : theme.cornerRadius >= CORNER_RADIUS_MAX
                ? "Circle"
                : theme.cornerRadius}
          </span>
        </div>
        <Slider
          min={0}
          max={CORNER_RADIUS_MAX}
          step={2}
          value={theme.cornerRadius}
          onChange={(cornerRadius) => onChange({ ...theme, cornerRadius })}
          ariaLabel="Corner roundness"
          valueText={`${theme.cornerRadius} pixels`}
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <label htmlFor={`${fieldId}-show-title`} className={strongLabelClass}>
          Show title
        </label>
        <Switch
          id={`${fieldId}-show-title`}
          checked={theme.showTitle}
          onCheckedChange={(showTitle) => onChange({ ...theme, showTitle })}
        />
      </div>

      {theme.showTitle && (
        <>
          <div className="space-y-1.5">
            <span className={strongLabelClass}>Title style</span>
            <TitleStylePicker
              value={theme.titleStyle}
              onChange={(titleStyle) => onChange({ ...theme, titleStyle })}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor={`${fieldId}-title-hover`} className={strongLabelClass}>
                Show title on hover
              </label>
              <Switch
                id={`${fieldId}-title-hover`}
                checked={theme.titleDisplay === "hover"}
                onCheckedChange={(hover) =>
                  onChange({
                    ...theme,
                    titleDisplay: hover ? "hover" : "always",
                  })
                }
              />
            </div>
            <p className={infoTextClass}>
              {theme.titleStyle === "overlay"
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
            cornerRadius={theme.cornerRadius}
            onChange={(priceTagPosition) =>
              onChange({ ...theme, priceTagPosition })
            }
          />
        )}
        {tagMode === "float" && theme.cornerRadius >= PRICE_TAG_CORNER_LIMIT && (
          <p className={infoTextClass}>
            Rounded cards keep the tag on the center axis.
          </p>
        )}
      </div>

      {/* Hover reveal only matters while a tag is shown at all. */}
      {tagMode !== "hidden" && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor={`${fieldId}-price-hover`} className={strongLabelClass}>
              Show price on hover
            </label>
            <Switch
              id={`${fieldId}-price-hover`}
              checked={theme.priceDisplay === "hover"}
              onCheckedChange={(hover) =>
                onChange({ ...theme, priceDisplay: hover ? "hover" : "always" })
              }
            />
          </div>
          <p className={infoTextClass}>
            The price stays hidden until a buyer hovers over the product.
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        <span className={strongLabelClass}>Price tag style</span>
        <SegmentedControl
          value={theme.priceTagStyle}
          options={PRICE_TAG_STYLE_OPTIONS}
          onChange={(priceTagStyle) => onChange({ ...theme, priceTagStyle })}
          ariaLabel="Price tag style"
        />
      </div>

      {/* Chip size is its own axis: it sets the tag's text size and padding
          wherever the tag sits, floated or in the info bar. */}
      <div className="space-y-1.5">
        <span className={strongLabelClass}>Price tag size</span>
        <SegmentedControl
          value={theme.priceTagSize ?? "md"}
          options={PRICE_TAG_SIZE_OPTIONS}
          onChange={(priceTagSize) => onChange({ ...theme, priceTagSize })}
          ariaLabel="Price tag size"
        />
      </div>

      {/* Shows the badge on blocks the seller marked sold out (the tag toggle
          on each product tile). */}
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={`${fieldId}-sold-out-badge`} className={strongLabelClass}>
          Sold-out badge
        </label>
        <Switch
          id={`${fieldId}-sold-out-badge`}
          checked={theme.soldOutBadge}
          onCheckedChange={(soldOutBadge) =>
            onChange({ ...theme, soldOutBadge })
          }
        />
      </div>
    </div>
  );
}

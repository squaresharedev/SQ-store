"use client";

import { useId } from "react";
import {
  CORNER_RADIUS_MAX,
  type CardStyle,
  type CardStyleOverrides,
} from "@/types/storefront";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { infoTextClass, strongLabelClass } from "@/components/ui/control-styles";
import { TitleStylePicker } from "./TitleStylePicker";

/**
 * The card-appearance controls (corner roundness and the title area), shared by
 * the theme's Cards section and each product tile's inspector card. Fully
 * controlled: `value` is a RESOLVED CardStyle (for a tile, the theme with that
 * block's overrides already applied, see resolveCardStyle) and every edit emits
 * only the fields it changed, so the theme editor spreads the patch into the
 * theme while the tile editor stores it as that block's override. One
 * component, two scopes: the controls can never drift apart.
 *
 * The price tag has its own panel (PriceTagControls) on the same contract: it
 * carries seven settings of its own, which buried the four that shape the card.
 */
export function CardStyleControls({
  value,
  onChange,
}: {
  value: CardStyle;
  onChange: (patch: CardStyleOverrides) => void;
}) {
  const fieldId = useId();

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
    </div>
  );
}

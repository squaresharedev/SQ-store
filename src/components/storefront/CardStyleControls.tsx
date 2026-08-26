"use client";

import { useId } from "react";
import { RotateCcw } from "lucide-react";
import {
  CORNER_RADIUS_MAX,
  CORNER_SPOT_LIMIT,
  TITLE_INSET_MAX,
  autoTitleInset,
  resolveTitlePosition,
  spotRow,
  type CardStyle,
  type CardStyleOverrides,
  type SpotRow,
} from "@/types/storefront";
import {
  layoutPresetPatch,
  matchLayoutPreset,
} from "@/lib/storefront/layout-presets";
import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  ghostButtonClass,
  infoTextClass,
  strongLabelClass,
} from "@/components/ui/control-styles";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { LayoutPresetPicker } from "./LayoutPresetPicker";
import { TileLayoutBoard } from "./TileLayoutBoard";
import { TitleStylePicker } from "./TitleStylePicker";

/** How an overlay bar arrives on hover, per row: it comes in from the edge it
 *  is pinned to, and a middle bar — which has no edge, and whose own transform
 *  is already centering it — fades instead. Mirrors HOVER_RISE_CLASSES. */
const REVEAL_HINTS: Record<SpotRow, string> = {
  top: "The bar slides down from the top when a buyer hovers.",
  middle: "The bar fades in when a buyer hovers.",
  bottom: "The bar slides up from the bottom when a buyer hovers.",
};

/**
 * How a product tile is laid out, shared by the theme's Cards section and each
 * product tile's inspector. Fully controlled: `value` is a RESOLVED CardStyle
 * (for a tile, the theme with that block's overrides already applied) and every
 * edit emits only the fields it changed, so the theme editor spreads the patch
 * into the theme while the tile editor stores it as that block's override. One
 * component, two scopes: the controls can never drift apart.
 *
 * THREE DEPTHS, in the order a seller needs them. A row of layouts answers the
 * question outright. The board under it moves the two labels anywhere the
 * layouts do not reach, and is the same gesture as dragging them on the tile
 * itself. Everything that shapes them rather than places them is folded away in
 * Fine tuning, because a seller who has not asked for it should not have to
 * scroll past it.
 */
export function CardStyleControls({
  value,
  onChange,
}: {
  value: CardStyle;
  onChange: (patch: CardStyleOverrides) => void;
}) {
  const fieldId = useId();

  // Resolved, so the board shows the spot that will really be used: a stored
  // corner shows as its fallback on a round tile, and a stored middle shows
  // dropped to the bottom once the title is a bar.
  const titleSpot = resolveTitlePosition(value.titlePosition, {
    titleStyle: value.titleStyle,
    cornerRadius: value.cornerRadius,
  });
  const inset = value.titleInset;

  return (
    <div className="space-y-4">
      {/* The whole question, answered in one press for most sellers. */}
      <div className="space-y-1.5">
        <span className={strongLabelClass}>Layout</span>
        <LayoutPresetPicker
          value={matchLayoutPreset(value)}
          onChange={(preset) => onChange(layoutPresetPatch(preset))}
        />
      </div>

      {/* One board, both labels. The title's row is simply missing from the
          price's spots, so "these two cannot share a row" is something the
          board shows rather than something a hint line has to say. */}
      <div className="space-y-1.5">
        <span className={strongLabelClass}>Position</span>
        <TileLayoutBoard
          titleStyle={value.titleStyle}
          titlePosition={titleSpot}
          showTitle={value.showTitle}
          priceTagPosition={value.priceTagPosition}
          cornerRadius={value.cornerRadius}
          onTitleChange={(titlePosition) => onChange({ titlePosition })}
          onPriceChange={(priceTagPosition) => onChange({ priceTagPosition })}
        />
        <p className={infoTextClass}>
          {value.cornerRadius >= CORNER_SPOT_LIMIT
            ? "Rounded cards keep both labels on the center axis."
            : "Drag either label here, or on the tile itself."}
        </p>
      </div>

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

      <CollapsibleSection title="Fine tuning" collapsible defaultOpen={false}>
        <div className="space-y-4">
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

              {/* Auto is a real state, not a number: the words are held off the
                  tile's rounded corners by the roundness itself, so a seller
                  only reaches for this to want more or less air than that. */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className={strongLabelClass}>Edge spacing</span>
                  {inset === undefined ? (
                    <span className={infoTextClass}>Auto (follows roundness)</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onChange({ titleInset: undefined })}
                      className={cn(ghostButtonClass, "px-2 py-1 text-xs")}
                    >
                      <RotateCcw
                        className="size-3"
                        strokeWidth={2}
                        aria-hidden="true"
                      />
                      Auto
                    </button>
                  )}
                </div>
                <Slider
                  min={0}
                  max={TITLE_INSET_MAX}
                  value={inset ?? autoTitleInset(value.cornerRadius)}
                  onChange={(titleInset) => onChange({ titleInset })}
                  ariaLabel="Title edge spacing"
                  valueText={`${inset ?? autoTitleInset(value.cornerRadius)} pixels`}
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-3">
                  <label
                    htmlFor={`${fieldId}-title-hover`}
                    className={strongLabelClass}
                  >
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
                {/* The overlay bar comes in from the edge it is pinned to, so
                    the sentence has to follow the spot, not name the bottom. */}
                <p className={infoTextClass}>
                  {value.titleStyle === "overlay"
                    ? REVEAL_HINTS[spotRow(titleSpot)]
                    : "The title stays hidden until a buyer hovers over the product."}
                </p>
              </div>
            </>
          )}
        </div>
      </CollapsibleSection>
    </div>
  );
}

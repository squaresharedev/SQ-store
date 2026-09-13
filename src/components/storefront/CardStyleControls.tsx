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
  type StorefrontTheme,
} from "@/types/storefront";
import { titleShadowColorField } from "@/lib/theme/color-target";
import { ColorPicker } from "@/components/ui/ColorPicker";
import {
  layoutPresetPatch,
  matchLayoutPreset,
} from "@/lib/storefront/layout-presets";
import { cn } from "@/lib/utils";
import { SliderField } from "@/components/ui/SliderField";
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

/** The shadow's tint: an inherit dot that clears the override, and a target so
 *  the wheel opens the docked panel. Resolved by color-target, the same call
 *  the panel makes, so the two cannot disagree. */
function TitleShadowColorField({
  theme,
  overrides,
  scope,
  onChange,
}: NonNullable<Parameters<typeof CardStyleControls>[0]["colorScope"]> & {
  onChange: (patch: CardStyleOverrides) => void;
}) {
  const field = titleShadowColorField(theme, overrides);
  return (
    <ColorPicker
      label={field.label}
      value={field.value}
      onChange={(titleShadowColor) => onChange({ titleShadowColor })}
      inherit={{
        ...field.inherit!,
        onSelect: () => onChange({ titleShadowColor: undefined }),
      }}
      target={
        scope === "many"
          ? undefined
          : { kind: "title-shadow", ...(scope === "theme" ? {} : scope) }
      }
    />
  );
}

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
  colorScope,
}: {
  value: CardStyle;
  onChange: (patch: CardStyleOverrides) => void;
  /**
   * The layers behind `value`, for the one optional color here (the shadow
   * tint): its inherit dot has to know whether THIS layer sets it, which the
   * merged style cannot say. Same shape as PriceTagControls' props. Absent =
   * no color field.
   */
  colorScope?: {
    theme: StorefrontTheme;
    /** The tile override being edited. Absent = editing the theme itself. */
    overrides?: CardStyleOverrides;
    scope: "theme" | "many" | { blockKey: string };
  };
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
            : "Click a spot to place the label, or drag it here or on the tile."}
        </p>
      </div>

      <SliderField
        id={`${fieldId}-corner-radius`}
        label="Corner roundness"
        min={0}
        max={CORNER_RADIUS_MAX}
        step={2}
        value={value.cornerRadius}
        onChange={(cornerRadius) => onChange({ cornerRadius })}
        ariaLabel="Corner roundness"
        valueText={`${value.cornerRadius} pixels`}
        labelClassName={strongLabelClass}
        unit="px"
        statusText={
          value.cornerRadius === 0
            ? "Sharp"
            : value.cornerRadius >= CORNER_RADIUS_MAX
              ? "Circle"
              : undefined
        }
      />

      {/* Out of Fine tuning on purpose: a seller who picks Gallery sees the
          fade straight away and should find its color without digging. Shown
          only while a shadow is actually drawn. */}
      {colorScope && value.showTitle && value.titleStyle === "shadow" && (
        <TitleShadowColorField {...colorScope} onChange={onChange} />
      )}

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
              <SliderField
                id={`${fieldId}-title-inset`}
                label="Edge spacing"
                min={0}
                max={TITLE_INSET_MAX}
                value={inset ?? autoTitleInset(value.cornerRadius)}
                onChange={(titleInset) => onChange({ titleInset })}
                ariaLabel="Title edge spacing"
                valueText={`${inset ?? autoTitleInset(value.cornerRadius)} pixels`}
                labelClassName={strongLabelClass}
                unit="px"
                headerAction={
                  inset === undefined ? (
                    <span className={infoTextClass}>Auto</span>
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
                  )
                }
              />

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

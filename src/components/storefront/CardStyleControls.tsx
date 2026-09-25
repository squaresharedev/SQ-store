"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
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
  const tKey = useTranslations();
  const field = titleShadowColorField(theme, overrides);
  const inherit = field.inherit!;
  return (
    <ColorPicker
      label={tKey(field.label)}
      value={field.value}
      onChange={(titleShadowColor) => onChange({ titleShadowColor })}
      inherit={{
        label: tKey(inherit.label),
        useLabel: tKey(inherit.useLabel),
        value: inherit.value,
        active: inherit.active,
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
  const t = useTranslations("Storefront.cardStyle");
  const fieldId = useId();
  const revealHints: Record<SpotRow, string> = {
    top: t("revealTop"),
    middle: t("revealMiddle"),
    bottom: t("revealBottom"),
  };

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
        <span className={strongLabelClass}>{t("layout")}</span>
        <LayoutPresetPicker
          value={matchLayoutPreset(value)}
          onChange={(preset) => onChange(layoutPresetPatch(preset))}
        />
      </div>

      {/* One board, both labels. The title's row is simply missing from the
          price's spots, so "these two cannot share a row" is something the
          board shows rather than something a hint line has to say. */}
      <div className="space-y-1.5">
        <span className={strongLabelClass}>{t("position")}</span>
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
            ? t("roundedHint")
            : t("spotHint")}
        </p>
      </div>

      <SliderField
        id={`${fieldId}-corner-radius`}
        label={t("cornerRoundness")}
        min={0}
        max={CORNER_RADIUS_MAX}
        step={2}
        value={value.cornerRadius}
        onChange={(cornerRadius) => onChange({ cornerRadius })}
        ariaLabel={t("cornerRoundness")}
        valueText={t("cornerValueText", { n: value.cornerRadius })}
        labelClassName={strongLabelClass}
        unit="px"
        statusText={
          value.cornerRadius === 0
            ? t("sharp")
            : value.cornerRadius >= CORNER_RADIUS_MAX
              ? t("circle")
              : undefined
        }
      />

      {/* Out of Fine tuning on purpose: a seller who picks Gallery sees the
          fade straight away and should find its color without digging. Shown
          only while a shadow is actually drawn. */}
      {colorScope && value.showTitle && value.titleStyle === "shadow" && (
        <TitleShadowColorField {...colorScope} onChange={onChange} />
      )}

      <CollapsibleSection title={t("fineTuning")} collapsible defaultOpen={false}>
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor={`${fieldId}-show-title`} className={strongLabelClass}>
              {t("showTitle")}
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
                <span className={strongLabelClass}>{t("titleStyleLabel")}</span>
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
                label={t("edgeSpacing")}
                min={0}
                max={TITLE_INSET_MAX}
                value={inset ?? autoTitleInset(value.cornerRadius)}
                onChange={(titleInset) => onChange({ titleInset })}
                ariaLabel={t("edgeSpacingAriaLabel")}
                valueText={t("edgeValueText", { n: inset ?? autoTitleInset(value.cornerRadius) })}
                labelClassName={strongLabelClass}
                unit="px"
                headerAction={
                  inset === undefined ? (
                    <span className={infoTextClass}>{t("auto")}</span>
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
                      {t("auto")}
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
                    {t("showTitleOnHover")}
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
                    ? revealHints[spotRow(titleSpot)]
                    : t("hoverHint")}
                </p>
              </div>
            </>
          )}
        </div>
      </CollapsibleSection>
    </div>
  );
}

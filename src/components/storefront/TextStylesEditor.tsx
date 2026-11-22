"use client";

import { useId, useState, type CSSProperties } from "react";
import { Bold, CaseUpper, Italic, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  FONT_ROLES,
  TEXT_VARIANT_BASE_PX,
  TEXT_VARIANTS,
  type FontRole,
  type StorefrontTheme,
  type TextStyleDef,
  type TextVariant,
} from "@/types/storefront";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Select } from "@/components/ui/select";
import { ghostButtonClass, helpTextClass, labelClass } from "@/components/ui/control-styles";
import { DEFAULT_TEXT_COLOR } from "@/lib/theme/color-target-core";
import { isFontPairing } from "@/lib/theme/font-pairings";
import { fontRoleStyle } from "@/lib/theme/font-roles";
import {
  resolveTextStyle,
  textStyleColor,
  textStylePreviewStyle,
  withTextStyle,
} from "@/lib/storefront/text-styles";
import { cn } from "@/lib/utils";
import { TEXT_VARIANT_LABELS } from "./config-maps";
import { FontSizeField } from "./FontSizeField";
import { TEXT_TOGGLE_CLASS } from "./TextFormatControls";
import { TextSpacingFields } from "./TextSpacingFields";

/** The largest a style's preview line is drawn in this narrow panel: the
 *  words are a sample, and a 120px headline would push the controls off. */
const PREVIEW_MAX_PX = 32;

type StyleSwitch = "bold" | "italic" | "uppercase";
const SWITCH_ICONS: Record<StyleSwitch, typeof Bold> = {
  bold: Bold,
  italic: Italic,
  uppercase: CaseUpper,
};

/**
 * THE SAVED TEXT STYLES, edited once for the whole storefront: what Headline,
 * Subheading, Body and Small label look like. Every text block in a style
 * follows it, and carries only what it changes (behind its own "More").
 *
 * One style at a time: a picker of the four, a line drawn in the style, and
 * its few settings. Lives behind "More" in Typography: the defaults are good,
 * and most sellers never open it. Writes through withTextStyle, which drops
 * what returns to the default, so a style tried and put back stores nothing.
 */
export function TextStylesEditor({
  theme,
  onChange,
  faceClassName,
  faceStyle,
}: {
  theme: StorefrontTheme;
  onChange: (theme: StorefrontTheme) => void;
  /** The pairing faces' variable classes and role variables, when the board
   *  has a pairing: the preview line is drawn in the real face. */
  faceClassName?: string;
  faceStyle?: CSSProperties;
}) {
  const tKey = useTranslations();
  const t = useTranslations("EditorType.panel.textStyles");
  const tFormat = useTranslations("Storefront.textFormat");
  const fieldId = useId();
  const [variant, setVariant] = useState<TextVariant>("heading");

  const saved: TextStyleDef = theme.textStyles?.[variant] ?? {};
  const resolved = resolveTextStyle(theme, variant);
  const paired = isFontPairing(theme.fontPairing);
  const defaultColor = textStyleColor({ accent: theme.accent }, variant) ?? DEFAULT_TEXT_COLOR;

  function update(patch: Partial<TextStyleDef>) {
    const textStyles = withTextStyle(theme.textStyles, variant, { ...saved, ...patch });
    const next: StorefrontTheme = { ...theme, textStyles };
    if (textStyles === undefined) delete next.textStyles;
    onChange(next);
  }

  function reset() {
    const textStyles = withTextStyle(theme.textStyles, variant, {});
    const next: StorefrontTheme = { ...theme, textStyles };
    if (textStyles === undefined) delete next.textStyles;
    onChange(next);
  }

  const switchLabels: Record<StyleSwitch, string> = {
    bold: tFormat("bold"),
    italic: tFormat("italic"),
    uppercase: t("uppercase"),
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <span className={labelClass}>{t("title")}</span>
        <p className={helpTextClass}>{t("hint")}</p>
      </div>

      {/* Four names do not fit side by side in the panel, so a select. */}
      <div className="space-y-1.5">
        <label htmlFor={`${fieldId}-variant`} className={labelClass}>
          {t("pick")}
        </label>
        <Select
          id={`${fieldId}-variant`}
          value={variant}
          options={TEXT_VARIANTS.map((value) => ({ value, label: tKey(TEXT_VARIANT_LABELS[value]) }))}
          onChange={setVariant}
        />
      </div>

      {/* The style's own name, drawn in the style. */}
      <div className={cn("overflow-hidden border border-border px-2 py-2", faceClassName)} style={faceStyle}>
        <p
          aria-hidden="true"
          className="truncate leading-tight text-foreground"
          style={{
            ...textStylePreviewStyle({ ...resolved, size: Math.min(resolved.size, PREVIEW_MAX_PX) }),
            ...(paired ? fontRoleStyle(resolved.font) : {}),
          }}
        >
          {tKey(TEXT_VARIANT_LABELS[variant])}
        </p>
      </div>

      {/* Which of the pairing's two faces: meaningless without a pairing,
          where there is only one. */}
      {paired && (
        <div className="space-y-1.5">
          <span className={labelClass}>{t("face")}</span>
          <SegmentedControl<FontRole>
            ariaLabel={t("face")}
            value={resolved.font}
            options={FONT_ROLES.map((role) => ({
              value: role,
              label: role === "heading" ? t("faceHeading") : t("faceBody"),
            }))}
            onChange={(font) => update({ font })}
          />
        </div>
      )}

      <FontSizeField
        id={`${fieldId}-size`}
        value={saved.size}
        autoSize={TEXT_VARIANT_BASE_PX[variant]}
        onChange={(size) => update({ size })}
      />

      <div className="space-y-1.5">
        <span className={labelClass}>{tFormat("format")}</span>
        <div role="group" aria-label={tFormat("format")} className="flex gap-1">
          {(Object.keys(SWITCH_ICONS) as StyleSwitch[]).map((key) => {
            const Icon = SWITCH_ICONS[key];
            const active = saved[key] === true;
            return (
              <button
                key={key}
                type="button"
                onClick={() => update({ [key]: active ? undefined : true })}
                aria-label={switchLabels[key]}
                aria-pressed={active}
                className={cn(TEXT_TOGGLE_CLASS, active && "bg-accent text-foreground")}
              >
                <Icon className="size-4" strokeWidth={2} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </div>

      <TextSpacingFields
        id={`${fieldId}-spacing`}
        value={{ letterSpacing: saved.letterSpacing, lineHeight: saved.lineHeight }}
        onChange={(patch) => update(patch)}
      />

      <ColorPicker
        id={`${fieldId}-color`}
        label={tKey("Storefront.textBlock.color.label")}
        value={saved.color ?? defaultColor}
        onChange={(color) => update({ color })}
        inherit={{
          label: t("colorDefault"),
          useLabel: t("useColorDefault"),
          value: defaultColor,
          active: saved.color === undefined,
          onSelect: () => update({ color: undefined }),
        }}
      />

      <button
        type="button"
        onClick={reset}
        disabled={theme.textStyles?.[variant] === undefined}
        className={cn(ghostButtonClass, "px-2 py-1 text-xs")}
      >
        <RotateCcw className="size-3" strokeWidth={2} aria-hidden="true" />
        {t("reset")}
      </button>
    </div>
  );
}

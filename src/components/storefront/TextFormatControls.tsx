"use client";

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  Bold,
  Italic,
  Underline,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { TEXT_ALIGNS, TEXT_VALIGNS, type TextAlign, type TextValign } from "@/types/storefront";
import { cn } from "@/lib/utils";
import { labelClass } from "@/components/ui/control-styles";

/**
 * The formatting and alignment controls, shared by everything in the storefront
 * that styles a line of text: a text block's inspector card and the masthead's
 * two lines in the left-hand panel.
 *
 * Shared because the two surfaces are the same control set over different
 * storage, and a seller who learns the toolbar on a text block should find the
 * identical one on the store name. Each is a pressed-state toggle group rather
 * than a set of checkboxes: the button IS the state.
 */

/** One pressed-state toggle: shared by the toolbar here and the saved text
 *  styles editor (TextStylesEditor), so every text switch looks the same. */
export const TEXT_TOGGLE_CLASS =
  "inline-flex size-8 items-center justify-center rounded-none border border-border text-muted-foreground transition-colors duration-base ease-standard hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background motion-reduce:transition-none";

export type InlineFormat = "bold" | "italic" | "underline";

const FORMAT_ICONS: Record<InlineFormat, typeof Bold> = {
  bold: Bold,
  italic: Italic,
  underline: Underline,
};


/** Bold / italic / underline. `active` is what each one currently is, so the
 *  caller stays the only place that knows where the value is stored. */
export function FormatToggles({
  active,
  onToggle,
  label,
}: {
  active: Record<InlineFormat, boolean>;
  onToggle: (format: InlineFormat) => void;
  /** Group name, for the two places that host these side by side. */
  label?: string;
}) {
  const t = useTranslations("Storefront.textFormat");
  const groupLabel = label ?? t("formatAriaLabel");
  const formatLabels: Record<InlineFormat, string> = {
    bold: t("bold"),
    italic: t("italic"),
    underline: t("underline"),
  };
  return (
    <div className="space-y-1.5">
      <span className={labelClass}>{t("format")}</span>
      <div role="group" aria-label={groupLabel} className="flex gap-1">
        {(Object.keys(FORMAT_ICONS) as InlineFormat[]).map((format) => {
          const Icon = FORMAT_ICONS[format];
          return (
            <button
              key={format}
              type="button"
              onClick={() => onToggle(format)}
              aria-label={formatLabels[format]}
              aria-pressed={active[format]}
              className={cn(
                TEXT_TOGGLE_CLASS,
                active[format] && "bg-accent text-foreground",
              )}
            >
              <Icon className="size-4" strokeWidth={2} aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

const ALIGN_ICONS: Record<TextAlign, typeof AlignLeft> = {
  left: AlignLeft,
  center: AlignCenter,
  right: AlignRight,
};

/** Left / center / right. */
export function AlignmentToggles({
  align,
  onChange,
  label,
}: {
  align: TextAlign;
  onChange: (align: TextAlign) => void;
  label?: string;
}) {
  const t = useTranslations("Storefront.textFormat");
  const groupLabel = label ?? t("alignAriaLabel");
  const alignLabels: Record<TextAlign, string> = {
    left: t("alignLeft"),
    center: t("alignCenter"),
    right: t("alignRight"),
  };
  return (
    <div className="space-y-1.5">
      <span className={labelClass}>{t("alignment")}</span>
      <div role="group" aria-label={groupLabel} className="flex gap-1">
        {TEXT_ALIGNS.map((value) => {
          const Icon = ALIGN_ICONS[value];
          const active = align === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => onChange(value)}
              aria-label={alignLabels[value]}
              aria-pressed={active}
              className={cn(TEXT_TOGGLE_CLASS, active && "bg-accent text-foreground")}
            >
              <Icon className="size-4" strokeWidth={2} aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

const VALIGN_ICONS: Record<TextValign, typeof AlignLeft> = {
  top: AlignVerticalJustifyStart,
  middle: AlignVerticalJustifyCenter,
  bottom: AlignVerticalJustifyEnd,
};

/** Top / middle / bottom: where a text block's words sit in its box. Middle
 *  is where they have always sat, and choosing it stores nothing (the caller
 *  is handed `undefined`). */
export function VerticalAlignToggles({
  valign,
  onChange,
}: {
  valign: TextValign | undefined;
  onChange: (valign: TextValign | undefined) => void;
}) {
  const t = useTranslations("EditorType.panel.valign");
  const current = valign ?? "middle";
  return (
    <div className="space-y-1.5">
      <span className={labelClass}>{t("label")}</span>
      <div role="group" aria-label={t("group")} className="flex gap-1">
        {TEXT_VALIGNS.map((value) => {
          const Icon = VALIGN_ICONS[value];
          const active = current === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => onChange(value === "middle" ? undefined : value)}
              aria-label={t(value)}
              aria-pressed={active}
              className={cn(TEXT_TOGGLE_CLASS, active && "bg-accent text-foreground")}
            >
              <Icon className="size-4" strokeWidth={2} aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

"use client";

import { useId, useMemo } from "react";
import { Type } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  STOREFRONT_FONTS,
  TEXT_VARIANT_BASE_PX,
  TEXT_VARIANTS,
  type StorefrontFont,
  blockKey,
  type TextBlock,
} from "@/types/storefront";
import { textBlockThemeColor } from "@/lib/theme/color-target";
import { rangeColor } from "@/lib/storefront/text-spans";
import { Select, type SelectOption } from "@/components/ui/select";
import { ColorPicker } from "@/components/ui/ColorPicker";
import {
  helpTextClass,
  labelClass,
  secondaryButtonClass,
} from "@/components/ui/control-styles";
import { BlockActions } from "./BlockActions";
import { FONT_LABELS, TEXT_VARIANT_LABELS } from "./config-maps";
import { FontSizeField } from "./FontSizeField";
import { useReportedAutoFitSize } from "./text-autofit-registry";
import { AlignmentToggles, FormatToggles } from "./TextFormatControls";
import { InfoTip } from "@/components/ui/InfoTip";

export type TextBlockPatch = Partial<
  Pick<
    TextBlock,
    | "text"
    | "variant"
    | "align"
    | "bold"
    | "italic"
    | "underline"
    | "color"
    | "fontSize"
    | "font"
    | "spans"
  >
>;

// "Inherit" sentinel: the block stores NOTHING for the theme-default font —
// the select just needs a concrete value to point at.
type FontChoice = StorefrontFont | "theme";

/**
 * Text-block editor rendered in the side panel: style, formatting, alignment,
 * and per-block font / size / color overrides (all optional — a fresh block
 * simply follows the theme). Every change is applied live (no "done" step);
 * the tile updates as you set it.
 *
 * The WORDS are deliberately not here. They are typed on the tile itself, at
 * the size and colour they will really have (see TextTileContent); this panel
 * only offers the way back into that editor.
 */
export function TextBlockEditor({
  block,
  accent,
  hasCustomFont = false,
  onUpdate,
  onDuplicate,
  onRemove,
  removeLabel,
  onEditText,
  selectedRange = null,
  onColorChange,
  multi = false,
}: {
  block: TextBlock;
  /** Theme accent — what a heading renders in when no override is set. */
  accent: string;
  /** Whether the storefront has an uploaded face to offer as a font choice. */
  hasCustomFont?: boolean;
  onUpdate: (patch: TextBlockPatch) => void;
  /** Insert a copy of this block (the no-keyboard copy/paste path). */
  onDuplicate: () => void;
  /** Take the block off the board. Sits beside Duplicate as the pair of
   *  whole-block actions every inspector ends on. */
  onRemove?: () => void;
  /** Overridden when this editor is driving a whole multi-selection, where the
   *  honest word is "Remove 3 blocks". */
  removeLabel?: string;
  /** Put the caret in the block on the canvas. Absent while group-editing. */
  onEditText?: () => void;
  /** Words selected in the in-place editor right now, if any. A colour picked
   *  here lands on THEM rather than on the whole block, so the field has to
   *  say so and show their colour. */
  selectedRange?: { start: number; end: number } | null;
  /** Route a colour through the designer, which owns the block-or-range
   *  decision. Absent while group-editing, where the picker writes the whole
   *  block through `onUpdate` as before. */
  onColorChange?: (color: string | undefined) => void;
  /** Group-editing mode (MultiBlockEditor): hides the content control, since
   *  one caret cannot be in several blocks at once. Styling controls stay. */
  multi?: boolean;
}) {
  const fieldId = useId();
  const t = useTranslations("Storefront");
  const tRoot = useTranslations();

  const variantOptions: SelectOption<(typeof TEXT_VARIANTS)[number]>[] = useMemo(
    () =>
      TEXT_VARIANTS.map((variant) => ({
        value: variant,
        label: tRoot(TEXT_VARIANT_LABELS[variant]),
      })),
    [tRoot],
  );

  /** The uploaded face is offered only once there IS one; without an upload the
   *  option would set a font the storefront cannot render. */
  const fontOptionsForBlock: SelectOption<FontChoice>[] = useMemo(
    () => [
      {
        value: "theme",
        label: t("textBlock.font.themeFont"),
        description: t("textBlock.font.themeFontDescription"),
      },
      ...STOREFRONT_FONTS.filter(
        (font) => font !== "custom" || hasCustomFont,
      ).map((font) => ({ value: font, label: tRoot(FONT_LABELS[font]) })),
    ],
    [t, tRoot, hasCustomFont],
  );

  // The tile's OWN report of what Auto currently renders at, which may be
  // smaller than the style's flat base once the block has had to shrink to
  // fit its box. Falls back to that flat base before the canvas has measured
  // (or outside the designer entirely — see text-autofit-registry), which is
  // exactly the old, unshrinking number this used to always show.
  const autoFitSize =
    useReportedAutoFitSize(blockKey(block)) ?? TEXT_VARIANT_BASE_PX[block.variant];

  // What the tile renders with when no override is stored, and what the
  // picker's "Theme color" option points at. Shared with the ColorPanel so the
  // two cannot answer "what does inheriting look like" differently.
  const themeColor = textBlockThemeColor(accent, block);

  // How many characters a colour would land on, when it would land on part of
  // the text rather than all of it. Group-editing never routes to a range: one
  // caret cannot be in several blocks.
  const selectedWords =
    !multi && onColorChange && selectedRange && selectedRange.end > selectedRange.start
      ? selectedRange.end - selectedRange.start
      : 0;
  const blockHex = block.color ?? themeColor;
  const rangeHex = selectedWords ? rangeColor(block, selectedRange!) : null;
  const setColor = (color: string | undefined) =>
    onColorChange ? onColorChange(color) : onUpdate({ color });

  return (
    <div className="space-y-3">
      {!multi && onEditText && (
        <div className="space-y-1.5">
          <span className="flex items-center gap-1.5">
            <span className={labelClass}>{t("textBlock.text.label")}</span>
            <InfoTip label={t("textBlock.text.infoLabel")}>
              {t("textBlock.text.infoContent")}
            </InfoTip>
          </span>
          <button
            type="button"
            onClick={onEditText}
            className={secondaryButtonClass + " w-full"}
          >
            <Type className="size-4" strokeWidth={2} aria-hidden="true" />
            {t("textBlock.editOnCanvas")}
          </button>
        </div>
      )}

      <div className="space-y-1.5">
        <label htmlFor={`${fieldId}-variant`} className={labelClass}>
          {t("textBlock.style.label")}
        </label>
        <Select
          id={`${fieldId}-variant`}
          value={block.variant}
          options={variantOptions}
          onChange={(variant) => onUpdate({ variant })}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor={`${fieldId}-font`} className={labelClass}>
          {t("textBlock.font.label")}
        </label>
        <Select
          id={`${fieldId}-font`}
          value={(block.font ?? "theme") as FontChoice}
          options={fontOptionsForBlock}
          onChange={(font) =>
            onUpdate({ font: font === "theme" ? undefined : font })
          }
        />
      </div>

      <FontSizeField
        id={`${fieldId}-size`}
        value={block.fontSize}
        autoSize={autoFitSize}
        onChange={(fontSize) => onUpdate({ fontSize })}
      />

      {/* "Follow the theme" is an option INSIDE the picker, not a reset link
          beside it — same affordance every optional color field gets. */}
      {/* Colour follows the caret. With words selected in the block on the
          canvas the picker paints THEM (and shows their colour, and offers
          "back to the block" instead of "back to the theme"); with nothing
          selected it is the block's own colour, exactly as before. */}
      <ColorPicker
        id={`${fieldId}-color`}
        label={selectedWords ? t("textBlock.color.selectedWords") : t("textBlock.color.label")}
        value={rangeHex ?? blockHex}
        onChange={(color) => setColor(color)}
        inherit={
          selectedWords
            ? {
                label: t("textBlock.color.blockColor"),
                useLabel: t("textBlock.color.useBlockColor"),
                value: blockHex,
                active: rangeHex === null,
                onSelect: () => setColor(undefined),
              }
            : {
                label: t("textBlock.color.themeColor"),
                useLabel: t("colors.inherit.themeColor.use"),
                value: themeColor,
                active: block.color === undefined,
                onSelect: () => setColor(undefined),
              }
        }
        // No target while group-editing: the panel edits ONE color, and this
        // picker is writing to every selected block at once.
        target={multi ? undefined : { kind: "text-color", blockKey: blockKey(block) }}
      />
      {selectedWords && (
        <p className={helpTextClass}>
          {t("textBlock.colouringSelected", { count: selectedWords })}
        </p>
      )}

      {/* The same two controls the masthead's lines get in the left-hand
          panel — one toolbar, wherever text is styled. */}
      <FormatToggles
        active={{
          bold: !!block.bold,
          italic: !!block.italic,
          underline: !!block.underline,
        }}
        onToggle={(format) => onUpdate({ [format]: !block[format] })}
      />

      <AlignmentToggles
        align={block.align}
        onChange={(align) => onUpdate({ align })}
      />

      <BlockActions
        onDuplicate={onDuplicate}
        onRemove={onRemove}
        removeLabel={removeLabel}
      />
    </div>
  );
}
